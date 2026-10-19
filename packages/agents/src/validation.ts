import type { SendMessageRequest } from './protocol.ts'

export function validateId(
  value: unknown,
  name: string,
  maxLength: number,
): asserts value is string {
  if (typeof value !== 'string' || value.length > maxLength || !/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new TypeError(
      `${name} must contain 1–${maxLength} letters, digits, underscores or hyphens`,
    )
  }
}

export function validateMessage(value: unknown): asserts value is SendMessageRequest {
  if (typeof value !== 'object' || value === null || !('requestId' in value)) {
    throw new TypeError('Expected a message with requestId and content')
  }
  validateId(value.requestId, 'requestId', 128)
  if (
    'whenBusy' in value &&
    value.whenBusy !== undefined &&
    value.whenBusy !== 'followUp' &&
    value.whenBusy !== 'steer'
  ) {
    throw new TypeError('whenBusy must be followUp or steer')
  }
  if (
    !('content' in value) ||
    typeof value.content !== 'string' ||
    value.content.trim().length === 0 ||
    value.content.length > 16_000
  ) {
    throw new TypeError('content must contain 1–16000 characters and cannot be blank')
  }
}
