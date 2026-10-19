#!/usr/bin/env node
/**
 * runner-side injection of per-app runtime declarations into the native
 * projects. two phases, because plugin deps and config must exist before
 * `cap sync` (that is when capacitor registers plugins into the generated
 * platforms), while native file patches only exist after `cap add`:
 *
 *   node scripts/apply-runtime.js pre <platform>
 *     - validate permissions + channel, apply per-channel appId/appName
 *       overrides into capacitor.config.json
 *     - add the capacitor plugin deps the declared capabilities imply
 *
 *   node scripts/apply-runtime.js post <platform>
 *     - ios usage descriptions (plistbuddy add-or-set per key)
 *     - ios push entitlement + pbxproj reference when push is declared
 *     - android manifest uses-permission entries (+ install permission for
 *       direct-channel builds)
 *     - build numbers from github run number (monotonic per repo)
 *     - google-services.json placement when the vault delivered one
 *     - the appiary bridge (www/appiary-runtime.js) with the channel,
 *       version identity, and update endpoint baked in, plus the script
 *       tag in the user's index.html
 *
 * pure logic lives in ../../src so it is unit-tested; this file only does
 * fs/exec against the generated projects.
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(here, '..', '..', 'src')
const {
  iosUsageDescriptions, androidPermissions, needsPushEntitlement, pushEntitlements,
  pluginDependenciesFor, normalizePermissions
} = await import(`file://${join(srcRoot, 'permissions.js')}`)
const { patchAndroidManifest, patchVersionCode, patchEntitlementsReference, patchXcodeVersions } =
  await import(`file://${join(srcRoot, 'runtime-patch.js')}`)
const { normalizeChannel, CHANNELS } = await import(`file://${join(srcRoot, 'channels.js')}`)

const [phase, platformArg] = process.argv.slice(2)
if (phase !== 'pre' && phase !== 'post') {
  console.error('usage: node scripts/apply-runtime.js <pre|post> <ios|android>')
  process.exit(2)
}
const platform = platformArg || (existsSync('ios') ? 'ios' : 'android')
if (platform !== 'ios' && platform !== 'android') {
  console.error(`unknown platform: ${platform}`)
  process.exit(2)
}

const config = JSON.parse(readFileSync('capacitor.config.json', 'utf8'))
const runNumber = Number(process.env.GITHUB_RUN_NUMBER || 1)
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })
const permissions = normalizePermissions(config.permissions || [])

if (phase === 'pre') {
  /* channel: validate, then apply per-channel identity overrides so the
     generated platform comes out branded for that channel. */
  const channel = normalizeChannel(platform, config.channel || {})
  if (channel.appId) config.appId = channel.appId
  if (channel.appName) config.appName = channel.appName
  writeFileSync('capacitor.config.json', JSON.stringify(config, null, 2))

  /* capability-implied plugin deps land in package.json before sync so
     capacitor registers them into the native projects. */
  const pkgPath = 'package.json'
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  pkg.devDependencies = pkg.devDependencies || {}
  for (const dep of pluginDependenciesFor(permissions)) {
    pkg.devDependencies[dep] = pkg.devDependencies[dep] || '^8.0.0'
  }
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
  console.log(`pre: channel ${channel.name}, ${permissions.length} declared capabilities`)
  process.exit(0)
}

/* ---------- post: native projects exist ---------- */

const iosEntries = iosUsageDescriptions(permissions, config.permissionDescriptions || {})

if (platform === 'ios') {
  if (existsSync('ios/App/App/Info.plist')) {
    for (const [key, value] of Object.entries(iosEntries)) {
      try {
        sh('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, 'ios/App/App/Info.plist'])
      } catch {
        sh('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, 'ios/App/App/Info.plist'])
      }
    }
    sh('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleVersion ${runNumber}`, 'ios/App/App/Info.plist'])
    sh('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleShortVersionString ${config.version}`, 'ios/App/App/Info.plist'])
    const pbxPath = 'ios/App/App.xcodeproj/project.pbxproj'
    const pbx = readFileSync(pbxPath, 'utf8')
    writeFileSync(pbxPath, patchXcodeVersions(pbx, { version: config.version, buildNumber: runNumber }))
    if (needsPushEntitlement(permissions)) {
      writeFileSync('ios/App/App/App.entitlements', pushEntitlements())
      writeFileSync(pbxPath, patchEntitlementsReference(readFileSync(pbxPath, 'utf8')))
    }
  }
}

if (platform === 'android') {
  const manifestPath = 'android/app/src/main/AndroidManifest.xml'
  if (existsSync(manifestPath)) {
    const channel = normalizeChannel('android', config.channel || {})
    const manifestPerms = androidPermissions(permissions)
    const channelPerm = CHANNELS[channel.name].androidPermission
    const all = channelPerm ? [...manifestPerms, channelPerm] : manifestPerms
    writeFileSync(manifestPath, patchAndroidManifest(readFileSync(manifestPath, 'utf8'), all))
  }
  const gradlePath = 'android/app/build.gradle'
  if (existsSync(gradlePath)) {
    writeFileSync(gradlePath, patchVersionCode(readFileSync(gradlePath, 'utf8'), runNumber))
  }
  if (existsSync('google-services.json')) {
    copyFileSync('google-services.json', 'android/app/google-services.json')
  }
}

/* bridge: config baked in, then the script tag into the user's index.html */
const channel = normalizeChannel(platform, config.channel || {})
const bridgeBody = readFileSync('runtime/appiary-bridge.js', 'utf8')
const bridgeConfig = JSON.stringify({
  channel: channel.name,
  version: config.version,
  buildNumber: runNumber,
  updateCheckUrl: channel.updateCheckUrl
})
writeFileSync('www/appiary-runtime.js', `window.__appiaryConfig = ${bridgeConfig}\n${bridgeBody}`)

const indexPath = 'www/index.html'
if (existsSync(indexPath)) {
  const index = readFileSync(indexPath, 'utf8')
  if (!index.includes('appiary-runtime.js')) {
    writeFileSync(
      indexPath,
      index.replace(/<head[^>]*>/i, (head) => `${head}\n    <script src="appiary-runtime.js"></script>`)
    )
  }
}
console.log(`post: bridge staged for channel ${channel.name}`)
