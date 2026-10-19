/**
 * pure text patches the runner applies to the generated native projects.
 * kept free of fs/exec so every transformation is unit-testable against
 * sample capacitor-generated file shapes.
 */

/** insert uses-permission entries into the android manifest (after the
 *  <manifest ...> open tag, before <application>). idempotent. */
export function patchAndroidManifest(manifest, permissionNames = []) {
  for (const name of permissionNames) {
    const line = `    <uses-permission android:name="${name}" />`
    if (manifest.includes(line)) continue
    manifest = manifest.replace(/(<manifest[^>]*>)/, `$1\n${line}`)
  }
  return manifest
}

/** set versionCode in app/build.gradle (capacitor template shape:
 *  `versionCode 1` inside defaultConfig). */
export function patchVersionCode(gradle, versionCode) {
  if (!Number.isInteger(versionCode) || versionCode < 1) {
    throw new Error('versionCode must be a positive integer')
  }
  const out = gradle.replace(/versionCode \d+/g, `versionCode ${versionCode}`)
  if (out === gradle && !gradle.includes(`versionCode ${versionCode}`)) {
    throw new Error('versionCode line not found in build.gradle')
  }
  return out
}

/** ensure a pbxproj references the entitlements file, so the aps-environment
 *  entitlement actually signs into the binary. idempotent insertion into the
 *  App target build settings. */
export function patchEntitlementsReference(pbxproj, entitlementsPath = 'App/App.entitlements') {
  if (pbxproj.includes('CODE_SIGN_ENTITLEMENTS')) return pbxproj
  const anchor = 'PRODUCT_NAME = "$(TARGET_NAME:-App)"'
  if (!pbxproj.includes(anchor)) {
    throw new Error('pbxproj anchor not found; capacitor template changed shape')
  }
  return pbxproj.replaceAll(
    anchor,
    `${anchor},\n\t\t\t\t\t\tCODE_SIGN_ENTITLEMENTS = ${entitlementsPath};`
  )
}
