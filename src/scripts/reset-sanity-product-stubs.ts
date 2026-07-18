import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import {
  backfillProductStubs,
  getSanityWriteClient,
} from "../lib/sanity/product-stub"

/**
 * One-off migration: the original `productDescription` stubs were created with a
 * dotted `_id` (`productDescription.<handle>.es`). Sanity treats any document
 * whose `_id` contains a dot as PRIVATE, so the public/CDN API returned nothing
 * for the whole type. Sanity cannot rename an `_id`, so we delete the old stubs
 * (and their translation metadata) and re-create them via the backfill, which
 * now emits dot-free ids (`productDescription-<handle>-es`).
 *
 * Destructive: removes every `productDescription` document (published + drafts),
 * every EN translation, and the linking `translation.metadata` docs. Editorial
 * content is NOT preserved — only run this while stubs are effectively empty.
 * Idempotent: safe to re-run (backfill uses createIfNotExists).
 *
 * Run: `npx medusa exec ./src/scripts/reset-sanity-product-stubs.ts`
 */
export default async function resetSanityProductStubs({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const client = getSanityWriteClient()
  if (!client) {
    logger.warn(
      "SANITY_PROJECT_ID/DATASET/WRITE_TOKEN not set; skipping Sanity stub reset."
    )
    return
  }

  // Delete translation metadata first (it references the productDescription
  // docs), then the docs themselves. Both delete-by-query mutations also match
  // draft documents, so in-progress EN drafts are removed too.
  const metaResult = await client.delete({
    query:
      '*[_type == "translation.metadata" && "productDescription" in schemaTypes]',
  })
  logger.info(
    `Deleted ${metaResult.results.length} translation.metadata doc(s) for productDescription.`
  )

  const docResult = await client.delete({
    query: '*[_type == "productDescription"]',
  })
  logger.info(
    `Deleted ${docResult.results.length} productDescription doc(s) (old dotted ids + translations).`
  )

  const result = await backfillProductStubs(container)
  logger.info(`Re-backfill complete. ${JSON.stringify(result)}`)
}
