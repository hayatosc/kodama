/**
 * Checks applied to text before it becomes memory (docs/design/long-term-memory.md, Remember and
 * Shared memory): secrets are replaced, and text that tries to instruct the memory system is
 * rejected.
 */

const SECRET_PATTERNS: readonly RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxai-[A-Za-z0-9]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/gi,
]

/** `NAME=value` where the name says it is a credential. */
const SECRET_ASSIGNMENT =
  /\b([A-Za-z][A-Za-z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z0-9_]*)\s*[=:]\s*["']?[^\s"']+["']?/gi

const REDACTED = '[REDACTED]'

/** Replace credentials with a marker. */
export function redactSecrets(text: string): string {
  let redacted = text.replace(SECRET_ASSIGNMENT, `$1=${REDACTED}`)
  for (const pattern of SECRET_PATTERNS) redacted = redacted.replace(pattern, REDACTED)
  return redacted
}

const INJECTION_PATTERNS: readonly RegExp[] = [
  /\bignore (?:all |any )?(?:previous|prior|earlier|above) (?:instructions|rules|messages)\b/i,
  /\bdisregard (?:all |any )?(?:previous|prior|earlier|your) (?:instructions|rules)\b/i,
  /<\/?(?:system|instructions|memory)>/i,
  /\byou are now\b/i,
  /以前の指示を(?:すべて)?無視/,
  /システムプロンプトを(?:無視|変更|上書き)/,
]

/** Text that tries to instruct whoever later reads it, rather than state something to keep. */
export function looksLikeInjection(text: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(text))
}
