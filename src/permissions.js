/**
 * app-level permissions: maps web-facing capabilities to the native
 * declarations each store requires. ios requires a usage description for
 * every permission (a missing one crashes the app the moment the webview
 * requests the capability); android needs manifest uses-permission entries.
 *
 * the catalog is data, not logic: intake collects which permissions an app
 * needs plus optional custom usage descriptions, the wrapper drops both
 * into the rendered capacitor config, and the runner injects the native
 * declarations at build time (template/scripts/apply-runtime.js).
 *
 * usage strings are lowercase per house style; apple displays them verbatim
 * in the system permission dialog.
 */

export const PERMISSIONS = {
  camera: {
    label: 'camera',
    ios: { key: 'NSCameraUsageDescription', description: 'the app uses the camera when you take photos or scan codes' },
    android: ['android.permission.CAMERA']
  },
  microphone: {
    label: 'microphone',
    ios: { key: 'NSMicrophoneUsageDescription', description: 'the app uses the microphone when you record audio' },
    android: ['android.permission.RECORD_AUDIO']
  },
  location: {
    label: 'location',
    ios: { key: 'NSLocationWhenInUseUsageDescription', description: 'the app uses your location to show relevant content nearby' },
    android: ['android.permission.ACCESS_COARSE_LOCATION', 'android.permission.ACCESS_FINE_LOCATION']
  },
  photoLibrary: {
    label: 'photo library',
    ios: { key: 'NSPhotoLibraryUsageDescription', description: 'the app accesses your photo library when you pick images' },
    android: ['android.permission.READ_MEDIA_IMAGES']
  },
  push: {
    label: 'push notifications',
    ios: { key: null, entitlement: 'aps-environment', description: null },
    android: ['android.permission.POST_NOTIFICATIONS']
  },
  gameServices: {
    /** google play games v2 (android) / game center (ios). no os
     *  permission dialog: the store handles its own sign-in. ios needs the
     *  game-center entitlement; android v2 needs no manifest line. */
    label: 'game services (google play games / game center)',
    ios: { key: null, entitlement: 'com.apple.developer.game-center', description: null },
    android: []
  },
  widgets: {
    /** home-screen widgets. no os permission dialog: the home screen is
     *  the os's own surface. android needs no app manifest line (the
     *  plugin library manifest merges the receiver in); ios needs no
     *  entitlement until the extension target lands. */
    label: 'home-screen widgets',
    ios: { key: null, entitlement: null, description: null },
    android: []
  }
}

/** ios entitlements implied by the declared capabilities */
export function entitlementsFor(list = []) {
  const out = {}
  for (const id of normalizePermissions(list)) {
    const ent = PERMISSIONS[id].ios.entitlement
    if (!ent) continue
    out[ent] = ent === 'aps-environment' ? 'production' : true
  }
  return out
}

/** entitlements plist body from an entitlements dict */
export function entitlementsPlist(entries = {}) {
  const body = Object.entries(entries).map(([k, v]) =>
    v === true ? `  <key>${k}</key>\n  <true/>` : `  <key>${k}</key>\n  <string>${v}</string>`
  ).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${body}
</dict>
</plist>
`
}

/** validate and normalize a permissions list; unknown ids throw */
export function normalizePermissions(list = []) {
  if (!Array.isArray(list)) throw new Error('permissions must be an array of ids')
  return list.map((id) => {
    if (!Object.hasOwn(PERMISSIONS, id)) {
      throw new Error(`unknown permission: ${id}`)
    }
    return id
  })
}

/** usage descriptions for ios, custom overrides applied per permission id */
export function iosUsageDescriptions(list = [], overrides = {}) {
  const out = {}
  for (const id of normalizePermissions(list)) {
    const entry = PERMISSIONS[id].ios
    if (!entry.key) continue
    const custom = overrides[id]
    if (typeof custom === 'string' && custom.trim()) {
      out[entry.key] = custom.trim()
    } else {
      out[entry.key] = entry.description
    }
  }
  return out
}

/** android manifest uses-permission names */
export function androidPermissions(list = []) {
  const out = new Set()
  for (const id of normalizePermissions(list)) {
    for (const name of PERMISSIONS[id].android) out.add(name)
  }
  return [...out]
}

/** plistbuddy argument lists for injecting usage descriptions */
export function plistBuddyCommands(entries, infoPlistPath = 'ios/App/App/Info.plist') {
  return Object.entries(entries).map(([key, value]) => [
    '/usr/libexec/PlistBuddy', '-c', `Add :${key} string ${value}`, '-c', `Set :${key} ${value}`, infoPlistPath
  ])
}

/** true when the push permission is declared (drives entitlement injection) */
export function needsPushEntitlement(list = []) {
  return normalizePermissions(list).includes('push')
}

/** aps-environment entitlement file body for app-store distribution */
export function pushEntitlements() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>aps-environment</key>
  <string>production</string>
</dict>
</plist>
`
}

/**
 * runtime surface per permission: how the web app asks for it and reads its
 * state once the app is on a real device.
 *
 * - capacitor plugins are installed by apply-runtime pre-sync when the
 *   capability is declared, so state queries are always backed by an
 *   installed plugin (or a documented web api for microphone, which has no
 *   core capacitor plugin).
 * - the bridge (template/runtime/appiary-bridge.js) normalizes every
 *   plugin's state vocabulary to: granted | prompt | blocked | unknown.
 *   "blocked" means the os will not show the system dialog again (ios
 *   denial or android prompt-with-rationale); recovery runs through system
 *   settings, so feature gating should treat it as "offer the fallback ui".
 */
export const RUNTIME_SURFACE = {
  camera: {
    plugin: '@capacitor/camera',
    /** camera + photo library both resolve through the camera plugin:
     *  the picker (CameraSource.Photos) IS the photo-library path, so one
     *  dependency covers both capabilities. */
    pluginStateKey: 'camera'
  },
  photoLibrary: {
    plugin: '@capacitor/camera',
    pluginStateKey: 'photos'
  },
  microphone: {
    plugin: null,
    /** no core capacitor plugin exists; the webview's own media api asks,
     *  and the injected plist keys make the os dialog legal. */
    via: 'navigator.mediaDevices.getUserMedia'
  },
  location: {
    plugin: '@capacitor/geolocation',
    pluginStateKey: 'location'
  },
  push: {
    plugin: '@capacitor/push-notifications',
    pluginStateKey: 'receive'
  },
  gameServices: {
    /* first-party in-repo plugin (template/plugins/appiary-game-services),
       installed as a file: dep when the capability is declared; the store
       sign-in flow has no permission state to query. */
    plugin: null,
    via: 'appiary-game-services'
  },
  widgets: {
    /* first-party in-repo plugin (template/plugins/appiary-widgets):
       data-not-pixels - the bridge writes snapshots, the native provider
       renders them while the webview is dead. */
    plugin: null,
    via: 'appiary-widgets'
  }
}

/**
 * capacitor plugin dependencies implied by the declared capabilities.
 * camera and photo library share @capacitor/camera; push and local
 * notifications ship in the shell unconditionally.
 */
export function pluginDependenciesFor(list = []) {
  const out = new Set()
  for (const id of normalizePermissions(list)) {
    const plugin = RUNTIME_SURFACE[id].plugin
    if (plugin && id !== 'push') out.add(plugin)
  }
  return [...out]
}
