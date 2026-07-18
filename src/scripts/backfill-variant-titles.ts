import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { syncSingleVariantTitle } from "../lib/product/sync-variant-title"

/**
 * One-off backfill: applies the single-variant title sync (see
 * src/lib/product/sync-variant-title.ts) to the existing catalog, replacing the
 * "Default variant" / "Default Title" placeholders with each product's title.
 * The subscriber handles this going forward; this fixes products created before
 * it existed. Idempotent (safe to re-run). Run:
 *   npx medusa exec ./src/scripts/backfill-variant-titles.ts
 */
export default async function backfillVariantTitles({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
  })

  let changed = 0
  for (const product of products) {
    if (await syncSingleVariantTitle(container, product.id)) {
      changed++
      logger.info(`synced ${product.handle}`)
    }
  }

  logger.info(`Variant title backfill: ${changed}/${products.length} updated.`)
}
