/**
 * pure text patches the runner applies to the generated native projects.
 * kept free of fs/exec so every transformation is unit-testable.
 *
 * anchors verified against the real capacitor 8.5.3 platform templates,
 * vendored at tests/fixtures/capacitor-8.5.3/ (see that README for
 * provenance). do not change an anchor without re-checking the fixture.
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

/**
 * xcode build settings carry their own version literals, and at build time
 * they win over the Info.plist: CURRENT_PROJECT_VERSION supplies the build
 * number and MARKETING_VERSION the marketing version. patching only the
 * plist would leave every build at version 1 / build 1.
 */
export function patchXcodeVersions(pbxproj, { version, buildNumber }) {
  if (!Number.isInteger(buildNumber) || buildNumber < 1) {
    throw new Error('buildNumber must be a positive integer')
  }
  if (!/CURRENT_PROJECT_VERSION = \d+;/.test(pbxproj) || !/MARKETING_VERSION = [\d.]+;/.test(pbxproj)) {
    throw new Error('xcode version anchors not found in pbxproj; capacitor template changed shape')
  }
  return pbxproj
    .replace(/CURRENT_PROJECT_VERSION = \d+;/g, `CURRENT_PROJECT_VERSION = ${buildNumber};`)
    .replace(/MARKETING_VERSION = [\d.]+;/g, `MARKETING_VERSION = ${version};`)
}

/**
 * ensure the pbxproj references the entitlements file so the
 * aps-environment entitlement actually signs into the binary. the capacitor
 * template has no entitlements file or reference, and its anchor is
 * `PRODUCT_NAME = "$(TARGET_NAME)";` — with no `:-App` fallback. insert
 * into every buildSettings block that carries the anchor (the template has
 * one per configuration: debug + release). idempotent.
 */
export function patchEntitlementsReference(pbxproj, entitlementsPath = 'App/App.entitlements') {
  if (pbxproj.includes('CODE_SIGN_ENTITLEMENTS')) return pbxproj
  const anchor = 'PRODUCT_NAME = "$(TARGET_NAME)";'
  if (!pbxproj.includes(anchor)) {
    throw new Error('pbxproj anchor not found; capacitor template changed shape')
  }
  return pbxproj.replaceAll(
    anchor,
    `${anchor}\n\t\t\t\t\t\tCODE_SIGN_ENTITLEMENTS = ${entitlementsPath};`
  )
}

/**
 * inject play games v2 initialization into the generated android
 * MainActivity (cap add writes an empty BridgeActivity; ground-truth
 * fixture: tests/fixtures/capacitor-8.5.3/android/.../MainActivity.java).
 * idempotent: a second run leaves an already-patched file alone.
 */
export function patchMainActivityGames(javaSrc) {
  if (javaSrc.includes('PlayGamesSdk.initialize')) return javaSrc
  const empty = /public class MainActivity extends BridgeActivity \{\s*\}/
  if (!empty.test(javaSrc)) {
    throw new Error('MainActivity shape not recognized: refusing to patch blindly')
  }
  const body = `public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    PlayGamesSdk.initialize(this);
    super.onCreate(savedInstanceState);
  }
}`
  const patched = javaSrc.replace(empty, body)
  /* java demands the package declaration first; imports follow it */
  return patched.replace(
    /^(package [^;]+;)/m,
    `$1\n\nimport android.os.Bundle;\nimport com.google.android.gms.games.PlayGamesSdk;`
  )
}
