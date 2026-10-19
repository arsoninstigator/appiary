/**
 * release tracks: which audience a given push targets. the store's own beta
 * mechanics do the user routing - we do not build a beta distribution
 * system, we ship to the surface each store already gives us.
 *
 * monotonic build numbers (github run number) are what make track
 * coexistence safe: a beta push never disturbs production users because
 * production users are never offered it.
 */

export const RELEASE_TRACKS = {
  testflight: {
    platforms: ['ios'],
    audience: 'testflight testers: internal groups (up to 100 per group) plus external testers by email invitation',
    fastlane: { submit_for_review: false }
  },
  appstore: {
    platforms: ['ios'],
    audience: 'all app store users, after review',
    fastlane: { submit_for_review: true }
  },
  internal: {
    platforms: ['android'],
    supplyTrack: 'internal',
    audience: 'up to 100 internal testers in the play console, no opt-in needed',
    allowsRollout: false
  },
  closed: {
    platforms: ['android'],
    supplyTrack: 'alpha',
    audience: 'closed beta: testers admitted by email list or google group',
    allowsRollout: false
  },
  open: {
    platforms: ['android'],
    supplyTrack: 'beta',
    audience: 'open beta: anyone can join from the play store listing',
    allowsRollout: false
  },
  production: {
    platforms: ['android'],
    supplyTrack: 'production',
    audience: 'all play store users',
    allowsRollout: true
  }
}

export function defaultReleaseTrack(platform) {
  return platform === 'ios' ? 'testflight' : 'internal'
}

/**
 * validate + normalize a release track declaration. throws on tracks the
 * platform cannot ship and on a rollout fraction outside production.
 * rollout, when present, must be a number in (0, 1].
 */
export function normalizeReleaseTrack(platform, name, rollout) {
  if (platform !== 'ios' && platform !== 'android') {
    throw new Error(`unknown platform: ${platform}`)
  }
  const track = name || defaultReleaseTrack(platform)
  if (!Object.hasOwn(RELEASE_TRACKS, track)) throw new Error(`unknown release track: ${track}`)
  const def = RELEASE_TRACKS[track]
  if (!def.platforms.includes(platform)) {
    throw new Error(`release track ${track} cannot ship to ${platform}`)
  }
  if (rollout !== undefined && rollout !== null && rollout !== '') {
    const fraction = Number(rollout)
    if (!def.allowsRollout) {
      throw new Error(`rollout only applies to the production track, not ${track}`)
    }
    if (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
      throw new Error('rollout must be a fraction of users between 0 and 1, e.g. 0.25')
    }
  }
  return { track, supplyTrack: def.supplyTrack || null, fastlane: def.fastlane || null }
}
