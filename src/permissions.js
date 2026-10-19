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
  }
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
