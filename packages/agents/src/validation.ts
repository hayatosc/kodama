/**
 * Valibot schemas for untrusted RPC input. Every failure throws a `TypeError`, so a transport can
 * report a client error.
 *
 * @module
 */
import * as v from 'valibot'
import type { SendMessageRequest } from './protocol.ts'

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * Parse untrusted input against `schema`.
 *
 * @throws {@link TypeError} With the first issue's message, when the input does not match.
 */
export function parseInput<const TSchema extends v.GenericSchema>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, value, { abortEarly: true })
  if (result.success) return result.output
  throw new TypeError(result.issues[0].message)
}

/**
 * A schema for an ID of 1 to `maxLength` letters, digits, underscores, or hyphens.
 *
 * @param name - The field name used in the error message.
 */
export function idSchema(name: string, maxLength: number) {
  const message = `${name} must contain 1–${maxLength} letters, digits, underscores or hyphens`
  return v.pipe(v.string(message), v.maxLength(maxLength, message), v.regex(ID_PATTERN, message))
}

/** A public agent ID: 1–64 letters, digits, `_`, or `-`. */
export const AgentIdSchema = idSchema('agentId', 64)
/** A request ID: 1–128 letters, digits, `_`, or `-`. */
export const RequestIdSchema = idSchema('requestId', 128)

const MESSAGE_CONTENT_MAX_LENGTH = 16_000
const contentMessage = `content must contain 1–${MESSAGE_CONTENT_MAX_LENGTH} characters and cannot be blank`

/** A message: a request ID, nonblank content of at most 16,000 characters, and `whenBusy`. */
export const SendMessageRequestSchema = v.object(
  {
    requestId: RequestIdSchema,
    content: v.pipe(
      v.string(contentMessage),
      v.check((content) => content.trim().length > 0, contentMessage),
      v.maxLength(MESSAGE_CONTENT_MAX_LENGTH, contentMessage),
    ),
    whenBusy: v.optional(v.picklist(['followUp', 'steer'], 'whenBusy must be followUp or steer')),
  },
  'Expected a message with requestId and content',
) satisfies v.GenericSchema<unknown, SendMessageRequest>

/**
 * Parse a public agent ID.
 *
 * @throws {@link TypeError} When `value` is not a valid public agent ID.
 */
export function parseAgentId(value: unknown): string {
  return parseInput(AgentIdSchema, value)
}

/**
 * Parse a request ID.
 *
 * @throws {@link TypeError} When `value` is not a valid request ID.
 */
export function parseRequestId(value: unknown): string {
  return parseInput(RequestIdSchema, value)
}

/**
 * Parse a message to send.
 *
 * @throws {@link TypeError} When `value` is not a valid message.
 */
export function parseMessage(value: unknown): SendMessageRequest {
  return parseInput(SendMessageRequestSchema, value)
}
