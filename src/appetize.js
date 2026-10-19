/**
 * step 2: interactive browser preview.
 * pushes a debug-build artifact to the appetize.io api and returns the
 * embeddable iframe url. transport is injectable so the self-tests run
 * without network; production uses global fetch.
 *
 * verified against the current appetize docs (docs.appetize.io/rest-api):
 * - auth header is `x-api-key` (the old `x-appetize-dev` scheme is gone)
 * - create app: POST /v1/apps with { url, platform, ... } -> { publicKey }
 * - update app: POST /v1/apps/{publicKey} keeps the same publicKey
 * - `referrerHostnamesRestricted` locks embedding to our dashboard host
 * - sessions are created client-side by the embed/iframe, not via rest;
 *   there is no create-session endpoint, so embedUrlFor builds the iframe src
 */

const DEFAULT_BASE = 'https://api.appetize.io/v1'

export class AppetizeClient {
  constructor({ apiToken, baseUrl = DEFAULT_BASE, fetchImpl, log } = {}) {
    if (!apiToken) throw new Error('appetize client requires an api token')
    this.apiToken = apiToken
    this.baseUrl = baseUrl.replace(/\/$/, '')
    this.fetchImpl = fetchImpl ?? globalThis.fetch?.bind(globalThis)
    if (!this.fetchImpl) throw new Error('no fetch implementation available')
    this.log = log
  }

  headers() {
    return {
      'content-type': 'application/json',
      'x-api-key': this.apiToken
    }
  }

  /**
   * upload (or update) an app build for streaming preview.
   * pass publicKey to update in place and keep a stable embed url.
   * returns { publicKey, embedUrl }.
   */
  async publishApp({ platform, artifactUrl, publicKey = null, note = null, referrerHostnamesRestricted = null }) {
    if (!['ios', 'android'].includes(platform)) throw new Error('platform must be ios or android')
    if (!artifactUrl) throw new Error('artifactUrl is required')
    const path = publicKey ? `/apps/${encodeURIComponent(publicKey)}` : '/apps'
    const body = {
      url: artifactUrl,
      platform,
      ...(note ? { note } : {}),
      ...(referrerHostnamesRestricted ? { referrerHostnamesRestricted } : {})
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body)
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`appetize upload failed (${res.status}): ${redactShort(detail)}`)
    }
    const data = await res.json()
    if (!data.publicKey) throw new Error('appetize response missing publicKey')
    const resolvedKey = data.publicKey ?? publicKey
    return {
      publicKey: resolvedKey,
      embedUrl: embedUrlFor(resolvedKey)
    }
  }
}

/**
 * iframe src for the dashboard embed. sessions start client-side when the
 * user taps play; params mirror appetize's documented query string
 * (e.g. ?device=pixel4&osVersion=11.0&scale=75).
 */
export function embedUrlFor(publicKey, { device = 'iphone14pro', osVersion = null, scale = null } = {}) {
  const params = new URLSearchParams({ device })
  if (osVersion) params.set('osVersion', osVersion)
  if (scale) params.set('scale', String(scale))
  return `https://app.appetize.io/app/${encodeURIComponent(publicKey)}?${params.toString()}`
}

function redactShort(text) {
  return String(text).slice(0, 200).replace(/"?.{40,}"?/g, '[redacted]')
}
