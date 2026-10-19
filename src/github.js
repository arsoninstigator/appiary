/**
 * step 3: cloud compilation intermediary.
 * appiary never hosts macs. it dispatches a repository_dispatch event to the
 * user's (or appiary's) github repo; github's hosted macos runner spins up
 * on demand and runs the heavy native compile. secrets travel via the vault's
 * single-use handoff token, redeemed inside the runner and never stored.
 */

const GITHUB_API = 'https://api.github.com'
const DISPATCH_EVENT = 'appiary-build'

export class GitHubOrchestrator {
  constructor({ apiToken, repo, fetchImpl, log } = {}) {
    if (!apiToken) throw new Error('github orchestrator requires an api token')
    if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) {
      throw new Error('repo must be owner/name')
    }
    this.apiToken = apiToken
    this.repo = repo
    this.fetchImpl = fetchImpl ?? globalThis.fetch?.bind(globalThis)
    if (!this.fetchImpl) throw new Error('no fetch implementation available')
    this.log = log
  }

  headers() {
    return {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${this.apiToken}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28'
    }
  }

  /**
   * trigger the cloud compile. returns { dispatched: true } on http 204.
   * the payload mirrors what the runner needs: the rendered capacitor config,
   * app metadata, the handoff token reference, and status reporting target.
   * secrets themselves are not in this payload.
   */
  async dispatchBuild({ platform, config, metadata, handoff, baseUrl, jobId, runner = null, source = null }) {
    if (!['ios', 'android'].includes(platform)) throw new Error('platform must be ios or android')
    // wrap configs carry server.url; bundle configs carry webDir instead
    if (!config?.appId || !config?.appName || (!config?.server?.url && !config?.webDir)) {
      throw new Error('config must be a rendered capacitor config')
    }
    if (!handoff?.token || !handoff?.handoffId) throw new Error('handoff token required')
    const clientPayload = {
      jobId,
      platform,
      ...(runner ? { runner } : {}),
      ...(source ? { source } : {}),
      config,
      metadata: metadata ?? {},
      baseUrl: baseUrl ?? null,
      handoff: {
        handoffId: handoff.handoffId,
        token: handoff.token
      }
    }
    const res = await this.fetchImpl(`${GITHUB_API}/repos/${this.repo}/dispatches`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        event_type: DISPATCH_EVENT,
        client_payload: clientPayload
      })
    })
    if (res.status === 204) return { dispatched: true }
    const detail = await res.text().catch(() => '')
    throw new Error(`github dispatch failed (${res.status}): ${String(detail).slice(0, 200)}`)
  }

  /** read a workflow run's status (poll from the dashboard backend) */
  async getRunStatus(runId) {
    const res = await this.fetchImpl(`${GITHUB_API}/repos/${this.repo}/actions/runs/${runId}`, {
      method: 'GET',
      headers: this.headers()
    })
    if (!res.ok) throw new Error(`github run lookup failed (${res.status})`)
    const data = await res.json()
    return {
      status: data.status,
      conclusion: data.conclusion,
      htmlUrl: data.html_url,
      runId: data.id
    }
  }

  /** list recent appiary runs (for run discovery after a dispatch) */
  async listRecentRuns({ event = DISPATCH_EVENT, limit = 5 } = {}) {
    const res = await this.fetchImpl(`${GITHUB_API}/repos/${this.repo}/actions/runs?per_page=${limit}`, {
      method: 'GET',
      headers: this.headers()
    })
    if (!res.ok) throw new Error(`github runs lookup failed (${res.status})`)
    const data = await res.json()
    return (data.workflow_runs ?? [])
      .filter((r) => r.event === 'repository_dispatch')
      .map((r) => ({ runId: r.id, status: r.status, conclusion: r.conclusion, createdAt: r.created_at }))
  }
}

export { DISPATCH_EVENT }
