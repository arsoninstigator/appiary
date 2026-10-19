/**
 * minimal async kv store used by the vault and pipeline state.
 * the production build swaps this for the app database (entities with
 * row-level security); the interface is intentionally tiny so the swap is
 * a drop-in: get(id), put(id, record), delete(id), list(prefix).
 */

export class MemoryStore {
  constructor() {
    this.rows = new Map()
  }

  async get(id) {
    const row = this.rows.get(id)
    return row ? structuredClone(row) : null
  }

  async put(id, record) {
    this.rows.set(id, structuredClone(record))
    return record
  }

  async delete(id) {
    this.rows.delete(id)
  }

  async list(prefix = '') {
    return [...this.rows.entries()]
      .filter(([id]) => id.startsWith(prefix))
      .map(([, row]) => structuredClone(row))
  }
}
