/**
 * distribution channels: where a build ends up, how its end users get
 * updates, and what per-channel gating the web app can do.
 *
 * the channel rides in capacitor.config.json alongside permissions and is
 * validated and baked in by template/scripts/apply-runtime.js pre-sync;
 * the bridge (template/runtime/appiary-bridge.js) exposes it to the web app
 * as window.appiary.channel for noteshelf-style per-store features.
 */

export const CHANNELS = {
  /** ios has exactly one store; channel exists so the surface is uniform */
  appstore: {
    platforms: ['ios'],
    updateBehavior: 'store-auto',
    requiresUpdateCheckUrl: false,
    androidPermission: null
  },
  play: {
    platforms: ['android'],
    updateBehavior: 'store-auto',
    requiresUpdateCheckUrl: false,
    androidPermission: null
  },
  samsung: {
    platforms: ['android'],
    updateBehavior: 'store-auto',
    requiresUpdateCheckUrl: false,
    androidPermission: null,
    gating: 'samsung-only features are declared at intake and read from window.appiary.channel'
  },
  /**
   * sideloaded apk: the user hosts the binary (their site, mdm, an apk
   * store we do not know about). stores do not auto-update these installs,
   * so the app checks for updates itself against the user's endpoint.
   */
  direct: {
    platforms: ['android'],
    updateBehavior: 'in-app-check',
    requiresUpdateCheckUrl: true,
    androidPermission: 'android.permission.REQUEST_INSTALL_PACKAGES'
  }
}

/** default channel per platform when the config does not state one */
export function defaultChannel(platform) {
  return platform === 'ios' ? 'appstore' : 'play'
}

/**
 * validate + normalize a channel declaration. returns
 * { name, appId, appName } with defaults filled in. throws on channels the
 * platform cannot ship (ios is the app store, full stop) or on a direct
 * build without an update endpoint to check.
 */
export function normalizeChannel(platform, channel = {}) {
  if (platform !== 'ios' && platform !== 'android') {
    throw new Error(`unknown platform: ${platform}`)
  }
  const name = channel.name || defaultChannel(platform)
  if (!Object.hasOwn(CHANNELS, name)) throw new Error(`unknown channel: ${name}`)
  const def = CHANNELS[name]
  if (!def.platforms.includes(platform)) {
    throw new Error(`channel ${name} cannot ship to ${platform}`)
  }
  if (def.requiresUpdateCheckUrl && !channel.updateCheckUrl) {
    throw new Error('direct builds need updateCheckUrl: the app must have somewhere to check for new versions')
  }
  return {
    name,
    appId: channel.appId || null,
    appName: channel.appName || null,
    updateCheckUrl: channel.updateCheckUrl || null
  }
}

/**
 * same package id + same keystore across android channels means a galaxy
 * store update can upgrade a play-installed app and vice versa. diverging
 * the id (per-channel appId) gives side-by-side installs instead.
 * returns the constraint text once so docs and intake share one wording.
 */
export const SHARED_IDENTITY_RULE =
  'same appId + same signing key across android channels lets any store upgrade any install; diverging the appId gives side-by-side installs'
