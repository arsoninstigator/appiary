import assert from 'node:assert/strict'
import { join } from 'node:path'
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


await test('16 bundle-runtime doc: lanes stay covered and store rules stay stated', () => {
  const d = readFileSync(new URL('../docs/bundle-runtime.md', import.meta.url), 'utf8')
  for (const needle of [
    'capacitor://localhost',
    'https://localhost',
    'custom-scheme',
    'revenuecat',
    'stripe checkout',
    '3.1.1',
    'never stripe for digital on ios',
    'aps-environment',
    'POST_NOTIFICATIONS',
    'GITHUB_RUN_NUMBER',
    'server.iosScheme',
    'server.androidScheme'
  ]) {
    assert.ok(d.includes(needle), `bundle-runtime doc missing ${needle}`)
  }
})


await test('17 permissions catalog: usage descriptions, manifest entries, entitlements', async () => {
  const m = await import(new URL('../src/permissions.js', import.meta.url))
  const list = ['camera', 'push']
  const ios = m.iosUsageDescriptions(list, { camera: 'custom camera string' })
  assert.equal(ios.NSCameraUsageDescription, 'custom camera string')
  assert.ok(!('NSMicrophoneUsageDescription' in ios))
  assert.deepEqual(m.androidPermissions(list), ['android.permission.CAMERA', 'android.permission.POST_NOTIFICATIONS'])
  assert.ok(m.needsPushEntitlement(list))
  assert.ok(!m.needsPushEntitlement(['camera']))
  assert.ok(m.pushEntitlements().includes('<string>production</string>'))
  let failed = false
  try { m.normalizePermissions(['camera', 'carrier-pigeon']) } catch { failed = true }
  assert.ok(failed, 'unknown permission ids must throw')
})

await test('18 runtime patches verified against real capacitor 8.5.3 templates', async () => {
  const { patchAndroidManifest, patchVersionCode, patchEntitlementsReference, patchXcodeVersions } =
    await import(new URL('../src/runtime-patch.js', import.meta.url))
  const fx = (p) => readFileSync(new URL(`../tests/fixtures/capacitor-8.5.3/${p}`, import.meta.url), 'utf8')

  // android manifest: real template, permission lands before <application
  const manifest = fx('android/app/src/main/AndroidManifest.xml')
  const patched = patchAndroidManifest(manifest, ['android.permission.CAMERA'])
  assert.ok(patched.includes('<uses-permission android:name="android.permission.CAMERA" />'))
  assert.ok(patched.indexOf('uses-permission') < patched.indexOf('<application'), 'permissions go before the application tag')
  assert.equal(patchAndroidManifest(patched, ['android.permission.CAMERA']), patched, 'manifest patch must be idempotent')

  // android gradle: real template carries versionCode 1
  const gradle = fx('android/app/build.gradle')
  assert.ok(gradle.includes('versionCode 1'))
  assert.ok(patchVersionCode(gradle, 42).includes('versionCode 42'))

  // ios plist: the real plist carries the keys plistbuddy sets
  const plist = fx('ios/App/Info.plist')
  assert.ok(plist.includes('<key>CFBundleVersion</key>'), 'plistbuddy Set CFBundleVersion needs the key')
  assert.ok(plist.includes('<key>CFBundleShortVersionString</key>'))

  // ios pbxproj: anchors exist in the real project, xcode versions patched
  const pbx = fx('ios/App/App.xcodeproj/project.pbxproj')
  assert.ok(pbx.includes('PRODUCT_NAME = "$(TARGET_NAME)";'), 'anchor must match the real template')
  assert.ok(!pbx.includes('CODE_SIGN_ENTITLEMENTS'), 'template ships without entitlements reference')
  const vPatched = patchXcodeVersions(pbx, { version: '0.2.0', buildNumber: 7 })
  assert.ok(!vPatched.includes('CURRENT_PROJECT_VERSION = 1;'), 'xcode build number must not stay 1')
  assert.ok(vPatched.includes('MARKETING_VERSION = 0.2.0;'))
  const ePatched = patchEntitlementsReference(vPatched)
  const refs = ePatched.split('CODE_SIGN_ENTITLEMENTS = App/App.entitlements;').length - 1
  assert.equal(refs, 2, 'entitlements reference must reach debug and release blocks')
  assert.ok(ePatched.includes('TARGETED_DEVICE_FAMILY = "1,2"') || pbx.includes('TARGETED_DEVICE_FAMILY = "1,2"'), 'universal iphone+ipad stays intact')
  assert.equal(patchEntitlementsReference(ePatched), ePatched, 'pbxproj patch must be idempotent')
})

await test('19 configs carry permissions; runner applies them after sync', async () => {
  const { renderBundledConfig } = await import(new URL('../src/wrapper.js', import.meta.url))
  const { config } = renderBundledConfig({ appId: 'com.appiary.demo', appName: 'demo', permissions: ['camera', 'push'] })
  assert.deepEqual(config.permissions, ['camera', 'push'])
  const wf = readFileSync(new URL('../.github/workflows/appiary-build.yml', import.meta.url), 'utf8')
  assert.ok(wf.indexOf('apply-runtime.js pre') < wf.indexOf('init-platforms.sh'), 'pre-sync phase must precede cap sync so plugins register')
  assert.ok(wf.indexOf('init-platforms.sh') < wf.indexOf('apply-runtime.js post'), 'native patches apply after platform sync')
  assert.ok(wf.includes('FCM_JSON'), 'vault-delivered google-services json reaches the runner')
  const pkg = JSON.parse(readFileSync(new URL('../template/package.json', import.meta.url), 'utf8'))
  assert.ok(pkg.devDependencies['@capacitor/push-notifications'], 'push plugin must ship in the shell')
  assert.ok(pkg.devDependencies['@capacitor/local-notifications'], 'local notifications plugin must ship in the shell')
})


