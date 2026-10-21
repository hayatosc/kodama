import * as v from 'valibot'
import type { ProposalDecisionRequest, SendMessageRequest } from './protocol.ts'

const ID_PATTERN = /^[a-zA-Z0-9_-]+$/

/** Parse untrusted input; failures surface as TypeError so transports can report a client error. */
export function parseInput<const TSchema extends v.GenericSchema>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, value, { abortEarly: true })
  if (result.success) return result.output
  throw new TypeError(result.issues[0].message)
}

export function idSchema(name: string, maxLength: number) {
  const message = `${name} must contain 1–${maxLength} letters, digits, underscores or hyphens`
  return v.pipe(v.string(message), v.maxLength(maxLength, message), v.regex(ID_PATTERN, message))
}

export const AgentIdSchema = idSchema('agentId', 64)
export const RequestIdSchema = idSchema('requestId', 128)

const MESSAGE_CONTENT_MAX_LENGTH = 16_000
const contentMessage = `content must contain 1–${MESSAGE_CONTENT_MAX_LENGTH} characters and cannot be blank`

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

export function parseAgentId(value: unknown): string {
  return parseInput(AgentIdSchema, value)
}

export function parseRequestId(value: unknown): string {
  return parseInput(RequestIdSchema, value)
}

export function parseMessage(value: unknown): SendMessageRequest {
  return parseInput(SendMessageRequestSchema, value)
}

const SPACE_MESSAGE = 'space must contain 1–64 lowercase letters, digits, or hyphens'
export const SpaceSchema = v.pipe(
  v.string(SPACE_MESSAGE),
  v.regex(/^[a-z0-9-]{1,64}$/, SPACE_MESSAGE),
)
export const ProposalIdSchema = v.pipe(
  v.string('Expected a proposal ID'),
  v.regex(/^[0-9a-f]{64}$/, 'Expected a proposal ID'),
)
export const ProposalStatusSchema = v.picklist(
  ['pending', 'accepted', 'applied', 'rejected', 'conflict'],
  'Invalid proposal status',
)

export const ProposalDecisionSchema = v.strictObject(
  {
    decision: v.picklist(['accept', 'reject'], 'decision must be accept or reject'),
    reason: v.pipe(v.string(), v.maxLength(2_000, 'reason has at most 2000 characters')),
    decidedBy: v.pipe(
      v.string(),
      v.minLength(1, 'decidedBy names the reviewer'),
      v.maxLength(200, 'decidedBy has at most 200 characters'),
    ),
  },
  'Expected a decision with decision, reason, and decidedBy',
) satisfies v.GenericSchema<unknown, ProposalDecisionRequest>
