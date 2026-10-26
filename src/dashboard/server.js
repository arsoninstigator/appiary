/**
 * the appiary dashboard server (v1.1).
 *
 * a thin http surface over the real modules - no framework, matching
 * handoff-server.js. every step that needs external keys (appetize,
 * github) reads env at CALL time and answers honestly (503 + reason)
 * when unconfigured, so the dashboard is fully usable in dev for
 * intake, icon generation, and job state, and degrades loudly rather
 * than pretending.
 *
 *   node src/dashboard/server.js          # port 0 -> prints the port
 *   PORT=8080 node src/dashboard/server.js
 */
import http from 'node:http'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { validateWebUrl, renderCapacitorConfig, renderBundledConfig } from '../wrapper.js'
import { classifyIntake } from '../intake.js'
import { STATES } from '../pipeline.js'
import { MemoryStore } from '../store.js'
import { generateIconSet } from '../icon-service.js'
import { AppetizeClient, embedUrlFor } from '../appetize.js'
import { GitHubOrchestrator } from '../github.js'
import { Vault } from '../vault.js'
import { normalizeMasterKey } from '../vault/crypto.js'

const fromBase64 = (b64) => Buffer.from(String(b64), 'base64')

export function startDashboard({
  store = new MemoryStore(),
  dataRoot = join(tmpdir(), 'appiary-dashboard'),
  env = process.env,
  log = console,
  fetchImpl = undefined
} = {}) {
  mkdirSync(dataRoot, { recursive: true })

  const jobs = new Map()
  /* per-job artifact upload tokens - kept OUT of job objects so list/detail
     responses never leak them; publish hands the token to the runner inside
     the dispatch payload, and the runner presents it on artifact upload. */
  const jobTokens = new Map()
  const vault = env.APPIARY_MASTER_KEY
    ? new Vault({ masterKey: normalizeMasterKey(env.APPIARY_MASTER_KEY), store })
    : null

  const jobDir = (id) => {
    const d = join(dataRoot, id)
    mkdirSync(d, { recursive: true })
    return d
  }

  async function readBody(req, limit = 12 * 1024 * 1024) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) throw Object.assign(new Error('body too large'), { status: 413 })
      chunks.push(chunk)
    }
    return Buffer.concat(chunks)
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  async function handleApi(req, res, url) {
    /* ---- intake: create a job ---- */
    if (req.method === 'POST' && url.pathname === '/api/wrap') {
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const { mode = 'url', appId, appName, version = '0.1.0', permissions = [] } = body
      if (!appId || !/^[a-z][a-z0-9_]*(\.[a-z0-9_]+){2,}$/.test(appId)) {
        return json(res, 400, { error: 'appId must be reverse-dns (com.example.app)' })
      }
      if (!appName) return json(res, 400, { error: 'appName required' })

      let source = null
      if (mode === 'url') {
        if (!body.url) return json(res, 400, { error: 'url required for url mode' })
        try {
          const parsed = validateWebUrl(body.url)
          source = { kind: 'url', url: parsed.href }
        } catch (e) {
          return json(res, 400, { error: e.message })
        }
      } else if (mode === 'zip') {
        const zip = fromBase64(body.zipBase64 || '')
        if (zip.length < 4 || zip[0] !== 0x50 || zip[1] !== 0x4b) {
          return json(res, 400, { error: 'zipBase64 must be a real zip (bundle mode)' })
        }
        source = { kind: 'zip', bytes: zip.length }
      } else if (mode === 'git') {
        try {
          const git = classifyIntake({ repoUrl: body.repoUrl, ref: body.ref })
          source = { kind: 'git', repo: git.repo, ref: git.ref, gitHost: git.gitHost }
        } catch (e) {
          return json(res, 400, { error: e.message })
        }
      } else {
        return json(res, 400, { error: 'mode must be url, zip, or git' })
      }

      const id = randomUUID()
      const dir = jobDir(id)
      const config = { appId, appName, version, permissions, intake: source.kind }
      if (source.kind === 'url') config.url = source.url
      if (source.kind === 'zip') writeFileSync(join(dir, 'source.zip'), fromBase64(body.zipBase64))
      if (source.kind === 'git') config.repoUrl = body.repoUrl
      writeFileSync(join(dir, 'capacitor.config.json'), JSON.stringify(config, null, 2))

      const job = {
        id, state: 'wrapped', mode: source.kind, appId, appName, version, permissions,
        createdAt: new Date().toISOString()
      }
      jobs.set(id, job)
      jobTokens.set(id, randomUUID())
      log.log(`== dashboard: wrapped ${appId} (${source.kind}) ${id}`)
      return json(res, 200, { job })
    }

    /* ---- icon generation for a job ---- */
    const iconMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/icon$/)
    if (req.method === 'POST' && iconMatch) {
      const job = jobs.get(iconMatch[1])
      if (!job) return json(res, 404, { error: 'no such job' })
      const png = await readBody(req, 8 * 1024 * 1024)
      if (png.length < 8 || png[1] !== 0x50 || png[2] !== 0x4e) {
        return json(res, 400, { error: 'body must be a png' })
      }
      try {
        const files = await generateIconSet(png, { background: 'rgba(255,255,255,0)' })
        const dir = jobDir(job.id)
        for (const f of files) {
          const p = join(dir, 'iconset', f.path)
          mkdirSync(join(p, '..'), { recursive: true })
          writeFileSync(p, f.data)
        }
        job.iconset = { files: files.length, generatedAt: new Date().toISOString() }
        log.log(`== dashboard: iconset generated for ${job.appId} (${files.length} files)`)
        return json(res, 200, { iconset: job.iconset })
      } catch (e) {
        return json(res, 400, { error: e.message })
      }
    }

    /* ---- preview: appetize streaming ---- */
    const previewMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/preview$/)
    if (req.method === 'POST' && previewMatch) {
      const job = jobs.get(previewMatch[1])
      if (!job) return json(res, 404, { error: 'no such job' })
      if (!env.APPETIZE_API_KEY) {
        return json(res, 503, { error: 'appetize key not configured (APPETIZE_API_KEY) - preview unavailable' })
      }
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      /* preview-after-real-builds: the runner posts the built artifact to
         /artifact on completion; appetize fetches from a url, so the
         dashboard hands it this server's own public route. requires the
         dashboard to be publicly reachable (APPIARY_DASHBOARD_URL or the
         request host); a laptop localhost cannot be fetched by appetize. */
      let artifactUrl = body.artifactUrl
      if (!artifactUrl && job.artifact) {
        const base = env.APPIARY_DASHBOARD_URL || `http://${req.headers.host}`
        artifactUrl = `${base}/api/jobs/${job.id}/artifact`
      }
      if (!artifactUrl || !/^https?:\/\//.test(artifactUrl)) {
        return json(res, 400, { error: 'artifactUrl required - publish first so the runner uploads the build artifact, or pass one explicitly' })
      }
      const platform = body.platform || 'android'
      const client = new AppetizeClient({ apiToken: env.APPETIZE_API_KEY, fetchImpl })
      const pub = await client.publishApp({ platform, artifactUrl })
      job.state = 'previewing'
      job.previewUrl = pub.embedUrl || embedUrlFor(pub.publicKey)
      return json(res, 200, { job })
    }

    /* ---- publish: dispatch the cloud compile ---- */
    const publishMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/publish$/)
    if (req.method === 'POST' && publishMatch) {
      const job = jobs.get(publishMatch[1])
      if (!job) return json(res, 404, { error: 'no such job' })
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      const platform = body.platform || 'android'
      if (!['ios', 'android'].includes(platform)) return json(res, 400, { error: 'platform must be ios or android' })
      if (!env.APPIARY_GITHUB_TOKEN || !env.APPIARY_GITHUB_REPO) {
        return json(res, 503, { error: 'github dispatch not configured (APPIARY_GITHUB_TOKEN / APPIARY_GITHUB_REPO) - publish unavailable' })
      }
      if (!vault) {
        return json(res, 503, { error: 'vault not configured (APPIARY_MASTER_KEY) - publish unavailable' })
      }
      if (!job.credIds || job.credIds.length === 0) {
        return json(res, 409, { error: 'no credentials stored for this job - intake store credentials first (POST /api/jobs/:id/credentials)' })
      }
      const handoff = await vault.issueHandoff(job.credIds, { jobId: job.id })
      const gh = new GitHubOrchestrator({ apiToken: env.APPIARY_GITHUB_TOKEN, repo: env.APPIARY_GITHUB_REPO, fetchImpl })
      /* the runner needs the rendered capacitor config (server.url for wrap
         mode, none for bundle mode), not the raw intake record */
      const stored = JSON.parse(readFileSync(join(jobDir(job.id), 'capacitor.config.json'), 'utf8'))
      const config = stored.url
        ? renderCapacitorConfig({ webUrl: stored.url, appId: stored.appId, appName: stored.appName, version: stored.version, permissions: stored.permissions }).config
        : renderBundledConfig({ appId: stored.appId, appName: stored.appName, version: stored.version, permissions: stored.permissions }).config
      const artifactBase = env.APPIARY_DASHBOARD_URL || `http://${req.headers.host}`
      const result = await gh.dispatchBuild({
        platform,
        config,
        metadata: {
          jobId: job.id,
          releaseTrack: body.releaseTrack || 'internal',
          artifactBase,
          artifactToken: jobTokens.get(job.id)
        },
        baseUrl: env.APPIARY_HANDOFF_URL || 'http://localhost:0',
        jobId: job.id,
        runner: body.runner || null,
        handoff
      })
      job.state = 'dispatched'
      job.dispatchedAt = new Date().toISOString()
      log.log(`== dashboard: dispatched ${job.appId} (${platform})`)
      return json(res, 200, { job, dispatch: result })
    }

    /* ---- credential intake: the owner's store keys, vaulted ---- */
    const credMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/credentials$/)
    if (req.method === 'POST' && credMatch) {
      const job = jobs.get(credMatch[1])
      if (!job) return json(res, 404, { error: 'no such job' })
      if (!vault) {
        return json(res, 503, { error: 'vault not configured (APPIARY_MASTER_KEY) - credential intake unavailable' })
      }
      const body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
      if (!body.kind) return json(res, 400, { error: 'credential kind required (e.g. appleApi, playJson)' })
      const id = await vault.putCredential(job.id, body.kind, body)
      job.credIds = [...(job.credIds || []), id]
      log.log(`== dashboard: credential ${body.kind} vaulted for ${job.appId}`)
      return json(res, 200, { credentialId: id })
    }

    /* ---- artifact lane: the runner posts the built binary here ---- */
    const artifactMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)\/artifact$/)
    if (req.method === 'POST' && artifactMatch) {
      const job = jobs.get(artifactMatch[1])
      if (!job) return json(res, 404, { error: 'no such job' })
      const token = jobTokens.get(job.id)
      if (!token || req.headers['x-appiary-job-token'] !== token) {
        return json(res, 401, { error: 'artifact upload requires the job token (x-appiary-job-token, handed to the runner at dispatch)' })
      }
      const bytes = await readBody(req, 200 * 1024 * 1024)
      if (bytes.length < 4) return json(res, 400, { error: 'empty artifact' })
      const dir = join(jobDir(job.id), 'artifact')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'app-build.bin'), bytes)
      job.artifact = { bytes: bytes.length, receivedAt: new Date().toISOString(), filename: 'app-build.bin' }
      log.log(`== dashboard: artifact received for ${job.appId} (${bytes.length} bytes)`)
      return json(res, 200, { artifact: job.artifact })
    }
    if (req.method === 'GET' && artifactMatch) {
      const job = jobs.get(artifactMatch[1])
      if (!job) return json(res, 404, { error: 'no such job' })
      const p = join(jobDir(job.id), 'artifact', 'app-build.bin')
      if (!existsSync(p)) return json(res, 404, { error: 'no artifact yet' })
      const bytes = readFileSync(p)
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length })
      return res.end(bytes)
    }

    /* ---- job reads ---- */
    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      return json(res, 200, { jobs: [...jobs.values()], states: STATES })
    }
    const jobMatch = url.pathname.match(/^\/api\/jobs\/([a-f0-9-]+)$/)
    if (req.method === 'GET' && jobMatch) {
      const job = jobs.get(jobMatch[1])
      if (!job) return json(res, 404, { error: 'no such job' })
      return json(res, 200, { job })
    }

    return json(res, 404, { error: 'no such api route' })
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost')
    try {
      if (url.pathname === '/' || url.pathname === '/index.html') {
        const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8')
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        return res.end(html)
      }
      if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url)
      res.writeHead(404).end('not found')
    } catch (e) {
      json(res, e.status || 500, { error: e.message })
    }
  })

  return new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port
      resolve({ server, port, jobs, jobTokens })
    })
  })
}

/* run directly: serve */
const isMain = process.argv[1] && process.argv[1].endsWith('server.js')
if (isMain) {
  const { server, port } = await startDashboard()
  console.log(`== appiary dashboard on http://localhost:${port}`)
}
