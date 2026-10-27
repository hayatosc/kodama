/** Secret-safe text at persistence, provider and transport boundaries. @module */

/** Redact recognizable API keys and JWTs even before a credential has been decrypted. */
export function redactSecrets(text: string, known: Iterable<string> = []): string {
  let safe = text
  for (const secret of known) if (secret.length >= 8) safe = safe.split(secret).join('[REDACTED]')
  return safe
    .replace(/\b(?:sk|xai)-[A-Za-z0-9_-]{8,}/g, '[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[REDACTED]')
}

/** Clone protocol data, redact string values, and drop secret-bearing keys without collisions. */
export function redactData<T extends object>(
  value: T,
  redact: (text: string) => string = redactSecrets,
): T {
  const copy = structuredClone(value)
  function visit(item: unknown): void {
    if (typeof item !== 'object' || item === null) return
    for (const key of Object.keys(item)) {
      if (redact(key) !== key) {
        Reflect.deleteProperty(item, key)
        continue
      }
      const child: unknown = Reflect.get(item, key)
      if (typeof child === 'string') Reflect.set(item, key, redact(child))
      else visit(child)
    }
  }
  visit(copy)
  return copy
}

/** Keep exact-value redaction knowledge no longer than the decrypted cache's five-minute TTL. */
export function createRedactor(now: () => number = Date.now) {
  const known = new Map<string, number>()
  return {
    remember(this: void, secret: string) {
      known.set(secret, now() + 300_000)
    },
    text(this: void, value: string) {
      for (const [secret, until] of known) if (until <= now()) known.delete(secret)
      return redactSecrets(value, known.keys())
    },
  }
}
