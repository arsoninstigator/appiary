import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * envelope encryption primitives used by the credential vault.
 *
 * layout per encrypted row:
 *   v1:<b64(wrapped_dek)>:<b64(iv)>:<b64(ciphertext)>:<b64(auth_tag)>
 *
 * the data encryption key (dek) is random per row and wrapped with the master
 * key (a kms-provided kek in production). the dek only ever exists in memory
 * during decrypt and is never persisted.
 */

const VERSION = 'v1'
const DEK_AAD = Buffer.from('appiary/dek-wrap/v1', 'utf8')

const b64 = (buf) => Buffer.from(buf).toString('base64')
const unb64 = (s) => Buffer.from(s, 'base64')

export function assertMasterKey(masterKey) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== 32) {
    throw new Error('master key must be a 32-byte buffer (256-bit)')
  }
}

/** derive a stable 32-byte master key from raw secret material */
export function normalizeMasterKey(secret, salt = 'appiary/vault/v1') {
  const input = typeof secret === 'string' ? Buffer.from(secret, 'utf8') : Buffer.from(secret)
  return createHash('sha256').update(Buffer.concat([Buffer.from(salt, 'utf8'), input])).digest()
}

function encryptAuth(plain, key, iv, aad) {
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  if (aad) cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()])
  return { ciphertext, tag: cipher.getAuthTag() }
}

function decryptAuth(ciphertext, key, iv, tag, aad) {
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  if (aad) decipher.setAAD(aad)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()])
}

function wrapDek(dek, masterKey) {
  const iv = randomBytes(12)
  const { ciphertext, tag } = encryptAuth(dek, masterKey, iv, DEK_AAD)
  return { iv, ciphertext, tag }
}

/** encrypt a plaintext string under the master key; returns the envelope string */
export function seal(plaintext, masterKey) {
  assertMasterKey(masterKey)
  const dek = randomBytes(32)
  const iv = randomBytes(12)
  const wrapped = wrapDek(dek, masterKey)
  const { ciphertext, tag } = encryptAuth(Buffer.from(plaintext, 'utf8'), dek, iv, DEK_AAD)
  return [
    VERSION,
    b64(Buffer.concat([wrapped.iv, wrapped.ciphertext, wrapped.tag])),
    b64(iv),
    b64(ciphertext),
    b64(tag)
  ].join(':')
}

/** decrypt an envelope back to plaintext; throws on tamper or wrong key */
export function unseal(envelope, masterKey) {
  assertMasterKey(masterKey)
  const parts = String(envelope || '').split(':')
  if (parts.length !== 5 || parts[0] !== VERSION) {
    throw new Error('unrecognized envelope format')
  }
  const wrappedBlob = unb64(parts[1])
  const iv = unb64(parts[2])
  const ciphertext = unb64(parts[3])
  const tag = unb64(parts[4])
  const wIv = wrappedBlob.subarray(0, 12)
  const wTag = wrappedBlob.subarray(wrappedBlob.length - 16)
  const wCiphertext = wrappedBlob.subarray(12, wrappedBlob.length - 16)
  const dek = decryptAuth(wCiphertext, masterKey, wIv, wTag, DEK_AAD)
  return decryptAuth(ciphertext, dek, iv, tag, DEK_AAD).toString('utf8')
}

/** constant-time-ish comparison helper for tokens/hashes */
export function safeEqual(a, b) {
  const ab = Buffer.isBuffer(a) ? a : Buffer.from(String(a), 'utf8')
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(String(b), 'utf8')
  if (ab.length !== bb.length) return false
  return ab.equals(bb)
}

export const sha256 = (value) =>
  createHash('sha256').update(Buffer.from(String(value), 'utf8')).digest('hex')
