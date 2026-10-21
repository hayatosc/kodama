/** Skill files by content: hashes, the blob store in R2, and the per-file change list (Storage). */
import * as v from 'valibot'
import { blobKey, MAX_SKILL_FILES } from './paths.ts'
import { sha256Hex } from '../../lib/hash.ts'

export const changesSchema = v.array(
  v.object({ path: v.string(), before: v.nullable(v.string()), after: v.nullable(v.string()) }),
)

export type FileChange = v.InferOutput<typeof changesSchema>[number]

/** The SHA-256 of each file in a skill directory. */
export async function currentFiles(bucket: R2Bucket, dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>()
  let cursor: string | undefined
  do {
    const page = await bucket.list({ prefix: dir, ...(cursor === undefined ? {} : { cursor }) })
    for (const object of page.objects) {
      const body = await bucket.get(object.key)
      if (body === null) continue
      files.set(
        object.key.slice(dir.length),
        await sha256Hex(new Uint8Array(await body.arrayBuffer())),
      )
    }
    cursor = page.truncated ? page.cursor : undefined
  } while (cursor !== undefined && files.size <= MAX_SKILL_FILES)
  return files
}

export async function contentSha256(files: ReadonlyMap<string, string>): Promise<string> {
  const lines = [...files].sort(([a], [b]) => (a < b ? -1 : 1)).map(([p, s]) => `${p}:${s}\n`)
  return sha256Hex(lines.join(''))
}

export async function storeBlob(bucket: R2Bucket, sha256: string, body: ArrayBuffer | string) {
  if ((await bucket.head(blobKey(sha256))) !== null) return
  await bucket.put(blobKey(sha256), body, { sha256 })
}
