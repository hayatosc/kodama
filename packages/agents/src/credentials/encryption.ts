/**
 * Envelope encryption with independent AES-256-GCM data and wrapping nonces.
 * Authentication binds every envelope to its immutable identity and revision.
 *
 * @module
 */

/** Identity authenticated by both layers of an envelope, including its owning principal. */
export interface CredentialIdentity {
  credentialId: string
  kind: 'api_key' | 'oauth_subscription'
  provider: string
  ownerId: string | null
  revision: number
}

/** Base64 storage representation; never return this through a public RPC. */
export interface Envelope {
  ciphertext: string
  iv: string
  wrappedDek: string
  wrapIv: string
}

function encode(bytes: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
}

function decode(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
}

function aad(identity: CredentialIdentity, purpose: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(
    new TextEncoder().encode(
      JSON.stringify([
        'kodama-credential-v1',
        purpose,
        identity.credentialId,
        identity.kind,
        identity.provider,
        identity.ownerId === null ? 'installation' : 'principal',
        identity.ownerId,
        identity.revision,
      ]),
    ),
  )
}

async function key(
  value: Uint8Array<ArrayBuffer>,
  usage: ('encrypt' | 'decrypt')[],
): Promise<CryptoKey> {
  if (value.byteLength !== 32) throw new Error('credential_unavailable: invalid encryption key')
  return crypto.subtle.importKey('raw', value, 'AES-GCM', false, usage)
}

/** Keyed comparison tag: metadata cannot verify guessed secrets without the Worker Secret. */
export async function credentialFingerprint(secret: string, kek: string): Promise<string> {
  try {
    const bytes = decode(kek)
    if (bytes.byteLength !== 32) throw new Error('Invalid encryption key')
    const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey'])
    const signingKey = await crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: new TextEncoder().encode('kodama-credential-fingerprint-v1'),
      },
      material,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['sign'],
    )
    const tag = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(secret))
    return Array.from(new Uint8Array(tag), (byte) => byte.toString(16).padStart(2, '0')).join('')
  } catch {
    throw new Error('credential_unavailable: fingerprint failed')
  }
}

/** Encrypt a secret with a fresh DEK; KEKs are canonical base64-encoded 32-byte secrets. */
export async function encryptCredential(
  identity: CredentialIdentity,
  secret: string,
  kek: string,
): Promise<Envelope> {
  try {
    const dek = crypto.getRandomValues(new Uint8Array(32))
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const wrapIv = crypto.getRandomValues(new Uint8Array(12))
    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: aad(identity, 'payload') },
      await key(dek, ['encrypt']),
      new TextEncoder().encode(secret),
    )
    const wrappedDek = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: wrapIv, additionalData: aad(identity, 'dek') },
      await key(decode(kek), ['encrypt']),
      dek,
    )
    dek.fill(0)
    return {
      ciphertext: encode(ciphertext),
      iv: encode(iv),
      wrappedDek: encode(wrappedDek),
      wrapIv: encode(wrapIv),
    }
  } catch {
    throw new Error('credential_unavailable: encryption failed')
  }
}

/** Fail closed on an unavailable KEK, a changed identity, or a damaged envelope. */
export async function decryptCredential(
  identity: CredentialIdentity,
  envelope: Envelope,
  kek: string,
): Promise<string> {
  try {
    const dek = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: decode(envelope.wrapIv), additionalData: aad(identity, 'dek') },
        await key(decode(kek), ['decrypt']),
        decode(envelope.wrappedDek),
      ),
    )
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: decode(envelope.iv), additionalData: aad(identity, 'payload') },
      await key(dek, ['decrypt']),
      decode(envelope.ciphertext),
    )
    dek.fill(0)
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(plaintext)
  } catch {
    throw new Error('credential_unavailable: decryption failed')
  }
}