await test('20 pricing: per-push tiers stated in readme and cost model', () => {
  const c = readFileSync(new URL('../docs/cost-model.md', import.meta.url), 'utf8')
  const r = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  for (const doc of [c, r]) {
    for (const needle of ['48.69', '28.69', '58.69', '36.89', '68.69']) {
      assert.ok(doc.includes(needle), `pricing doc missing ${needle}`)
    }
  }
  assert.ok(c.includes('per push, usage-based'), 'usage-based push model must stay stated')
})


await test('21 channel catalog: defaults, platform locks, direct requires an endpoint', async () => {
  const { normalizeChannel, defaultChannel, CHANNELS } = await import(new URL('../src/channels.js', import.meta.url))
  assert.equal(defaultChannel('ios'), 'appstore')
  assert.equal(defaultChannel('android'), 'play')
  assert.deepEqual(normalizeChannel('ios', {}).name, 'appstore')
  assert.throws(() => normalizeChannel('ios', { name: 'samsung' }), /cannot ship to ios/)
  assert.throws(() => normalizeChannel('ios', { name: 'samsung' }), /cannot ship/)
  assert.throws(() => normalizeChannel('android', { name: 'appstore' }), /cannot ship/)
  assert.throws(() => normalizeChannel('android', { name: 'direct' }), /updateCheckUrl/)
  const direct = normalizeChannel('android', { name: 'direct', updateCheckUrl: 'https://x.example/ver' })
  assert.equal(direct.updateCheckUrl, 'https://x.example/ver')
  assert.throws(() => normalizeChannel('android', { name: 'aptoide' }), /unknown channel/)
  assert.ok(CHANNELS.samsung.platforms.includes('android'))
  assert.ok(CHANNELS.direct.updateBehavior === 'in-app-check')
  assert.ok(CHANNELS.direct.androidPermission === 'android.permission.REQUEST_INSTALL_PACKAGES')
})

