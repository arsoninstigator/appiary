import assert from 'node:assert/strict'
import { normalizeMasterKey, seal, unseal, safeEqual } from '../src/vault/crypto.js'
import { Vault } from '../src/vault.js'
import { classifyIntake, normalizeGitRepo, labelBuilder } from '../src/intake.js'
import { MemoryStore } from '../src/store.js'
import { renderCapacitorConfig, validateWebUrl } from '../src/wrapper.js'
import { AppetizeClient, embedUrlFor } from '../src/appetize.js'
import { GitHubOrchestrator } from '../src/github.js'
import { Pipeline } from '../src/pipeline.js'
import { createHandoffServer } from '../src/handoff-server.js'
import { Log, redact } from '../src/log.js'
import { readFileSync } from 'node:fs'

let passed = 0
const failures = []

async function test(name, fn) {
  try {
    await fn()
    passed += 1
    console.log(`  ok: ${name}`)
  } catch (err) {
    failures.push({ name, err })
    console.log(`fail: ${name}\n      ${err.message}`)
  }
}

// tiny injectable fetch that records requests and replays canned responses
function mockFetch(responses = []) {
  const calls = []
  const impl = async (url, init) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected request: ${url}`)
    if (next.error) throw next.error
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      json: async () => next.body,
      text: async () => JSON.stringify(next.body)
    }
  }
  return { impl, calls }
}

console.log('appiary self-test suite\n')

await test('01 envelope encryption roundtrip', () => {
  const key = normalizeMasterKey('dev-master-key-material')
  assert.equal(key.length, 32)
  const secret = '{"ascKeyP8": "base64-of-p8", "issuerId": "69-a1b2"}'
  const env = seal(secret, key)
  assert.ok(env.startsWith('v1:'))
  assert.equal(unseal(env, key), secret)
  assert.throws(() => unseal(env, normalizeMasterKey('other-key')), /auth tag|Unsupported state/)
  const tampered = `v1:${env.split(':')[1]}:${env.split(':')[2]}:${Buffer.from('x'.repeat(64)).toString('base64')}:${env.split(':')[4]}`
  assert.throws(() => unseal(tampered, key), /auth tag|Unsupported state|final/)
})

await test('02 vault stores credentials encrypted, decrypts only in memory', async () => {
  const store = new MemoryStore()
  const vault = new Vault({ masterKey: normalizeMasterKey('m'), store })
  const credId = await vault.putCredential('proj_1', 'appstore', {
    ASC_KEY_ID: 'K2X9', ASC_ISSUER_ID: '69-aa', ASC_KEY_P8: Buffer.from('fake-p8-body').toString('base64')
  })
  const row = await store.get(credId)
  assert.ok(!JSON.stringify(row).includes('fake-p8-body'), 'plaintext leaked into store')
  assert.ok(row.envelope.startsWith('v1:'))
  const cred = await vault.getCredential(credId)
  assert.equal(cred.ASC_KEY_ID, 'K2X9')
  assert.equal(Buffer.from(cred.ASC_KEY_P8, 'base64').toString(), 'fake-p8-body')
})

await test('03 single-use handoff: redeem once, then reject', async () => {
  const store = new MemoryStore()
  const vault = new Vault({ masterKey: normalizeMasterKey('m'), store })
  const credId = await vault.putCredential('p', 'appstore', { MATCH_PASSWORD: 'zz' })
  const { token } = await vault.issueHandoff([credId], { jobId: 'job-1' })
  const first = await vault.redeemHandoff(token, 'job-1')
  assert.equal(first.MATCH_PASSWORD, 'zz')
  await assert.rejects(() => vault.redeemHandoff(token, 'job-1'), /already redeemed/)
  await assert.rejects(() => vault.redeemHandoff(token, 'job-2'), /different job/)
})

await test('04 handoff ttl expiry', async () => {
  let t = 0
  const store = new MemoryStore()
  const vault = new Vault({ masterKey: normalizeMasterKey('m'), store, now: () => t })
  const credId = await vault.putCredential('p', 'k', { a: '1' })
  const { token } = await vault.issueHandoff([credId], { jobId: 'r', ttlMs: 1000 })
  t = 200_000
  await assert.rejects(() => vault.redeemHandoff(token, 'r'), /expired/)
})

await test('05 capacitor wrapper injects server.url', () => {
  const { config } = renderCapacitorConfig({
    webUrl: 'https://demo.lovable.app',
    appId: 'com.example.demo',
    appName: 'Demo'
  })
  assert.equal(config.server.url, 'https://demo.lovable.app/')
  assert.equal(config.appId, 'com.example.demo')
  assert.equal(config.appName, 'Demo')
  assert.equal(config.server.cleartext, false)
  assert.ok(!JSON.stringify(config).includes('{{'))
  assert.throws(() => renderCapacitorConfig({ webUrl: 'https://x.dev', appId: 'not-reverse-domain', appName: 'x' }), /reverse-domain/)
  assert.throws(() => renderCapacitorConfig({ webUrl: 'http://insecure.dev', appId: 'com.a.b', appName: 'x' }), /allowInsecureWeb/)
  const insecure = renderCapacitorConfig({ webUrl: 'http://insecure.dev', appId: 'com.a.b', appName: 'x', allowInsecureWeb: true })
  assert.equal(insecure.config.server.cleartext, true)
  assert.ok(insecure.warnings.length > 0)
  assert.throws(() => validateWebUrl('ftp://nope'), /http/)
  assert.throws(() => validateWebUrl('https://user:pass@x.dev'), /embedded credentials/)
})

await test('06 appetize client publishes artifacts and builds embed urls', async () => {
  const { impl, calls } = mockFetch([
    { body: { publicKey: 'pk-abc123' } },
    { body: { publicKey: 'pk-abc123' } }
  ])
  const client = new AppetizeClient({ apiToken: 'tok', fetchImpl: impl })
  const app = await client.publishApp({ platform: 'ios', artifactUrl: 'https://cdn.appiary.dev/debug.zip' })
  assert.equal(app.publicKey, 'pk-abc123')
  assert.ok(app.embedUrl.includes('pk-abc123'))
  assert.equal(calls[0].init.headers['x-api-key'], 'tok')
  assert.equal(calls[0].init.headers['content-type'], 'application/json')
  assert.ok(calls[0].url.endsWith('/v1/apps'))
  const embed = embedUrlFor('pk-abc123', { device: 'pixel4', osVersion: '11.0', scale: 75 })
  assert.ok(embed.startsWith('https://app.appetize.io/app/pk-abc123?'))
  assert.ok(embed.includes('device=pixel4') && embed.includes('osVersion=11.0') && embed.includes('scale=75'))
  // update in place keeps the same key, embed stays stable
  const again = await client.publishApp({ platform: 'ios', artifactUrl: 'https://cdn/v2.zip', publicKey: 'pk-abc123' })
  assert.equal(again.publicKey, 'pk-abc123')
  assert.ok(calls[1].url.endsWith('/v1/apps/pk-abc123'))
  await assert.rejects(() => client.publishApp({ platform: 'webos', artifactUrl: 'x' }), /platform/)
})

await test('07 github orchestrator dispatches repository_dispatch', async () => {
  const { impl, calls } = mockFetch([{ status: 204, ok: true, body: null }])
  const gh = new GitHubOrchestrator({ apiToken: 'gh_tok', repo: 'appiary/cloud', fetchImpl: impl })
  const result = await gh.dispatchBuild({
    platform: 'ios',
    config: { server: { url: 'https://demo.lovable.app/' }, appId: 'com.a.b', appName: 'demo' },
    metadata: { projectId: 'p1' },
    handoff: { token: 'hof_x', handoffId: 'handoff_x' },
    baseUrl: 'https://api.appiary.dev',
    jobId: 'job_1'
  })
  assert.equal(result.dispatched, true)
  const call = calls[0]
  assert.ok(call.url.endsWith('/repos/appiary/cloud/dispatches'))
  assert.equal(call.init.method, 'POST')
  assert.ok(call.init.headers.authorization.startsWith('Bearer gh_tok'))
  const body = JSON.parse(call.init.body)
  assert.equal(body.event_type, 'appiary-build')
  assert.equal(body.client_payload.handoff.token, 'hof_x')
  assert.ok(!JSON.stringify(body).includes('MATCH_PASSWORD'), 'secrets must not travel in dispatch payload')
  await assert.rejects(() =>
    gh.dispatchBuild({ platform: 'ios', config: { server: {} }, handoff: { token: 't', handoffId: 'h' } }), /rendered capacitor config/)
})

await test('08 full pipeline: wrap -> preview -> dispatch -> status', async () => {
  const credStore = new MemoryStore()
  const jobStore = new MemoryStore()
  const vault = new Vault({ masterKey: normalizeMasterKey('m'), store: credStore })
  const appetizeFetch = mockFetch([{ body: { publicKey: 'pk-1' } }])
  const ghFetch = mockFetch([{ status: 204, ok: true, body: null }])
  const pipeline = new Pipeline({
    vault,
    github: new GitHubOrchestrator({ apiToken: 't', repo: 'a/b', fetchImpl: ghFetch.impl }),
    appetize: new AppetizeClient({ apiToken: 't', fetchImpl: appetizeFetch.impl }),
    store: jobStore,
    config: { baseUrl: 'https://api.appiary.dev' }
  })
  const { jobId } = await pipeline.createJob({
    projectId: 'p1',
    webUrl: 'https://demo.lovable.app',
    platform: 'ios',
    appId: 'com.example.demo',
    appName: 'Demo',
    credentials: { appstore: { ASC_KEY_ID: 'K1' } }
  })
  const job = await jobStore.get(jobId)
  assert.equal(job.state, 'wrapped')
  assert.ok(job.credIds.length > 0)
  const preview = await pipeline.createPreview(jobId, { artifactUrl: 'https://cdn/debug.zip' })
  assert.equal(preview.publicKey, 'pk-1')
  const dispatched = await pipeline.dispatch(jobId, { runner: 'bitrise-m4-pro' })
  assert.equal(dispatched.dispatched, true)
  const dispatchBody = JSON.parse(ghFetch.calls[0].init.body)
  assert.equal(dispatchBody.client_payload.baseUrl, 'https://api.appiary.dev')
  assert.equal(dispatchBody.client_payload.jobId, jobId)
  assert.equal(dispatchBody.client_payload.runner, 'bitrise-m4-pro')
  // status callbacks drive the state machine
  const s1 = await pipeline.reportStatus(jobId, { status: 'in_progress' })
  assert.equal(s1.state, 'building')
  const s2 = await pipeline.reportStatus(jobId, { status: 'completed', conclusion: 'success' })
  assert.equal(s2.state, 'submitted')
  // dispatch again must fail: state machine does not rewind
  await assert.rejects(() => pipeline.dispatch(jobId), /dispatch requires state/)
})

await test('09 handoff server: redeem over http, single use enforced', async () => {
  const store = new MemoryStore()
  const vault = new Vault({ masterKey: normalizeMasterKey('m'), store })
  const credId = await vault.putCredential('p', 'appstore', { ASC_KEY_ID: 'K1', ASC_KEY_P8: 'cHg=' })
  const { token } = await vault.issueHandoff([credId], { jobId: 'job_9' })
  const jobs = new MemoryStore()
  await jobs.put('job_9', { id: 'job_9', state: 'dispatched', history: [] })
  const { server, port } = await createHandoffServer({
    vault,
    pipeline: {
      reportStatus: async (jobId, body) => ({ jobId, state: 'building' })
    }
  })
  const redeem = await fetch(`http://127.0.0.1:${port}/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-appiary-handoff': token },
    body: JSON.stringify({ jobId: 'job_9' })
  })
  assert.equal(redeem.status, 200)
  const first = await redeem.json()
  assert.equal(first.env.ASC_KEY_ID, 'K1')
  const second = await fetch(`http://127.0.0.1:${port}/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-appiary-handoff': token },
    body: JSON.stringify({ jobId: 'job_9' })
  })
  assert.equal(second.status, 400)
  const noToken = await fetch(`http://127.0.0.1:${port}/redeem`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'job_9' })
  })
  assert.equal(noToken.status, 401)
  const report = await fetch(`http://127.0.0.1:${port}/report`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: 'job_9', status: 'in_progress' })
  })
  assert.equal(report.status, 200)
  server.close()
})

