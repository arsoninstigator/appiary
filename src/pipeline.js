import { renderCapacitorConfig } from './wrapper.js'
import { randomUUID } from 'node:crypto'

/**
 * the appiary pipeline: web url -> wrapped native shell -> streaming preview
 * -> cloud-compiled store submission. state is journaled so the dashboard and
 * resumptions can read it. no mac infra: step 3 is a dispatch.
 *
 * states: received -> wrapped -> previewing -> dispatched -> building ->
 * submitted -> done (or failed, with a recoverable `error`)
 */

export const STATES = ['received', 'wrapped', 'previewing', 'dispatched', 'building', 'submitted', 'done', 'failed']

export class Pipeline {
  constructor({ vault, github, appetize, store, log, config } = {}) {
    if (!vault) throw new Error('pipeline requires the vault')
    if (!github) throw new Error('pipeline requires the github orchestrator')
    if (!store) throw new Error('pipeline requires a store')
    this.vault = vault
    this.github = github
    this.appetize = appetize ?? null
    this.store = store
    this.log = log
    this.config = config ?? {}
  }

  async setState(jobId, patch) {
    const job = await this.store.get(jobId)
    if (!job) throw new Error(`job not found: ${jobId}`)
    const next = { ...job, ...patch, updatedAt: new Date().toISOString() }
    next.history = [...(job.history ?? []), { state: next.state, at: next.updatedAt }]
    await this.store.put(jobId, next)
    return next
  }

  /** intake: validate the request, wrap the url, create the job record */
  async createJob({ projectId, webUrl, platform = 'ios', appId, appName, credentials }) {
    if (!['ios', 'android'].includes(platform)) throw new Error('platform must be ios or android')
    const { config, warnings } = renderCapacitorConfig({ webUrl, appId, appName })
    const jobId = `job_${randomUUID().replace(/-/g, '').slice(0, 24)}`
    let credIds = []
    if (credentials) {
      for (const kind of Object.keys(credentials)) {
        const credId = await this.vault.putCredential(projectId, kind, credentials[kind])
        credIds.push(credId)
      }
    }
    await this.store.put(jobId, {
      id: jobId,
      projectId,
      platform,
      state: 'wrapped',
      config,
      warnings,
      credIds,
      history: [],
      createdAt: new Date().toISOString()
    })
    return { jobId, config, warnings }
  }

  /** step 2: publish a debug artifact to appetize and return the embed url */
  async createPreview(jobId, { artifactUrl }) {
    if (!this.appetize) throw new Error('preview requires the appetize client')
    const job = await this.store.get(jobId)
    if (!job) throw new Error(`job not found: ${jobId}`)
    if (job.state !== 'wrapped') throw new Error(`preview requires state wrapped, got ${job.state}`)
    const app = await this.appetize.publishApp({
      platform: job.platform,
      artifactUrl,
      name: job.projectId
    })
    await this.setState(jobId, { state: 'previewing', preview: { publicKey: app.publicKey, embedUrl: app.embedUrl } })
    return app
  }

  /** step 3+4: mint the single-use handoff and dispatch the cloud compile */
  async dispatch(jobId, { runner } = {}) {
    const job = await this.store.get(jobId)
    if (!job) throw new Error(`job not found: ${jobId}`)
    if (!['wrapped', 'previewing'].includes(job.state)) {
      throw new Error(`dispatch requires state wrapped or previewing, got ${job.state}`)
    }
    const handoff = await this.vault.issueHandoff(job.credIds, { jobId })
    const dispatched = await this.github.dispatchBuild({
      platform: job.platform,
      config: job.config,
      metadata: { projectId: job.projectId, appId: job.config.appId },
      handoff,
      baseUrl: this.config.baseUrl ?? null,
      jobId,
      runner: runner ?? this.config.runner ?? null
    })
    await this.setState(jobId, {
      state: 'dispatched',
      dispatch: { handoffId: handoff.handoffId, dispatched: dispatched.dispatched, at: new Date().toISOString() }
    })
    return { dispatched: true, handoffId: handoff.handoffId }
  }

  /** ingest a status callback from the runner */
  async reportStatus(jobId, { status, conclusion }) {
    const job = await this.store.get(jobId)
    if (!job) throw new Error(`job not found: ${jobId}`)
    let next = job.state
    if (status === 'in_progress') next = 'building'
    else if (conclusion === 'success') next = 'submitted'
    else if (conclusion && conclusion !== 'success' && conclusion !== 'cancelled') next = 'failed'
    else if (conclusion === 'cancelled') next = 'failed'
    const updated = await this.setState(jobId, { state: next, runnerConclusion: conclusion ?? null })
    return { jobId, state: updated.state }
  }
}
