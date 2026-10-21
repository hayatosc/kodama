/** The shared spaces an agent reads, stored next to the configuration Pi keeps. */
import * as v from 'valibot'
import { sharedSpacesSchema } from './index.ts'

export const SHARED_SPACES_KEY = 'kodama:shared-spaces'

export async function readSharedSpaces(
  storage: DurableObjectStorage,
  defaults: readonly string[],
): Promise<string[]> {
  const stored = v.safeParse(sharedSpacesSchema, await storage.get(SHARED_SPACES_KEY))
  return stored.success ? stored.output : [...defaults]
}

export function writeSharedSpaces(
  storage: DurableObjectStorage,
  spaces: readonly string[],
): Promise<void> {
  return storage.put(SHARED_SPACES_KEY, [...spaces])
}
