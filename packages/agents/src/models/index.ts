/** Pi's provider catalog with explicit D1 credentials and no ambient authentication. @module */
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import type { CredentialStore } from '@earendil-works/pi-ai'
import type { Models } from '@earendil-works/pi-ai/models'

/** A catalog without a store validates model names but cannot authenticate requests. */
export function createAgentModels(credentials?: CredentialStore): Models {
  return builtinModels({
    ...(credentials ? { credentials } : {}),
    authContext: { env: async () => undefined, fileExists: async () => false },
  })
}