await test('10 logger redacts secrets and stays lowercase', () => {
  const log = new Log()
  log.info('deploy started', { apiKey: 'supersecret', MATCH_PASSWORD: 'hunter2', note: 'ok' })
  log.info('token blob eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.longsignaturevalue')
  const text = log.lines.join('\n')
  assert.ok(!text.includes('supersecret'))
  assert.ok(!text.includes('hunter2'))
  assert.ok(!text.includes('longsignaturevalue'))
  assert.ok(text.includes('[redacted]'))
  assert.equal(text, text.toLowerCase())
  assert.equal(safeEqual('abc', 'abc'), true)
  assert.equal(safeEqual('abc', 'abd'), false)
  const r = redact({ nested: { token: 'x', count: 3 }, list: [{ secret: 'y' }] })
  assert.equal(r.nested.token, '[redacted]')
  assert.equal(r.nested.count, 3)
  assert.equal(r.list[0].secret, '[redacted]')
})

await test('11 runner assets: workflow redeems before build and shreds after', () => {
  const wf = readFileSync(new URL('../.github/workflows/appiary-build.yml', import.meta.url), 'utf8')
  const redeemIdx = wf.indexOf('redeem single-use credentials')
  const buildIdx = wf.indexOf('build and submit (')
  const shredIdx = wf.indexOf('shred secrets and artifacts')
  assert.ok(redeemIdx > 0, 'workflow must redeem secrets')
  assert.ok(redeemIdx < buildIdx, 'redeem must happen before the build')
  assert.ok(shredIdx > buildIdx, 'shred must happen after the build')
  assert.ok(wf.includes('repository_dispatch'))
  assert.ok(wf.includes('GITHUB_ENV'), 'redeemed values must be exported to the job env')
  assert.ok(wf.includes('client_payload.runner'), 'runner label must be overridable per dispatch')
  assert.ok(wf.includes('timeout-minutes: 45'), 'build timeout must be capped for margin safety')
  assert.ok(wf.includes("source.mode == 'bundle-git'"), 'workflow must clone git sources')
  assert.ok(wf.includes("source.mode == 'bundle-zip'"), 'workflow must fetch zip sources')
  assert.ok(wf.includes('stage-source.js'), 'staging must go through the stage script')
  assert.ok(wf.includes('working-directory: template'), 'native build runs inside the template project')
  assert.ok(wf.includes('init-platforms.sh'), 'platforms regenerate on the runner')
  assert.ok(wf.indexOf('stage www/') < wf.indexOf('sync capacitor project'), 'www must be staged before cap sync')
  assert.ok(wf.indexOf('stage www/') < wf.indexOf('sync capacitor project'), 'www must be staged before cap sync')
  assert.ok(wf.includes('delete-keychain'))
  const fastfile = readFileSync(new URL('../template/fastlane/Fastfile', import.meta.url), 'utf8')
  for (const needle of ['match(', 'gym(', 'deliver(', 'supply(', 'setup_ci', 'readonly: true', 'app_store_connect_api_key']) {
    assert.ok(fastfile.includes(needle), `fastfile missing ${needle}`)
  }
})


