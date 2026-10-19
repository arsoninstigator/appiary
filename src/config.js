/**
 * runtime config from env. master key material comes from the secret store
 * (APPIARY_MASTER_KEY); service tokens are only needed when the matching
 * pipeline step is actually used, so validate lazily at client construction.
 */

export function loadConfig(env = process.env) {
  const config = {
    masterKeySecret: env.APPIARY_MASTER_KEY || null,
    baseUrl: env.APPIARY_BASE_URL || null,
    github: {
      apiToken: env.APPIARY_GITHUB_TOKEN || null,
      repo: env.APPIARY_GITHUB_REPO || null // owner/name
    },
    appetize: {
      apiToken: env.APPIARY_APPETIZE_TOKEN || null
    }
  }
  return config
}

export function validateConfigFor(step, config) {
  switch (step) {
    case 'wrap':
      return true
    case 'preview':
      if (!config.appetize.apiToken) throw new Error('APPIARY_APPETIZE_TOKEN is required for previews')
      return true
    case 'dispatch':
      if (!config.github.apiToken) throw new Error('APPIARY_GITHUB_TOKEN is required for dispatch')
      if (!config.github.repo) throw new Error('APPIARY_GITHUB_REPO (owner/name) is required for dispatch')
      if (!config.masterKeySecret) throw new Error('APPIARY_MASTER_KEY is required for credential routing')
      return true
    default:
      throw new Error(`unknown step: ${step}`)
  }
}
