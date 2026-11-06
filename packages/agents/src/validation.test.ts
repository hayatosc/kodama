/**
 * Public agent IDs must be v7, and UUID-shaped values cannot bypass the rule as slugs.
 *
 * @module
 */
import { describe, expect, it } from 'vite-plus/test'
import {
  ArtifactUploadSchema,
  ExtensionPageSchema,
  NotificationQuerySchema,
  NotificationReadSchema,
  parseAgentId,
  parseInput,
  parseMessage,
  parseRequestId,
  SlugSchema,
} from './validation.ts'
import { MAX_ARTIFACT_BYTES } from './extensions.ts'

describe('extension boundaries', () => {
  it('accepts arbitrary binary files, including empty files, without an extension allowlist', () => {
    for (const bytes of [new Uint8Array(), new Uint8Array([0, 255, 128, 1])]) {
      const upload = { filename: 'file.custom', mediaType: 'application/octet-stream', bytes }
      expect(parseInput(ArtifactUploadSchema, upload)).toEqual(upload)
    }
  })

  it('rejects oversized bytes, unsafe names, header controls, and caller-supplied ownership', () => {
    const upload = { filename: 'file.zip', mediaType: 'application/zip', bytes: new Uint8Array() }
    for (const filename of ['', '../file', 'a\\\\b', 'a\r\nb', 'a\u0000b'])
      expect(() => parseInput(ArtifactUploadSchema, { ...upload, filename })).toThrow(TypeError)
    expect(() =>
      parseInput(ArtifactUploadSchema, { ...upload, mediaType: 'text/html\r\nx:y' }),
    ).toThrow(TypeError)
    expect(() => parseInput(ArtifactUploadSchema, { ...upload, owner: 'another-agent' })).toThrow(
      TypeError,
    )
    expect(() => parseInput(ArtifactUploadSchema, { ...upload, bytes: [1, 2] })).toThrow(TypeError)
    expect(() =>
      parseInput(ArtifactUploadSchema, {
        ...upload,
        bytes: new Uint8Array(MAX_ARTIFACT_BYTES + 1),
      }),
    ).toThrow('Artifact exceeds byte limit')
  })

  it('bounds list reads and accepts only exact safe notification sequences', () => {
    expect(parseInput(ExtensionPageSchema, {})).toEqual({ limit: 50 })
    expect(parseInput(NotificationQuerySchema, {})).toEqual({ limit: 50, unreadOnly: false })
    for (const limit of [0, 101, 1.5, Infinity])
      expect(() => parseInput(NotificationQuerySchema, { limit })).toThrow(TypeError)
    for (const seq of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
      expect(() => parseInput(NotificationReadSchema, { seq })).toThrow(TypeError)
    expect(parseInput(NotificationReadSchema, { seq: 1 })).toEqual({ seq: 1 })
  })
})

const v7 = '019a19ac-0000-7000-8000-00000000000a'
const v4 = '550e8400-e29b-41d4-a716-446655440000'

describe('public agent IDs', () => {
  it('accepts a lowercase canonical v7 ID', () => {
    expect(parseAgentId(v7)).toBe(v7)
  })

  it('rejects v4 and uppercase v7 IDs', () => {
    for (const id of [v4, v7.toUpperCase()]) {
      expect(() => parseAgentId(id)).toThrow('agentId must be a lowercase UUID v7')
    }
  })

  it('keeps UUIDs out of slugs, including rejected v4 IDs', () => {
    for (const id of [v4, v7]) {
      expect(() => parseInput(SlugSchema, id)).toThrow('slug cannot be a UUID')
    }
    expect(parseInput(SlugSchema, 'assistant')).toBe('assistant')
  })
})

describe('messages', () => {
  it('accepts request IDs of 1–128 letters, digits, underscores, or hyphens', () => {
    for (const id of ['a', 'A-z_09', 'r'.repeat(128)]) expect(parseRequestId(id)).toBe(id)
    for (const id of ['', 'r'.repeat(129), 'has space', 'dot.ted', 'slash/ed', 'é']) {
      expect(() => parseRequestId(id)).toThrow('requestId')
    }
  })

  it('accepts content of up to 16,000 characters', () => {
    const content = 'x'.repeat(16_000)
    expect(parseMessage({ requestId: 'max', content })).toEqual({ requestId: 'max', content })
    expect(() => parseMessage({ requestId: 'over', content: `${content}x` })).toThrow('content')
  })
})