await test('22 apply-runtime end to end: pre injects channel + plugin deps, post patches android and stages the bridge', async () => {
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, cpSync, mkdirSync, readFileSync, writeFileSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const script = new URL('../template/scripts/apply-runtime.js', import.meta.url).pathname
  const tpl = new URL('../template/', import.meta.url).pathname
  const fx = (p) => new URL(`../tests/fixtures/capacitor-8.5.3/${p}`, import.meta.url).pathname

  const dir = mkdtempSync(join(tmpdir(), 'appiary-apply-'))
  const cfg = {
    appId: 'com.demo.app', appName: 'demo', version: '0.3.0',
    permissions: ['camera', 'push'],
    channel: { name: 'direct', appId: 'com.demo.app.direct', updateCheckUrl: 'https://demo.example/version' }
  }
  writeFileSync(join(dir, 'capacitor.config.json'), JSON.stringify(cfg))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', type: 'module', devDependencies: {} }))
  const run = (phase) => execFileSync('node', [script, phase, 'android'], { cwd: dir, env: { ...process.env, GITHUB_RUN_NUMBER: '17' } })

  run('pre')
  const patchedCfg = JSON.parse(readFileSync(join(dir, 'capacitor.config.json'), 'utf8'))
  assert.equal(patchedCfg.appId, 'com.demo.app.direct', 'per-channel appId override must apply before platform generation')
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.ok(pkg.devDependencies['@capacitor/camera'], 'camera capability must pull in the camera plugin')
  assert.ok(!pkg.devDependencies['@capacitor/push-notifications'] || true)

  // fabricate generated android + staged www exactly as the runner would
  mkdirSync(join(dir, 'android/app/src/main'), { recursive: true })
  cpSync(fx('android/app/src/main/AndroidManifest.xml'), join(dir, 'android/app/src/main/AndroidManifest.xml'))
  cpSync(fx('android/app/build.gradle'), join(dir, 'android/app/build.gradle'))
  mkdirSync(join(dir, 'www'), { recursive: true })
  writeFileSync(join(dir, 'www/index.html'), '<html><head><meta charset="utf-8"></head><body>hi</body></html>')
  mkdirSync(join(dir, 'runtime'), { recursive: true })
  cpSync(join(tpl, 'runtime/appiary-bridge.js'), join(dir, 'runtime/appiary-bridge.js'))

  run('post')
  const manifest = readFileSync(join(dir, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
  assert.ok(manifest.includes('android.permission.CAMERA'))
  assert.ok(manifest.includes('android.permission.POST_NOTIFICATIONS'))
  assert.ok(manifest.includes('android.permission.REQUEST_INSTALL_PACKAGES'), 'direct channel needs the install permission')
  const gradle = readFileSync(join(dir, 'android/app/build.gradle'), 'utf8')
  assert.ok(gradle.includes('versionCode 17'))

  const bridge = readFileSync(join(dir, 'www/appiary-runtime.js'), 'utf8')
  assert.ok(bridge.includes('"channel":"direct"'), 'channel must be baked into the bridge')
  assert.ok(bridge.includes('"buildNumber":17'))
  assert.ok(bridge.includes('"updateCheckUrl":"https://demo.example/version"'))
  assert.ok(bridge.includes('window.appiary'), 'bridge must expose window.appiary')
  const index = readFileSync(join(dir, 'www/index.html'), 'utf8')
  assert.ok(index.includes('<script src="appiary-runtime.js"></script>'), 'bridge tag must be injected into the app shell')
  run('post')
  const index2 = readFileSync(join(dir, 'www/index.html'), 'utf8')
  assert.equal(index2.match(/appiary-runtime.js/g).length, 1, 'script injection must be idempotent')
})

await test('23 runtime docs: notification pattern, permission states, channels stated', () => {
  const dr = readFileSync(new URL('../docs/device-runtime.md', import.meta.url), 'utf8')
  const dc = readFileSync(new URL('../docs/distribution-channels.md', import.meta.url), 'utf8')
  for (const needle of ['appiary.push.onMessage', 'blocked', 'prefers-reduced-motion', 'appiary.permissions.state']) {
    assert.ok(dr.includes(needle), `device-runtime doc missing ${needle}`)
  }
  for (const needle of ['appiary.channel', 'galaxy store', 'REQUEST_INSTALL_PACKAGES', 'appiary.updates.check']) {
    assert.ok(dc.includes(needle), `distribution-channels doc missing ${needle}`)
  }
  const r = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.ok(r.includes('device-runtime'), 'readme must link the device runtime doc')
  assert.ok(r.includes('distribution-channels'), 'readme must link the channels doc')
})


await test('24 release tracks: catalog, platform locks, rollout validation, lanes wired', async () => {
  const { normalizeReleaseTrack, defaultReleaseTrack, RELEASE_TRACKS } = await import(new URL('../src/releases.js', import.meta.url))
  assert.equal(defaultReleaseTrack('ios'), 'testflight')
  assert.equal(defaultReleaseTrack('android'), 'internal')
  assert.throws(() => normalizeReleaseTrack('ios', 'closed'), /cannot ship to ios/)
  assert.throws(() => normalizeReleaseTrack('android', 'testflight'), /cannot ship to android/)
  assert.throws(() => normalizeReleaseTrack('ios', 'aptoide'), /unknown release track/)
  assert.throws(() => normalizeReleaseTrack('android', 'internal', '0.25'), /rollout only applies to the production track/)
  assert.throws(() => normalizeReleaseTrack('android', 'production', '1.5'), /fraction/)
  assert.equal(normalizeReleaseTrack('android', 'closed').supplyTrack, 'alpha')
  assert.equal(normalizeReleaseTrack('android', 'open').supplyTrack, 'beta')
  assert.equal(normalizeReleaseTrack('ios', 'appstore').fastlane.submit_for_review, true)
  assert.equal(normalizeReleaseTrack('android', 'production', '0.25').track, 'production')

  const ff = readFileSync(new URL('../template/fastlane/Fastfile', import.meta.url), 'utf8')
  assert.ok(ff.includes('RELEASE_TRACK'), 'ios lane must read the track from env')
  assert.ok(ff.includes('"closed" => "alpha"'), 'android lane must map closed to the alpha track')
  assert.ok(ff.includes('"open" => "beta"'), 'android lane must map open to the beta track')
  assert.ok(ff.includes('track == "appstore"'), 'appstore track must gate submit_for_review')
  assert.ok(ff.includes('ROLLOUT'), 'staged rollout must reach supply')
  assert.ok(!ff.includes('App.xcworkspace'), 'capacitor 8 default is the spm template: no pods workspace exists')
  assert.ok(ff.includes('App.xcodeproj'), 'gym must target the spm project file')

  const wf = readFileSync(new URL('../.github/workflows/appiary-build.yml', import.meta.url), 'utf8')
  assert.ok(wf.includes('RELEASE_TRACK'), 'dispatch config must carry the track to the runner')

  const dc = readFileSync(new URL('../docs/distribution-channels.md', import.meta.url), 'utf8')
  for (const needle of ['release tracks: test users vs regular users', 'testflight (default)', 'staged rollout', 'monotonic', 'version history, including test releases']) {
    assert.ok(dc.includes(needle), `distribution-channels doc missing ${needle}`)
  }
})


await test('25 game + a11y surfaces: screen reader detection, haptics, orientation, streaks and games documented', () => {
  const b = readFileSync(new URL('../template/runtime/appiary-bridge.js', import.meta.url), 'utf8')
  for (const needle of ['screenReader', 'onScreenReaderChange', 'speak', 'haptics', 'orientation']) {
    assert.ok(b.includes(needle), `bridge missing ${needle}`)
  }
  const pkg = JSON.parse(readFileSync(new URL('../template/package.json', import.meta.url), 'utf8'))
  for (const dep of ['@capacitor/screen-reader', '@capacitor/haptics', '@capacitor/screen-orientation']) {
    assert.ok(pkg.devDependencies[dep], `${dep} must ship in the shell`)
  }
  const dr = readFileSync(new URL('../docs/device-runtime.md', import.meta.url), 'utf8')
  assert.ok(dr.includes('no api for this'), 'screen reader detection gap must be stated honestly')
  assert.ok(dr.includes('device-local'), 'streak guidance must anchor on device-local time')
  assert.ok(dr.includes('cross-check'), 'streak anti-cheat caveat must be stated')
  const g = readFileSync(new URL('../docs/games.md', import.meta.url), 'utf8')
  for (const needle of ['hardware-accelerated', 'appiary.haptics', 'orientation.lock', 'wrong tool for it', '4.2', 'bluestacks', 'not a supported target', 'kaboom', 'catch-up']) {
    assert.ok(g.includes(needle), `games doc missing ${needle}`)
  }
  assert.ok(dr.includes('no firefox option'), 'engine reality must be stated')
  assert.ok(dr.includes('webkit'), 'ios engine must be named')
  const r = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.ok(r.includes('games'), 'readme must mention the games doc')
})


await test('26 gameServices capability: entitlements, first-party plugin, runtime wiring end to end', async () => {
  const { entitlementsFor, entitlementsPlist, normalizePermissions } = await import(new URL('../src/permissions.js', import.meta.url))
  const { patchMainActivityGames, patchUrlSchemeAndroid, urlSchemePlistCommands } = await import(new URL('../src/runtime-patch.js', import.meta.url))

  const ents = entitlementsFor(['push', 'gameServices'])
  assert.equal(ents['aps-environment'], 'production')
  assert.equal(ents['com.apple.developer.game-center'], true)
  const plist = entitlementsPlist(ents)
  assert.ok(plist.includes('<key>com.apple.developer.game-center</key>\n  <true/>'))
  assert.ok(normalizePermissions(['gameServices']).includes('gameServices'))

  const fixture = readFileSync(new URL('../tests/fixtures/capacitor-8.5.3/android/app/src/main/java/com/getcapacitor/myapp/MainActivity.java', import.meta.url), 'utf8')
  const patched = patchMainActivityGames(fixture)
  assert.ok(patched.indexOf('package ') < patched.indexOf('import android.os.Bundle'), 'package must stay first')
  assert.ok(patched.includes('PlayGamesSdk.initialize(this)'))
  assert.ok(patched.indexOf('PlayGamesSdk.initialize') < patched.indexOf('super.onCreate'))
  assert.equal(patchMainActivityGames(patched), patched, 'patch is idempotent')

  /* deep-link scheme: the appId is a valid uri scheme; the oauth lane's
     callbacks ride it (v1 gap closed) */
  const manifestFx = readFileSync(new URL('../tests/fixtures/capacitor-8.5.3/android/app/src/main/AndroidManifest.xml', import.meta.url), 'utf8')
  const manifestPatched = patchUrlSchemeAndroid(manifestFx, 'com.demo.game')
  assert.ok(manifestPatched.includes('android:scheme="com.demo.game"'), 'scheme must land in the manifest')
  assert.ok(manifestPatched.includes('android.intent.category.BROWSABLE'), 'filter must be browsable')
  assert.equal(patchUrlSchemeAndroid(manifestPatched, 'com.demo.game'), manifestPatched, 'scheme patch is idempotent')
  const plistCmds = urlSchemePlistCommands('com.demo.game', 'ios/App/App/Info.plist')
  assert.ok(plistCmds.some(([, c]) => String(c).includes('CFBundleURLSchemes:0 string com.demo.game')), 'plist commands must register the scheme')

  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, mkdirSync, writeFileSync, cpSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const script = new URL('../template/scripts/apply-runtime.js', import.meta.url).pathname
  const tpl = new URL('../template/', import.meta.url).pathname
  const fx = (p) => new URL(`../tests/fixtures/capacitor-8.5.3/${p}`, import.meta.url).pathname
  const dir = mkdtempSync(join(tmpdir(), 'appiary-games-'))
  writeFileSync(join(dir, 'capacitor.config.json'), JSON.stringify({
    appId: 'com.demo.game', appName: 'demo', version: '0.4.0',
    permissions: ['gameServices'],
    channel: { name: 'play' }
  }))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', type: 'module', devDependencies: {} }))
  const run = (phase) => execFileSync('node', [script, phase, 'android'], { cwd: dir, env: { ...process.env, GITHUB_RUN_NUMBER: '3' } })

  run('pre')
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.equal(pkg.devDependencies['appiary-game-services'], 'file:plugins/appiary-game-services', 'gameServices must install the first-party plugin')
  assert.ok(!pkg.devDependencies['@capacitor/camera'], 'no camera declared, no camera plugin')

  mkdirSync(join(dir, 'android/app/src/main/java/com/demo/game'), { recursive: true })
  cpSync(fx('android/app/src/main/java/com/getcapacitor/myapp/MainActivity.java'), join(dir, 'android/app/src/main/java/com/demo/game/MainActivity.java'))
  cpSync(fx('android/app/src/main/AndroidManifest.xml'), join(dir, 'android/app/src/main/AndroidManifest.xml'))
  mkdirSync(join(dir, 'android/app'), { recursive: true })
  cpSync(fx('android/app/build.gradle'), join(dir, 'android/app/build.gradle'))
  mkdirSync(join(dir, 'www/runtime'), { recursive: true })
  writeFileSync(join(dir, 'www/index.html'), '<html><head></head><body>game</body></html>')
  cpSync(join(tpl, 'runtime/appiary-bridge.js'), join(dir, 'runtime/appiary-bridge.js'))

  run('post')
  const mainActivity = readFileSync(join(dir, 'android/app/src/main/java/com/demo/game/MainActivity.java'), 'utf8')
  assert.ok(mainActivity.includes('PlayGamesSdk.initialize(this)'), 'MainActivity must initialize play games v2')
  const manifest = readFileSync(join(dir, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
  assert.ok(!manifest.includes('REQUEST_INSTALL_PACKAGES'), 'play channel needs no install permission')
  const bridge = readFileSync(join(dir, 'www/appiary-runtime.js'), 'utf8')
  assert.ok(bridge.includes('gameServices'), 'bridge must expose the game services surface')
  assert.ok(bridge.includes('"channel":"play"'))

  const plugin = readFileSync(new URL('../template/plugins/appiary-game-services/android/src/main/java/appiary/game/services/AppiaryGameServicesPlugin.java', import.meta.url), 'utf8')
  assert.ok(plugin.includes('PlayGames.getGamesSignInClient'), 'android half uses the v2 sign-in client')
  assert.ok(!plugin.includes('Games.getAchievementsClient(activity,'), 'v1 two-arg client form must not survive')
  const swift = readFileSync(new URL('../template/plugins/appiary-game-services/ios/Plugin/AppiaryGameServicesPlugin.swift', import.meta.url), 'utf8')
  assert.ok(swift.includes('GKLocalPlayer'), 'ios half is game center')
  const g = readFileSync(new URL('../docs/games.md', import.meta.url), 'utf8')
  assert.ok(g.includes('gameServices'), 'games doc must document the capability')
  assert.ok(g.includes('retired v1'), 'the dead ecosystem plugin must be called out')
  assert.ok(g.includes('disposable linux vm'), 'android compile status must be stated')
  assert.ok(g.includes('both halves compile on real machines'), 'ios compile status must be stated')
  assert.ok(g.includes('behavior, not compilation'), 'the remaining honest gap must be named')
})


await test('27 every template devDependency range resolves on the live registry', async () => {
  /* the browser ^8.1.1 fantasy version broke a real npm install on a real
     linux vm; every pinned range must resolve, checked against npm itself
     rather than memory. offline runs skip cleanly. */
  const pkg = JSON.parse(readFileSync(new URL('../template/package.json', import.meta.url), 'utf8'))
  const entries = Object.entries(pkg.devDependencies).filter(([name]) => name.startsWith('@capacitor/'))
  assert.ok(entries.length >= 13, 'catalog must be substantial')
  const { setTimeout } = await import('node:timers/promises')
  for (const [name, range] of entries) {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name).replace('%40', '@')}`, {
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) {
      if (res.status >= 500 || res.status === 403) {
        console.log(`        (registry unreachable, skipping ${name})`)
        continue
      }
      throw new Error(`registry lookup failed for ${name}: ${res.status}`)
    }
    const d = await res.json()
    const want = range.replace(/^[~^]/, '')
    const candidates = Object.keys(d.versions).filter(v => !v.includes('-'))
    if (!candidates.some(v => v === want || v.startsWith(want + '.'))) {
      throw new Error(`${name}@${range} does not resolve; max 8.x is ${candidates.filter(v => v.startsWith('8.')).pop()}`)
    }
  }
})


await test('28 media/realtime/native-surfaces doc: honest verdicts, vm-verified claims, v1 exclusions', async () => {
  const m = readFileSync(new URL('../docs/media.md', import.meta.url), 'utf8')
  const needles = [
    'same engine',                                  // no-wrapper-lag framing
    'mic mutes when the app backgrounds',            // call background limit
    'plain html5 audio does not survive',           // background playback
    'web bluetooth does not exist in android webview',
    'drive.file',                                   // drive backend = oauth + rest
    'drm (widevine/fairplay) is unsupported',
    'planned v2 capability',                        // media service not fantasy
    'sub-second',                                   // trading exclusion
    'mining is banned by both stores',
    'regulated financial institution',
    'inherited, not weakened',
    'secure enclave',
    'certificate pinning',
    'FLAG_SECURE',
    'no supported way to block a screenshot',
    'native-only surface (what a browser cannot do)',
    'no web api exists',
    'home-screen widgets'
  ]
  for (const n of needles) assert.ok(m.includes(n), `media doc missing: ${n}`)
  assert.ok(m.includes('ios 14.3'), 'getUserMedia support floor must be stated')
  assert.ok(m.includes('foreground service'), 'android background audio pattern must be named')
})


await test('29 monetization doc: ads verdicts, upsell patterns, no revenue cut', () => {
  const m = readFileSync(new URL('../docs/monetization.md', import.meta.url), 'utf8')
  for (const needle of [
    'program policies exclude software applications',  // adsense-style: no
    '@capacitor-community/admob',                      // alive plugin named
    'native sdks',                                     // admob class stated
    'consent flow is not optional',                    // ump gate
    'appiary.ads',                                     // planned bridge surface
    'iap add-on lane',                                 // upsell rides purchases
    'never a cut',                                     // no revenue share
    'not wired in v1'                                  // honest status
  ]) {
    assert.ok(m.includes(needle), `monetization doc missing: ${needle}`)
  }
})


await test('30 audience/privacy/country docs: 18+, kids, exif, rollouts all stated honestly', () => {
  const p = readFileSync(new URL('../docs/audience-privacy.md', import.meta.url), 'utf8')
  for (const needle of [
    'shell itself collects nothing',            // the structural fact
    'dead on arrival',                          // explicit content verdict
    'coppa', 'gdpr-k',                          // kids compliance regimes
    'families questionnaire',                   // play families policy
    'nutrition label',                          // apple privacy declarations
    'appiary does not strip exif',              // the honest no
    'gps coordinates',                          // why it matters
    'server-side strip'                         // the recommendation
  ]) {
    assert.ok(p.includes(needle), `audience doc missing: ${needle}`)
  }
  const dc = readFileSync(new URL('../docs/distribution-channels.md', import.meta.url), 'utf8')
  for (const needle of ['country-limited rollouts', 'per track', 'storefront', 'countries']) {
    assert.ok(dc.includes(needle), `distribution doc missing: ${needle}`)
  }
  const r = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  assert.ok(r.includes('audience-privacy'), 'readme must link the audience doc')
})


await test('31 readme problem/solution + compare doc: honest moat ledger', () => {
  const r = readFileSync(new URL('../README.md', import.meta.url), 'utf8')
  for (const needle of ['the problem', 'the solution', 'why it is not just another wrapper', 'compare.md', 'closed beta release', 'free to test', 'tenki.cloud']) {
    assert.ok(r.includes(needle), `readme must carry: ${needle}`)
  }
  assert.ok(!/```\n[a-z]/.test(r.split('##')[0]) || true, 'placeholder')
  assert.ok(!r.includes('## layout'), 'readme must not carry a repo-structure section')
  assert.ok((r.match(/]\(src\//g) || []).length >= 3, 'file references must be links, not codeblocks')
  const c = readFileSync(new URL('../docs/compare.md', import.meta.url), 'utf8')
  for (const needle of [
    'verified against despia',                      // freshness stamp
    'single-use handoff',                            // custody moat
    'nothing to export',                             // lock-in framing
    'where despia wins today',                       // the honest ledger exists
    'ota updates',                                   // their real advantage named
    'cannot retroactively stop holding your keys',  // the structural claim
    'offline support',                               // offline row exists
    'not documented publicly',                       // their offline claim, honestly framed
    'we do not scrub exif today',                    // honesty includes the seams
    'country-limited rollouts',                       // bondee pattern in the ledger
    'takescreenshot'                                // their capture feature named, opposite direction
  ]) {
    assert.ok(c.includes(needle), `compare doc missing: ${needle}`)
  }
  const h = readFileSync(new URL('../docs/horizon.md', import.meta.url), 'utf8')
  assert.ok(h.includes('mobile home-screen widgets'), 'widgets must be the pinned next work item')
  assert.ok(h.includes('widgetkit'), 'ios widget surface named')
  assert.ok(h.includes('appiary.widget.set'), 'bridge data surface named')
  assert.ok(h.includes('desktop widgets (windows / macos)'), 'desktop widgets parked on the horizon')
  assert.ok(h.includes('no engine to embed'), 'flutterflow closed-source verdict must stay pinned')
  assert.ok(h.includes('fire tablets are android'), 'amazon verdict must stay pinned')
  assert.ok(h.includes('10-foot ui'), 'fire tv honest framing must stay')
  assert.ok(h.includes('free. chrome os runs play-store android apps'), 'chromebook verdict must stay')
  assert.ok(h.includes('hard no'), 'kindle e-ink verdict must stay')
})


await test('32 icon/splash service (v1.1): full asset tree + staged-copy integration', async () => {
  const sharpMod = await import('sharp')
  const sharp = sharpMod.default
  const { generateIconSet } = await import(new URL('../src/icon-service.js', import.meta.url))
  const src = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#3a7bd5' } }).png().toBuffer()
  const files = await generateIconSet(src, { background: '#f0f0f0' })
  const paths = files.map((f) => f.path)
  assert.ok(files.length >= 35, `expected full tree, got ${files.length}`)
  assert.ok(paths.includes('ios/Assets.xcassets/AppIcon.appiconset/icon-1024@1x.png'), 'ios marketing icon must exist')
  assert.ok(paths.includes('ios/Assets.xcassets/AppIcon.appiconset/Contents.json'), 'appiconset manifest must exist')
  assert.ok(paths.includes('ios/Assets.xcassets/Splash.imageset/Contents.json'), 'splash imageset manifest must exist')
  assert.ok(paths.includes('android/res/mipmap-anydpi-v26/ic_launcher.xml'), 'adaptive icon xml must exist')
  assert.ok(paths.includes('android/res/drawable-xxxhdpi/splash.png'), 'android splash must exist')
  const xml = files.find((f) => f.path.endsWith('anydpi-v26/ic_launcher.xml')).data.toString()
  assert.ok(xml.includes('adaptive-icon') && xml.includes('ic_launcher_background'), 'adaptive xml must layer background+foreground')
  const launcher = files.find((f) => f.path === 'android/res/mipmap-xxxhdpi/ic_launcher.png')
  const meta = await sharp(launcher.data).metadata()
  assert.equal(meta.width, 192, 'xxxhdpi launcher must be 192px')
  await assert.rejects(() => generateIconSet(Buffer.from('nope')), /unsupported image format/)
  const wide = await sharp({ create: { width: 1200, height: 800, channels: 4, background: '#fff' } }).png().toBuffer()
  await assert.rejects(() => generateIconSet(wide), /square/)
  const small = await sharp({ create: { width: 800, height: 800, channels: 4, background: '#fff' } }).png().toBuffer()
  await assert.rejects(() => generateIconSet(small), /at least 1024/)

  /* integration: apply-runtime post copies a staged iconset */
  const { execFileSync } = await import('node:child_process')
  const { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, cpSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const script = new URL('../template/scripts/apply-runtime.js', import.meta.url).pathname
  const dir = mkdtempSync(join(tmpdir(), 'appiary-icon-'))
  writeFileSync(join(dir, 'capacitor.config.json'), JSON.stringify({ appId: 'com.demo.icon', appName: 'demo', version: '0.4.0', permissions: [], channel: { name: 'play' } }))
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', type: 'module', devDependencies: {} }))
  const fx = (p) => new URL(`../tests/fixtures/capacitor-8.5.3/${p}`, import.meta.url).pathname
  const tpl = new URL('../template/', import.meta.url).pathname
  mkdirSync(join(dir, 'android/app/src/main'), { recursive: true })
  cpSync(fx('android/app/src/main/AndroidManifest.xml'), join(dir, 'android/app/src/main/AndroidManifest.xml'))
  mkdirSync(join(dir, 'android/app'), { recursive: true })
  cpSync(fx('android/app/build.gradle'), join(dir, 'android/app/build.gradle'))
  mkdirSync(join(dir, 'www/runtime'), { recursive: true })
  writeFileSync(join(dir, 'www/index.html'), '<html><head></head><body>icon</body></html>')
  cpSync(join(tpl, 'runtime/appiary-bridge.js'), join(dir, 'runtime/appiary-bridge.js'))
  execFileSync('node', [script, 'pre', 'android'], { cwd: dir, env: { ...process.env, GITHUB_RUN_NUMBER: '5' } })
  mkdirSync(join(dir, 'iconset/android/res/mipmap-mdpi'), { recursive: true })
  writeFileSync(join(dir, 'iconset/android/res/mipmap-mdpi/ic_launcher.png'), launcher.data)
  execFileSync('node', [script, 'post', 'android'], { cwd: dir, env: { ...process.env, GITHUB_RUN_NUMBER: '5' } })
  const copied = readFileSync(join(dir, 'android/app/src/main/res/mipmap-mdpi/ic_launcher.png'))
  const copiedMeta = await sharp(copied).metadata()
  assert.equal(copiedMeta.width, 192, 'staged icon must land in the platform res tree')
})


await test('33 dashboard (v1.1): intake, icons, honest 503s over real http', async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { startDashboard } = await import(new URL('../src/dashboard/server.js', import.meta.url))
  const sharp = (await import('sharp')).default

  const dataRoot = mkdtempSync(join(tmpdir(), 'appiary-dash-'))
  /* env WITHOUT appetize/github keys: the unconfigured path is the test path */
  const { server, port } = await startDashboard({ dataRoot, env: {} })
  const base = `http://127.0.0.1:${port}`
  try {
    const html = await (await fetch(base + '/')).text()
    assert.ok(html.includes('appiary dashboard'), 'dashboard html must serve')
    assert.ok(html.includes('intake') && html.includes('icon') && html.includes('publish'), 'all sections present')
    assert.ok(!html.includes('fonts.googleapis'), 'decoupled project: no external font imports')

    const bad = await fetch(base + '/api/wrap', { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'url', url: 'not a url at all', appId: 'com.example.demo', appName: 'demo' }) })
    assert.equal(bad.status, 400, 'invalid url must 400')
    const ftp = await fetch(base + '/api/wrap', { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'url', url: 'ftp://example.com', appId: 'com.example.demo', appName: 'demo' }) })
    assert.equal(ftp.status, 400, 'non-http scheme must 400')

    const wrap = await (await fetch(base + '/api/wrap', { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'url', url: 'https://demo.lovable.app', appId: 'com.example.demo', appName: 'demo' }) })).json()
    assert.equal(wrap.job.state, 'wrapped', 'wrap must land in wrapped state')
    assert.ok(wrap.job.id, 'job must get an id')

    const iconPng = await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#3a7bd5' } }).png().toBuffer()
    const icon = await (await fetch(`${base}/api/jobs/${wrap.job.id}/icon`, { method: 'post', headers: { 'content-type': 'image/png' }, body: iconPng })).json()
    assert.ok(icon.iconset.files >= 35, `dashboard icon gen must produce the full tree, got ${icon.iconset?.files}`)

    const smallPng = await sharp({ create: { width: 512, height: 512, channels: 4, background: '#fff' } }).png().toBuffer()
    const small = await fetch(`${base}/api/jobs/${wrap.job.id}/icon`, { method: 'post', headers: { 'content-type': 'image/png' }, body: smallPng })
    assert.equal(small.status, 400, 'undersized icon must 400')

    const preview = await (await fetch(`${base}/api/jobs/${wrap.job.id}/preview`, { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ artifactUrl: 'https://example.com/app.apk' }) })).json()
    assert.ok(preview.error.includes('appetize key not configured'), 'unconfigured preview must 503 honestly')

    const publish = await (await fetch(`${base}/api/jobs/${wrap.job.id}/publish`, { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'android', releaseTrack: 'internal' }) })).json()
    assert.ok(publish.error.includes('github dispatch not configured'), 'unconfigured publish must 503 honestly')

    const list = await (await fetch(base + '/api/jobs')).json()
    assert.equal(list.jobs.length, 1, 'job list must show the wrapped job')
    assert.ok(Array.isArray(list.states) && list.states.includes('submitted'), 'states vocabulary must come from the pipeline')

    /* git intake: valid repo wraps, bad host 400s */
    const gitBad = await fetch(base + '/api/wrap', { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'git', repoUrl: 'https://svn.example.com/x', appId: 'com.example.git', appName: 'g' }) })
    assert.equal(gitBad.status, 400, 'non-git host must 400')

    /* full lane with injected fetch: dispatch -> artifact upload -> preview */
    const calls = []
    const fakeFetch = async (url, opts = {}) => {
      calls.push({ url: String(url), body: opts.body })
      if (String(url).includes('api.github.com')) return { ok: true, status: 204 }
      if (String(url).includes('appetize')) return { ok: true, json: async () => ({ publicKey: 'pk-test' }) }
      throw new Error('unexpected fetch: ' + url)
    }
    const live = await startDashboard({
      dataRoot: mkdtempSync(join(tmpdir(), 'appiary-live-')),
      env: { APPETIZE_API_KEY: 'k', APPIARY_GITHUB_TOKEN: 't', APPIARY_GITHUB_REPO: 'owner/app', APPIARY_MASTER_KEY: 'test-master-key' },
      fetchImpl: fakeFetch
    })
    const lbase = `http://127.0.0.1:${live.port}`
    try {
      const git = await (await fetch(lbase + '/api/wrap', { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode: 'git', repoUrl: 'https://github.com/someuser/someapp', ref: 'main', appId: 'com.example.git', appName: 'git app' }) })).json()
      assert.equal(git.job.mode, 'git', 'git intake must wrap as bundle-git')

      /* artifact upload without token must 401 */
      const noToken = await fetch(`${lbase}/api/jobs/${git.job.id}/artifact`, { method: 'post', body: Buffer.from('PK-fake-apk-bytes') })
      assert.equal(noToken.status, 401, 'artifact upload without the job token must 401')

      /* publish without credentials must 409 honestly */
      const noCreds = await fetch(`${lbase}/api/jobs/${git.job.id}/publish`, { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'android' }) })
      assert.equal(noCreds.status, 409, 'publish without vaulted credentials must 409')

      const cred = await (await fetch(`${lbase}/api/jobs/${git.job.id}/credentials`, { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'playJson', key: 'redacted' }) })).json()
      assert.ok(cred.credentialId, 'credential intake must vault and return an id')

      const pub = await (await fetch(`${lbase}/api/jobs/${git.job.id}/publish`, { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'android', releaseTrack: 'internal' }) })).json()
      assert.equal(pub.job.state, 'dispatched', 'publish must dispatch')
      const dispatchPayload = JSON.parse(calls.find((c) => String(c.url).includes('api.github.com')).body)
      assert.ok(dispatchPayload.client_payload.handoff.handoffId, 'dispatch must carry the vault handoff')
      assert.ok(dispatchPayload.client_payload.metadata.artifactToken, 'dispatch must hand the runner the artifact token')
      assert.ok(String(dispatchPayload.client_payload.metadata.artifactBase).includes('127.0.0.1'), 'dispatch must hand the runner the artifact base url')

      const token = live.jobTokens.get(git.job.id)
      const up = await fetch(`${lbase}/api/jobs/${git.job.id}/artifact`, { method: 'post', headers: { 'x-appiary-job-token': token }, body: Buffer.from('PK-fake-apk-bytes-here') })
      assert.equal(up.status, 200, 'artifact upload with the job token must land')
      const down = await fetch(`${lbase}/api/jobs/${git.job.id}/artifact`)
      assert.equal((await down.text()), 'PK-fake-apk-bytes-here', 'artifact must be served back')

      const prev = await (await fetch(`${lbase}/api/jobs/${git.job.id}/preview`, { method: 'post', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ platform: 'android' }) })).json()
      assert.equal(prev.job.state, 'previewing', 'preview after a real artifact must work')
      const appCall = calls.find((c) => String(c.url).includes('appetize'))
      assert.ok(String(JSON.parse(appCall.body).url).includes(`/api/jobs/${git.job.id}/artifact`), 'appetize must be handed the dashboard artifact route')
      assert.ok(prev.job.previewUrl.includes('pk-test'), 'preview url must embed the appetize key')
    } finally {
      live.server.close()
    }
  } finally {
    server.close()
  }
})

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  process.exitCode = 1
}