await test('12 intake classifies web urls, git repos, and zips', async () => {
  const wrap = classifyIntake({ webUrl: 'https://preview--my-app.lovable.app' })
  assert.equal(wrap.mode, 'wrap')
  assert.equal(wrap.builder, 'lovable')

  const generic = classifyIntake({ webUrl: 'https://example.com/app' })
  assert.equal(generic.mode, 'wrap')
  assert.equal(generic.builder, null)

  const gh = classifyIntake({ repoUrl: 'https://github.com/acme/webapp/tree/main/packages/ui' })
  assert.equal(gh.mode, 'bundle-git')
  assert.equal(gh.repo, 'https://github.com/acme/webapp')
  assert.equal(gh.ref, 'main')

  const gl = normalizeGitRepo('https://gitlab.com/acme/webapp/-/tree/release-2?foo=bar')
  assert.equal(gl.repo, 'https://gitlab.com/acme/webapp')
  assert.equal(gl.ref, 'release-2')

  const bb = normalizeGitRepo('https://bitbucket.org/acme/webapp.git')
  assert.equal(bb.repo, 'https://bitbucket.org/acme/webapp')
  assert.equal(bb.gitHost, 'bitbucket')

  const gitea = normalizeGitRepo('https://gitea.com/acme/webapp/src/branch/dev')
  assert.equal(gitea.repo, 'https://gitea.com/acme/webapp')
  assert.equal(gitea.ref, 'dev')

  const zip = classifyIntake({ zipUrl: 'https://cdn.appiary.dev/u/src-42.zip' })
  assert.equal(zip.mode, 'bundle-zip')

  assert.equal(labelBuilder('https://bolt.new/x'), 'bolt')
  assert.equal(labelBuilder('https://my-app.rork.app'), 'rork')
  assert.equal(labelBuilder('https://preview.a0.dev'), 'a0')
  await assert.rejects(async () => classifyIntake({}), /requires one of/)
  await assert.rejects(async () => normalizeGitRepo('https://gitlab.com/not-a-repo'), /owner\/repo/)
})

