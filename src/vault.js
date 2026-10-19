import { seal, unseal, sha256, safeEqual } from './vault/crypto.js'

/**
 * the credential vault: row-level encryption for third-party credentials
 * (apple .p8 keys, issuer ids, match passwords, play json) plus single-use
 * handoff tokens that shuttle secrets to a github actions runner exactly once.
 *
 * the vault is transport-agnostic: hand it any async kv store with
 * get/put/delete. plaintext credentials exist in memory only between
 * issueHandoff() and redeemHandoff().
 */

const HANDOFF_TTL_MS_DEFAULT = 15 * 60 * 1000

export class Vault {
  constructor({ masterKey, store, now = () => Date.now(), clockSkewMs = 60_000 } = {}) {
    if (!masterKey) throw new Error('vault requires a master key')
    if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
      throw new Error('vault requires a store with get/put')
    }
    this.masterKey = masterKey
    this.store = store
    this.now = now
    this.clockSkewMs = clockSkewMs
  }

  /** store a credential; returns its id. plaintext never touches the store. */
  async putCredential(projectId, kind, secretObject) {
    const id = `cred_${sha256(`${projectId}:${kind}:${this.now()}:${Math.random()}`).slice(0, 24)}`
    const envelope = seal(JSON.stringify(secretObject), this.masterKey)
    await this.store.put(id, {
      id,
      projectId,
      kind,
      envelope,
      createdDate: new Date(this.now()).toISOString()
    })
    return id
  }

  /** decrypt a credential in memory (never log the result) */
  async getCredential(credId) {
    const row = await this.store.get(credId)
    if (!row) throw new Error(`credential not found: ${credId}`)
    return JSON.parse(unseal(row.envelope, this.masterKey))
  }

  async deleteCredential(credId) {
    await this.store.delete(credId)
  }

  /**
   * mint a single-use handoff for a build run. the runner redeems the token
   * once, within the ttl, and only for the run it was minted for.
   * returns { token, handoffId }.
   */
  async issueHandoff(credIds, { jobId, ttlMs = HANDOFF_TTL_MS_DEFAULT } = {}) {
    if (!Array.isArray(credIds) || credIds.length === 0) throw new Error('handoff needs at least one credential')
    if (!jobId) throw new Error('handoff must be bound to a job id')
    const token = `hof_${sha256(`${jobId}:${this.now()}:${Math.random()}`).slice(0, 48)}`
    const handoffId = `handoff_${sha256(token).slice(0, 24)}`
    await this.store.put(handoffId, {
      id: handoffId,
      jobId,
      credIds,
      tokenHash: sha256(token),
      expiresDate: new Date(this.now() + ttlMs).toISOString(),
      used: false
    })
    return { token, handoffId }
  }

  /**
   * redeem a handoff: verifies token hash, run binding, ttl, and single use,
   * then burns the token and returns the merged env object. second call with
   * the same token fails.
   */
  async redeemHandoff(token, jobId) {
    const handoffId = `handoff_${sha256(token).slice(0, 24)}`
    const row = await this.store.get(handoffId)
    if (!row) throw new Error('invalid handoff token')
    if (!safeEqual(row.tokenHash, sha256(token))) throw new Error('invalid handoff token')
    if (jobId !== row.jobId) throw new Error('handoff token bound to a different job')
    const expiresAt = new Date(row.expiresDate).getTime()
    if (this.now() > expiresAt + this.clockSkewMs) throw new Error('handoff token expired')
    if (row.used) throw new Error('handoff token already redeemed')
    row.used = true
    await this.store.put(handoffId, row)
    const env = {}
    for (const credId of row.credIds) {
      Object.assign(env, await this.getCredential(credId))
    }
    return env
  }

  /** true if a handoff was consumed (used by tests and dashboards) */
  async handoffState(token) {
    const row = await this.store.get(`handoff_${sha256(token).slice(0, 24)}`)
    if (!row) return null
    return { used: row.used, expiresDate: row.expiresDate, jobId: row.jobId }
  }
}
