#!/usr/bin/env node
/**
 * runner-side injection of per-app runtime declarations into the generated
 * native projects. runs after init-platforms.sh on the build runner, inside
 * template/. reads the permissions and permissionDescriptions blocks the
 * wrapper dropped into capacitor.config.json.
 *
 * applies:
 * - ios usage descriptions (plistbuddy add-or-set per key)
 * - ios push entitlement + pbxproj reference when push is declared
 * - android manifest uses-permission entries
 * - build numbers from github run number (monotonic per repo)
 * - google-services.json placement when the vault delivered one (android fcm)
 *
 * pure logic lives in ../../src so it is unit-tested; this file only does
 * fs/exec against the generated platforms.
 */

import { execFileSync, readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const srcRoot = join(here, '..', '..', 'src')
const {
  iosUsageDescriptions, androidPermissions, needsPushEntitlement, pushEntitlements
} = await import(`file://${join(srcRoot, 'permissions.js')}`)
const { patchAndroidManifest, patchVersionCode, patchEntitlementsReference } =
  await import(`file://${join(srcRoot, 'runtime-patch.js')}`)

const config = JSON.parse(readFileSync('capacitor.config.json', 'utf8'))
const runNumber = Number(process.env.GITHUB_RUN_NUMBER || 1)
const sh = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

const permissions = config.permissions || []
const iosEntries = iosUsageDescriptions(permissions, config.permissionDescriptions || {})

if (existsSync('ios/App/App/Info.plist')) {
  for (const [key] of Object.entries(iosEntries)) {
    const value = iosEntries[key]
    try {
      sh('/usr/libexec/PlistBuddy', ['-c', `Add :${key} string ${value}`, 'ios/App/App/Info.plist'])
    } catch {
      sh('/usr/libexec/PlistBuddy', ['-c', `Set :${key} ${value}`, 'ios/App/App/Info.plist'])
    }
  }
  sh('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleVersion ${runNumber}`, 'ios/App/App/Info.plist'])
  sh('/usr/libexec/PlistBuddy', ['-c', `Set :CFBundleShortVersionString ${config.version}`, 'ios/App/App/Info.plist'])
  if (needsPushEntitlement(permissions)) {
    writeFileSync('ios/App/App/App.entitlements', pushEntitlements())
    const pbx = readFileSync('ios/App/App.xcodeproj/project.pbxproj', 'utf8')
    writeFileSync('ios/App/App.xcodeproj/project.pbxproj', patchEntitlementsReference(pbx))
  }
}

if (existsSync('android/app/src/main/AndroidManifest.xml')) {
  const manifestPath = 'android/app/src/main/AndroidManifest.xml'
  writeFileSync(
    manifestPath,
    patchAndroidManifest(readFileSync(manifestPath, 'utf8'), androidPermissions(permissions))
  )
  const gradlePath = 'android/app/build.gradle'
  writeFileSync(gradlePath, patchVersionCode(readFileSync(gradlePath, 'utf8'), runNumber))
  if (process.env.FCM_JSON && existsSync(process.env.FCM_JSON)) {
    copyFileSync(process.env.FCM_JSON, 'android/app/google-services.json')
    console.log('google-services.json placed; fcm plugin wiring must be enabled in build.gradle')
  }
}

console.log(`runtime declarations applied (run ${runNumber})`)