await test('13 bundle mode: git sources produce bundled configs and carry source in dispatch', async () => {
  const jobStore = new MemoryStore()
  const ghFetch = mockFetch([{ status: 204, ok: true, body: null }])
  const vault = new Vault({ masterKey: normalizeMasterKey('m'), store: new MemoryStore() })
  const pipeline = new Pipeline({
    vault,
    github: new GitHubOrchestrator({ apiToken: 't', repo: 'a/b', fetchImpl: ghFetch.impl }),
    store: jobStore,
    config: { baseUrl: 'https://api.appiary.dev' }
  })
  const { jobId } = await pipeline.createJob({
    projectId: 'p2',
    repoUrl: 'https://github.com/acme/webapp/tree/main',
    platform: 'ios',
    appId: 'com.appiary.demo',
    appName: 'demo',
    credentials: { appstore: { ASC_KEY_ID: 'K1' } }
  })
  const job = await jobStore.get(jobId)
  assert.equal(job.source.mode, 'bundle-git')
  assert.ok(!job.config.server, 'bundled config must not set server.url')
  assert.equal(job.config.webDir, 'www')
  await pipeline.dispatch(jobId)
  const body = JSON.parse(ghFetch.calls[0].init.body)
  assert.equal(body.client_payload.source.mode, 'bundle-git')
  assert.equal(body.client_payload.source.repo, 'https://github.com/acme/webapp')
})


