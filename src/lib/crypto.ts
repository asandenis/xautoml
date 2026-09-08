function bufToB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}

export function randomId(bytes = 6): string {
  const arr = new Uint8Array(bytes)
  crypto.getRandomValues(arr)
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function generateRunId(): string {
  return `run_${randomId(5)}`
}

export async function deriveKeyFromPassword(
  password: string,
  saltB64: string,
): Promise<CryptoKey> {
  const enc = new TextEncoder()
  const baseKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveKey'],
  )
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: b64ToBuf(saltB64),
      iterations: 310_000,
      hash: 'SHA-256',
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function generateDataKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

export async function exportKeyRaw(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey('raw', key)
}

export async function importKeyRaw(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM', length: 256 }, true, [
    'encrypt',
    'decrypt',
  ])
}

export async function encryptBytes(
  key: CryptoKey,
  data: BufferSource,
): Promise<{ iv: string; ciphertext: string }> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return { iv: bufToB64(iv.buffer), ciphertext: bufToB64(ciphertext) }
}

export async function decryptBytes(
  key: CryptoKey,
  ivB64: string,
  ciphertextB64: string,
): Promise<ArrayBuffer> {
  return crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(b64ToBuf(ivB64)) },
    key,
    b64ToBuf(ciphertextB64),
  )
}

export async function encryptJson<T>(key: CryptoKey, value: T) {
  const encoded = new TextEncoder().encode(JSON.stringify(value))
  return encryptBytes(key, encoded)
}

export async function decryptJson<T>(
  key: CryptoKey,
  ivB64: string,
  ciphertextB64: string,
): Promise<T> {
  const buf = await decryptBytes(key, ivB64, ciphertextB64)
  return JSON.parse(new TextDecoder().decode(buf)) as T
}

export function newSaltB64(bytes = 16): string {
  const salt = crypto.getRandomValues(new Uint8Array(bytes))
  return bufToB64(salt.buffer)
}

export { bufToB64, b64ToBuf }
