/**
 * lowercase console logger with credential scrubbing. every line printed
 * through this logger passes redact() first, so secrets that end up in
 * objects by accident never reach stdout or the run journal.
 */

const SENSITIVE_KEY = /(secret|token|password|passwd|credential|api[-_]?key|p8|key)/i
const PLACEHOLDER = '[redacted]'
const LONG_SECRET = /eyJ[A-Za-z0-9+/_=-]{24,}(\.[A-Za-z0-9+/_=-]{8,})?/ // generic long base64ish blob (jwts, keys)

export function redact(value, depth = 0) {
  if (depth > 6) return '[max depth]'
  if (value == null) return value
  if (typeof value === 'string') {
    if (LONG_SECRET.test(value)) return PLACEHOLDER
    return value
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  if (value instanceof Error) {
    const e = { name: value.name, message: redact(value.message, depth + 1) }
    return e
  }
  if (typeof value === 'object') {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = SENSITIVE_KEY.test(k) ? PLACEHOLDER : redact(v, depth + 1)
    }
    return out
  }
  return value
}

export class Log {
  constructor(sink = (line) => console.log(line)) {
    this.sink = sink
    this.lines = []
  }

  write(level, parts) {
    const text = parts.map((p) => (typeof p === 'string' ? String(redact(p)) : JSON.stringify(redact(p)))).join(' ')
    const line = `${level} ${text}`.toLowerCase()
    this.lines.push(line)
    this.sink(line)
  }

  info(...parts) {
    this.write('[info]', parts)
  }

  warn(...parts) {
    this.write('[warn]', parts)
  }

  error(...parts) {
    this.write('[error]', parts)
  }
}
