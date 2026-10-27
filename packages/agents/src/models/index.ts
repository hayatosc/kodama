/** Pi's provider catalog with explicit D1 credentials and no ambient authentication. @module */
import { builtinModels } from '@earendil-works/pi-ai/providers/all'
import { registerBunOAuthFlows } from '@earendil-works/pi-ai/bun-oauth'
import type { CredentialStore } from '@earendil-works/pi-ai'
import type { Models } from '@earendil-works/pi-ai/models'

// Pi's public static-loader hook also serves Worker bundles: variable relative imports
// otherwise point into Vite's dependency cache, where the OAuth modules do not exist.
registerBunOAuthFlows()

/** A catalog without a store validates model names but cannot authenticate requests. */
export function createAgentModels(credentials?: CredentialStore): Models {
  return builtinModels({
    ...(credentials ? { credentials } : {}),
    authContext: { env: async () => undefined, fileExists: async () => false },
  })
}
