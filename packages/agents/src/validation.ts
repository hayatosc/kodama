/**
 * Valibot schemas for untrusted RPC input. Every failure throws a `TypeError`, so a transport can
 * report a client error.
 *
 * @module
 */
import * as v from 'valibot'
import { validate } from 'uuid'
import { AGENT_KINDS, AGENT_STATUSES } from '../drizzle/management/schema.ts'
import { UUID_PATTERN } from './lib/uuid.ts'
import type { ManagementActor, RenameAgentRequest, SendMessageRequest } from './protocol.ts'

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

const agentIdMessage = 'agentId must be a lowercase UUID v7'

/** A public agent ID: a lowercase v7 UUID. Reserved names such as `kodama:memory` fail. */
export const AgentIdSchema = v.pipe(v.string(agentIdMessage), v.regex(UUID_PATTERN, agentIdMessage))

const slugMessage = 'slug must contain 1–48 lowercase letters, digits, or hyphens'

/** An agent's alias: 1–48 lowercase letters, digits, or hyphens, and not UUID-shaped. */
export const SlugSchema = v.pipe(
  v.string(slugMessage),
  v.regex(/^[a-z0-9-]{1,48}$/, slugMessage),
  v.check((slug) => !validate(slug), 'slug cannot be a UUID'),
)

const refMessage = 'Expected an agent UUID, slug, or UUID prefix'

/** What a person types to name an agent: a UUID, a slug, or a UUID prefix of 4 or more. */
export const AgentRefSchema = v.pipe(
  v.string(refMessage),
  v.toLowerCase(),
  v.regex(/^[a-z0-9-]{1,48}$/, refMessage),
)

const displayNameMessage = 'displayName must contain 1–100 characters and cannot be blank'

/** A display name: nonblank, at most 100 characters. */
export const DisplayNameSchema = v.pipe(
  v.string(displayNameMessage),
  v.check((name) => name.trim().length > 0, displayNameMessage),
  v.maxLength(100, displayNameMessage),
)

/** The caller of the management methods on `AgentService`. */
export const ManagementActorSchema = v.strictObject(
  {
    kind: v.picklist(['user', 'service', 'agent'], 'actor.kind must be user, service, or agent'),
    externalId: v.pipe(v.string(), v.minLength(1), v.maxLength(320)),
  },
  'Expected an actor with kind and externalId',
) satisfies v.GenericSchema<unknown, ManagementActor>

/** A rename: at least one of the display name and the slug. */
export const RenameAgentSchema = v.pipe(
  v.strictObject(
    {
      displayName: v.optional(DisplayNameSchema),
      slug: v.optional(v.nullable(SlugSchema)),
    },
    'Expected displayName or slug',
  ),
  v.check(
    (change) => change.displayName !== undefined || change.slug !== undefined,
    'Expected displayName or slug',
  ),
) satisfies v.GenericSchema<unknown, RenameAgentRequest>

/** A version number: a positive integer. */
export const VersionSchema = v.pipe(
  v.number('version must be a positive integer'),
  v.integer('version must be a positive integer'),
  v.minValue(1, 'version must be a positive integer'),
)

/** The version an update builds on: 0 for an agent with no version yet. */
export const ExpectedVersionSchema = v.pipe(
  v.number('expectedVersion must be a non-negative integer'),
  v.integer('expectedVersion must be a non-negative integer'),
  v.minValue(0, 'expectedVersion must be a non-negative integer'),
)

/** An optional comment of a version. */
export const CommentSchema = v.optional(v.pipe(v.string(), v.maxLength(500)))
/** A request ID: 1–128 letters, digits, `_`, or `-`. */
export const RequestIdSchema = idSchema('requestId', 128)

/** Creation input; the flow validates settings against the model catalog. */
export const CreateAgentSchema = v.strictObject(
  {
    requestId: RequestIdSchema,
    displayName: DisplayNameSchema,
    slug: v.optional(SlugSchema),
    settings: v.optional(v.unknown()),
  },
  'Expected requestId and displayName',
)

/** A configuration update with optimistic version checking. */
export const UpdateConfigSchema = v.strictObject(
  {
    requestId: RequestIdSchema,
    settings: v.unknown(),
    expectedVersion: ExpectedVersionSchema,
    comment: CommentSchema,
  },
  'Expected requestId, settings, and expectedVersion',
)

/** A rollback writes a new version from a historical version. */
export const RollbackConfigSchema = v.strictObject(
  {
    requestId: RequestIdSchema,
    toVersion: VersionSchema,
    expectedVersion: ExpectedVersionSchema,
    comment: CommentSchema,
  },
  'Expected requestId, toVersion, and expectedVersion',
)

/** Optional registry filters. */
export const ListFilterSchema = v.strictObject({
  kind: v.optional(v.picklist(AGENT_KINDS)),
  status: v.optional(v.picklist(AGENT_STATUSES)),
})

/** A page of configuration versions. */
export const HistoryPageSchema = v.strictObject({
  before: v.optional(VersionSchema),
  limit: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
})

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
 * Parse a UUID, slug, or UUID prefix that names an agent.
 *
 * @throws {@link TypeError} When `value` cannot name an agent.
 */
export function parseAgentRef(value: unknown): string {
  return parseInput(AgentRefSchema, value)
}

/**
 * Parse the caller of the management methods on `AgentService`.
 *
 * @throws {@link TypeError} When `value` is not an actor.
 */
export function parseManagementActor(value: unknown): ManagementActor {
  return parseInput(ManagementActorSchema, value)
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
