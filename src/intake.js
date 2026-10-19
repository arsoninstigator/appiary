/**
 * step 0: source intake.
 * appiary accepts three kinds of source:
 *  - a published web app url (any https url; known ai app builders are
 *    labeled for the dashboard). this is wrap mode: the url is injected into
 *    capacitor server.url and the webview streams the live app.
 *  - a git repo url (github, gitlab, bitbucket, gitea) for users who can get
 *    their code out of the ai tool. this is bundle mode: the runner builds
 *    the web app and ships it inside the app binary.
 *  - a zip artifact url. also bundle mode. this includes workspace-export
 *    zips from exporter tools (e.g. codejack, which downloads a user's whole
 *    ai-builder workspace as a zip or json): the runner's staging script
 *    flattens the wrapper folder these exports usually add.
 * bundle mode produces a real bundled app with no server.url, which is the
 * sturdier answer to app review (see docs/architecture.md).
 */

// known ai web app builders + common static hosts. used for labeling and
// dashboard hints, never for rejection: any https web url is accepted.
export const BUILDER_HOSTS = [
  { suffix: 'lovable.app', builder: 'lovable' },
  { suffix: 'lovable.dev', builder: 'lovable' },
  { suffix: 'replit.app', builder: 'replit' },
  { suffix: 'replit.com', builder: 'replit' },
  { suffix: 'repl.co', builder: 'replit' },
  { suffix: 'base44.app', builder: 'base44' },
  { suffix: 'bolt.new', builder: 'bolt' },
  { suffix: 'rocket.new', builder: 'rocket' },
  { suffix: 'blink.new', builder: 'blink' },
  { suffix: 'zite.so', builder: 'zite' },
  { suffix: 'emergent.sh', builder: 'emergent' },
  { suffix: 'v0.dev', builder: 'v0' },
  { suffix: 'v0.app', builder: 'v0' },
  { suffix: 'vercel.app', builder: 'vercel' },
  { suffix: 'netlify.app', builder: 'netlify' },
  { suffix: 'onrender.com', builder: 'render' },
  { suffix: 'github.io', builder: 'github-pages' },
  { suffix: 'web.app', builder: 'firebase' },
  { suffix: 'pages.dev', builder: 'cloudflare' }
]

const GIT_HOSTS = {
  'github.com': 'github',
  'gitlab.com': 'gitlab',
  'bitbucket.org': 'bitbucket',
  'gitea.com': 'gitea'
}

const REF_SEGMENTS = new Set(['tree', 'blob', 'branch', 'src', 'commit', 'tag'])

export function labelBuilder(url) {
  const host = new URL(url).hostname.toLowerCase()
  for (const { suffix, builder } of BUILDER_HOSTS) {
    if (host === suffix || host.endsWith(`.${suffix}`)) return builder
  }
  return null
}

/**
 * normalize a repo url from any supported git host.
 * extracts owner/repo and, when present, the ref from browse-style paths
 * (github /tree/<ref>, gitlab /-/tree/<ref>, bitbucket /branch/<ref>,
 * gitea /src/branch/<ref>). returns { repo, ref, gitHost }.
 */
export function normalizeGitRepo(repoUrl) {
  let parsed
  try {
    parsed = new URL(repoUrl)
  } catch {
    throw new Error(`not a valid url: ${repoUrl}`)
  }
  if (parsed.protocol !== 'https:') throw new Error('repo url must be https')
  const gitHost = GIT_HOSTS[parsed.hostname.toLowerCase()]
  if (!gitHost) {
    throw new Error(
      `unsupported git host: ${parsed.hostname}. supported: ${Object.keys(GIT_HOSTS).join(', ')} (self-hosted gitea: pass the host in explicitly)`
    )
  }
  const segments = parsed.pathname.replace(/\.git\/?$/, '').split('/').filter(Boolean)
  if (segments.length < 2) throw new Error('repo url must point at owner/repo')
  const repo = `${parsed.protocol}//${parsed.host}/${segments[0]}/${segments[1]}`
  const rest = segments.slice(2).filter((s) => s !== '-')
  let ref = null
  for (let i = 0; i < rest.length; i++) {
    if (REF_SEGMENTS.has(rest[i])) {
      const after = rest.slice(i + 1)
      // gitea nests the kind: /src/branch/<ref>
      ref = after[0] === 'branch' && after[1] ? after[1] : (after[0] ?? null)
      break
    }
  }
  return { repo, ref, gitHost }
}

/**
 * classify a source into a normalized descriptor the pipeline can act on.
 * accepts explicit fields (dashboard form) or an already-classified source.
 * returns { mode, ... }:
 *   wrap       -> { mode, url, builder }
 *   bundle-git -> { mode, repo, ref, gitHost }
 *   bundle-zip -> { mode, url }
 */
export function classifyIntake({ webUrl = null, repoUrl = null, zipUrl = null, ref = null } = {}) {
  if (repoUrl) {
    const git = normalizeGitRepo(repoUrl)
    return { mode: 'bundle-git', repo: git.repo, ref: ref ?? git.ref, gitHost: git.gitHost }
  }
  if (zipUrl) {
    const parsed = new URL(zipUrl)
    if (parsed.protocol !== 'https:') throw new Error('zip url must be https')
    return { mode: 'bundle-zip', url: parsed.toString() }
  }
  if (webUrl) {
    const parsed = new URL(webUrl)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error('web url must be http(s)')
    }
    if (!parsed.hostname) throw new Error('web url has no hostname')
    return { mode: 'wrap', url: parsed.toString(), builder: labelBuilder(webUrl) }
  }
  throw new Error('intake requires one of: webUrl, repoUrl, zipUrl')
}
