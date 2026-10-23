import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'

const algorithm = 'aes-256-gcm'
const keyInfo = 'travel-site ai settings v1'
const keySalt = 'travel-site'
const minimumSecretLength = 32

export function readSecretKey(value) {
  return typeof value === 'string' && value.length >= minimumSecretLength ? value : null
}

function deriveKey(secret) {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.from(keySalt, 'utf8'), keyInfo, 32))
}

export function encryptSecret(plaintext, secret) {
  const iv = randomBytes(12)
  const cipher = createCipheriv(algorithm, deriveKey(secret), iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64url'), tag.toString('base64url'), ciphertext.toString('base64url')].join('.')
}

export function decryptSecret(payload, secret) {
  const [version, iv, tag, ciphertext] = String(payload).split('.')
  if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('AI 金鑰格式不正確。')
  const decipher = createDecipheriv(algorithm, deriveKey(secret), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8')
}
