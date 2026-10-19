#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { Pipeline } from './pipeline.js'
import { Vault } from './vault.js'
import { MemoryStore } from './store.js'
import { GitHubOrchestrator } from './github.js'
import { AppetizeClient } from './appetize.js'
import { normalizeMasterKey } from './vault/crypto.js'
import { loadConfig, validateConfigFor } from './config.js'
import { Log } from './log.js'


const HELP = `appiary: wraps web apps into native ios/android builds

usage:
  appiary wrap --url <web url> --app-id <reverse domain id> --app-name <name>
  appiary preview --job <file>   (not implemented in cli: run via the dashboard api)
  appiary deploy --job <file> --credentials <json file>

environment:
  APPIARY_MASTER_KEY       master key material for the credential vault
  APPIARY_GITHUB_TOKEN     token with repo dispatch permissions
  APPIARY_GITHUB_REPO      owner/name of the cloud-compile repo
  APPIARY_APPETIZE_TOKEN   appetize.io developer token
`

function arg(name) {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : null
}

async function main() {
  const cmd = process.argv[2]
  const log = new Log()
  if (!cmd || cmd === '--help' || cmd === '-h') {
    console.log(HELP)
    return
  }
  const config = loadConfig()

  if (cmd === 'wrap') {
    const url = arg('url')
    const appId = arg('app-id')
    const appName = arg('app-name')
    if (!url || !appId || !appName) {
      log.error('wrap needs --url, --app-id, --app-name')
      process.exitCode = 2
      return
    }
    const pipeline = new Pipeline({
      vault: new Vault({ masterKey: normalizeMasterKey('dev-standin'), store: new MemoryStore() }),
      github: { dispatchBuild: async () => { throw new Error('not in wrap mode') } },
      store: new MemoryStore(),
      log
    })
    const { jobId, config: rendered, warnings } = await pipeline.createJob({
      projectId: appId,
      webUrl: url,
      appId,
      appName
    })
    log.info('job created', { jobId, state: 'wrapped', webUrl: url })
    for (const w of warnings ?? []) log.warn(w)
    const out = { jobId, capacitorConfig: rendered }
    const outFile = arg('out') ?? `job-${jobId}.json`
    const { writeFileSync } = await import('node:fs')
    writeFileSync(outFile, `${JSON.stringify(out, null, 2)}\n`)
    log.info('capacitor config written', { file: outFile })
    return
  }

  if (cmd === 'deploy') {
    const jobFile = arg('job')
    const credFile = arg('credentials')
    if (!jobFile || !credFile) {
      log.error('deploy needs --job and --credentials')
      process.exitCode = 2
      return
    }
    validateConfigFor('dispatch', config)
    const job = JSON.parse(readFileSync(jobFile, 'utf8'))
    const credentials = JSON.parse(readFileSync(credFile, 'utf8'))
    const store = new MemoryStore()
    const vault = new Vault({ masterKey: normalizeMasterKey(config.masterKeySecret), store })
    const github = new GitHubOrchestrator({ apiToken: config.github.apiToken, repo: config.github.repo, log })
    const appetize = config.appetize.apiToken
      ? new AppetizeClient({ apiToken: config.appetize.apiToken, log })
      : null
    const pipeline = new Pipeline({ vault, github, appetize, store, log, config })
    const { jobId, warnings } = await pipeline.createJob({
      projectId: job.capacitorConfig?.appId ?? 'unknown-project',
      webUrl: job.capacitorConfig?.server?.url,
      platform: arg('platform') ?? 'ios',
      appId: job.capacitorConfig?.appId,
      appName: job.capacitorConfig?.appName,
      credentials
    })
    for (const w of warnings ?? []) log.warn(w)
    const result = await pipeline.dispatch(jobId, {})
    log.info('cloud compile dispatched', result)
    return
  }

  log.error(`unknown command: ${cmd}`)
  log.info('run appiary --help')
  process.exitCode = 2
}

main().catch((err) => {
  console.error(`[error] ${(err.message ?? String(err)).toLowerCase()}`)
  process.exitCode = 1
})
