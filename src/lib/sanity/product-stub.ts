import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createClient, SanityClient } from "@sanity/client"

export type ProductStubDoc = {
  _id: string
  _type: "productDescription"
  language: "es"
  medusaHandle: string
  medusaThumbnailUrl?: string
}

/**
 * Returns a configured Sanity write client, or `null` when SANITY_* env vars
 * are not set (dev/local without Sanity creds). Shared by the per-product
 * subscriber workflow and the bulk backfill so there is one place that reads
 * these env vars.
 */
export function getSanityWriteClient(): SanityClient | null {
  const projectId = process.env.SANITY_PROJECT_ID
  const dataset = process.env.SANITY_DATASET
  const token = process.env.SANITY_WRITE_TOKEN
  const apiVersion = process.env.SANITY_API_VERSION || "2025-01-01"

  if (!projectId || !dataset || !token) {
    return null
  }

  return createClient({
    projectId,
    dataset,
    apiVersion,
    token,
    useCdn: false,
  })
}

/**
 * Builds the `productDescription` stub document for a product handle.
 *
 * Deterministic id keyed by handle so re-runs never duplicate. It MUST be
 * dot-free: Sanity treats any document whose `_id` contains a dot as private,
 * so the public/CDN API silently returns nothing for it. We use dashes and a
 * `-es` suffix because productDescription uses the document-internationalization
 * plugin; the ES document is the stub, EN is added later by editors (the plugin
 * gives EN its own random id, which is already dot-free).
 *
 * `medusaThumbnailUrl` is Medusa's own base image (S3), used ONLY for a
 * legible thumbnail in the Sanity Studio document list — it is not the
 * public PDP gallery (that's the editorial `images` field, set by marketing).
 * Being Medusa-owned, it is safe to keep overwriting on every sync.
 */
export function buildProductStubDoc(
  handle: string,
  thumbnail?: string | null
): ProductStubDoc {
  return {
    _id: `productDescription-${handle}-es`,
    _type: "productDescription",
    language: "es",
    medusaHandle: handle,
    ...(thumbnail ? { medusaThumbnailUrl: thumbnail } : {}),
  }
}

export type BackfillResult = {
  total: number
  committed: number
  skipped: boolean
}

const CHUNK_SIZE = 100

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size))
  }
  return chunks
}

/**
 * Creates a Sanity `productDescription` stub for every existing Medusa
 * product in ONE (or a few, chunked) transaction commits — not one workflow
 * run per product. A per-product workflow run takes ~1s (workflow engine
 * overhead), which is fine for the event subscriber but would blow past an
 * HTTP request timeout for ~80+ products on Medusa Cloud (no background
 * jobs there). `createIfNotExists` keeps it idempotent and non-destructive,
 * so it is safe to re-run from the CLI script or the admin route.
 */
export async function backfillProductStubs(
  container: MedusaContainer
): Promise<BackfillResult> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const client = getSanityWriteClient()
  if (!client) {
    logger.warn(
      "SANITY_PROJECT_ID/DATASET/WRITE_TOKEN not set; skipping Sanity stub backfill."
    )
    return { total: 0, committed: 0, skipped: true }
  }

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "thumbnail"],
  })
  const withHandle = products
    .map((p) => ({ handle: p.handle, thumbnail: p.thumbnail as string | null | undefined }))
    .filter(
      (p): p is { handle: string; thumbnail: string | null | undefined } =>
        Boolean(p.handle)
    )

  let committed = 0
  for (const batch of chunk(withHandle, CHUNK_SIZE)) {
    let transaction = client.transaction()
    for (const product of batch) {
      const doc = buildProductStubDoc(product.handle, product.thumbnail)
      // createIfNotExists seeds new stubs; the patch keeps medusaThumbnailUrl
      // fresh on stubs that already existed (createIfNotExists is a no-op for
      // those), without touching marketing's editorial fields.
      transaction = transaction.createIfNotExists(doc)
      if (doc.medusaThumbnailUrl) {
        transaction = transaction.patch(doc._id, {
          set: { medusaThumbnailUrl: doc.medusaThumbnailUrl },
        })
      }
    }
    await transaction.commit({ visibility: "async" })
    committed += batch.length
  }

  logger.info(
    `Sanity stub backfill: ${committed}/${products.length} products processed.`
  )

  return { total: products.length, committed, skipped: false }
}
