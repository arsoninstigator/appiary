import { readFileSync } from 'node:fs'
import { normalizePermissions } from './permissions.js'

/**
 * step 1: client runtime wrapper.
 * renders the internal hidden capacitor project template with the user's
 * web app url injected under server.url, wrapping the web app in a native
 * webview with bridging enabled. the template is fixed: only the rendered
 * values vary per project.
 *
 * verified against capacitor v8 config schema (capacitorjs.com/docs/config):
 * server.url, server.cleartext, server.hostname, server.androidScheme all
 * live under `server`; bundledWebRuntime was removed back in v4 and is not
 * in the template.
 */

const TEMPLATE_PATH = new URL('../template/capacitor.config.template.json', import.meta.url)
const BUNDLED_TEMPLATE_PATH = new URL('../template/capacitor.config.bundled.template.json', import.meta.url)

export function validateWebUrl(url) {
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error(`not a valid url: ${url}`)
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('web url must be http(s)')
  }
  if (!parsed.hostname) throw new Error('web url has no hostname')
  if (parsed.username || parsed.password) throw new Error('embedded credentials in url are not allowed')
  return parsed
}

/**
 * render the capacitor config for a project.
 * returns { config, warnings } where config is the parsed json object.
 */
export function renderCapacitorConfig({
  webUrl,
  appId,
  appName,
  version = '0.1.0',
  allowInsecureWeb = false,
  permissions = [],
  permissionDescriptions = {}
} = {}) {
  if (!webUrl) throw new Error('webUrl is required')
  if (!appId || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,}$/.test(appId)) {
    throw new Error('appId must be reverse-domain style, e.g. com.appiary.demo')
  }
  if (!appName) throw new Error('appName is required')

  const parsed = validateWebUrl(webUrl)
  const insecure = parsed.protocol === 'http:'
  if (insecure && !allowInsecureWeb) {
    throw new Error('http web urls require allowInsecureWeb (cleartext webview)')
  }

  const warnings = [
    'capacitor documents server.url as a live-reload option, not for production: ' +
      'verify app review readiness before store submission'
  ]
  if (insecure) warnings.push('cleartext http webview: app store review will likely reject this')

  const raw = readFileSync(TEMPLATE_PATH, 'utf8')
  const rendered = raw
    .replaceAll('{{APP_ID}}', appId)
    .replaceAll('{{APP_NAME}}', JSON.stringify(appName).slice(1, -1))
    .replaceAll('{{WEB_URL}}', parsed.toString())
    .replaceAll('{{CLEARTEXT}}', String(insecure))
    .replaceAll('{{HOSTNAME}}', parsed.hostname)

  const config = JSON.parse(rendered)
  if (config.server.url !== parsed.toString()) {
    throw new Error('template render failed to inject server.url')
  }
  config.version = version
  config.permissions = normalizePermissions(permissions)
  config.permissionDescriptions = permissionDescriptions
  return { config, warnings }
}

/** serialize for writing into the native project */
export function capacitorConfigJson(config) {
  return `${JSON.stringify(config, null, 2)}\n`
}

/**
 * bundle mode: the web app is built by the runner and shipped inside the
 * binary. no server.url, no live-reload caveat, sturdier for app review.
 */
export function renderBundledConfig({ appId, appName, version = '0.1.0', permissions = [], permissionDescriptions = {} } = {}) {
  if (!appId || !/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*){1,}$/.test(appId)) {
    throw new Error('appId must be reverse-domain style, e.g. com.appiary.demo')
  }
  if (!appName) throw new Error('appName is required')
  const raw = readFileSync(BUNDLED_TEMPLATE_PATH, 'utf8')
  const rendered = raw
    .replaceAll('{{APP_ID}}', appId)
    .replaceAll('{{APP_NAME}}', JSON.stringify(appName).slice(1, -1))
  const config = JSON.parse(rendered)
  config.version = version
  config.permissions = normalizePermissions(permissions)
  config.permissionDescriptions = permissionDescriptions
  if ('server' in config) throw new Error('bundled template must not configure server.url')
  return { config, warnings: ['bundle mode: web assets are baked into the binary; updates need a new upload'] }
}