await test('14 stage-source: flattens workspace-export wrappers and picks build output', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { execFileSync } = await import('node:child_process')
  const stage = (src, dest) =>
    execFileSync('node', [new URL('../scripts/stage-source.js', import.meta.url).pathname, src, dest], { encoding: 'utf8' })

  const tmp = mkdtempSync(join(tmpdir(), 'appiary-stage-'))
  try {
    // codejack-style export: everything wrapped in one top-level folder
    const wrapped = join(tmp, 'exported-workspace')
    mkdirSync(join(wrapped, 'my-lovable-app'), { recursive: true })
    writeFileSync(join(wrapped, 'my-lovable-app', 'package.json'), JSON.stringify({ name: 'x' }))
    mkdirSync(join(wrapped, 'my-lovable-app', 'dist'))
    writeFileSync(join(wrapped, 'my-lovable-app', 'dist', 'index.html'), '<html>wrapped</html>')
    const destA = join(tmp, 'www-a')
    stage(wrapped, destA)
    assert.equal(readFileSync(join(destA, 'index.html'), 'utf8'), '<html>wrapped</html>')

    // nested twice, static site: no package.json, index.html at the bottom
    const nested = join(tmp, 'deep-export')
    mkdirSync(join(nested, 'outer', 'inner'), { recursive: true })
    writeFileSync(join(nested, 'outer', 'inner', 'index.html'), '<html>static</html>')
    const destB = join(tmp, 'www-b')
    stage(nested, destB)
    assert.equal(readFileSync(join(destB, 'index.html'), 'utf8'), '<html>static</html>')

    // not a web app: error is lowercase and non-zero exit
    const notApp = join(tmp, 'not-an-app')
    mkdirSync(notApp)
    writeFileSync(join(notApp, 'readme.md'), 'nope')
    let failed = false
    try {
      execFileSync('node', [new URL('../scripts/stage-source.js', import.meta.url).pathname, notApp, join(tmp, 'www-c')])
    } catch (e) {
      failed = true
      assert.ok(!e.stderr.toString().match(/[A-Z]/), 'stderr must stay lowercase')
    }
    assert.ok(failed, 'staging a non-web-app must fail')
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
})


await test('15 native template: self-contained capacitor project, runner-generated platforms', () => {
  const pkg = JSON.parse(readFileSync(new URL('../template/package.json', import.meta.url), 'utf8'))
  for (const dep of ['@capacitor/cli', '@capacitor/core', '@capacitor/ios', '@capacitor/android', '@capacitor/splash-screen', '@capacitor/status-bar', '@capacitor/browser']) {
    assert.ok(pkg.devDependencies[dep], `template missing ${dep}`)
  }
  const gemfile = readFileSync(new URL('../template/Gemfile', import.meta.url), 'utf8')
  assert.ok(gemfile.includes('fastlane'), 'gemfile must pin fastlane')
  const init = readFileSync(new URL('../template/scripts/init-platforms.sh', import.meta.url), 'utf8')
  for (const needle of ['cap add ios', 'cap add android', 'cap sync', 'deliberately not committed']) {
    assert.ok(init.includes(needle), `init script missing ${needle}`)
  }
  const stub = readFileSync(new URL('../template/www/index.html', import.meta.url), 'utf8')
  assert.ok(stub.toLowerCase().includes('<!doctype html>'), 'www placeholder must be a real page')
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  process.exitCode = 1
}
