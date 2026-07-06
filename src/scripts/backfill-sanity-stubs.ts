import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { upsertSanityProductStubWorkflow } from "../workflows/upsert-sanity-product-stub"

/**
 * One-off backfill: creates a Sanity `productDescription` stub for every existing
 * Medusa product (the catalog was imported before the `product.*` subscriber
 * existed). Reuses the SAME workflow as the subscriber, so there is one
 * stub-creation code path. Idempotent (createIfNotExists), so it is safe to
 * re-run. Requires SANITY_* env; without it the workflow skips per product.
 *
 * Run: `npx medusa exec ./src/scripts/backfill-sanity-stubs.ts`
 */
export default async function backfillSanityStubs({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle"],
  })

  logger.info(`Backfilling Sanity stubs for ${products.length} products...`)

  let upserted = 0
  let skipped = 0
  let failed = 0

  for (const product of products) {
    try {
      const { result } = await upsertSanityProductStubWorkflow(container).run({
        input: { product_id: product.id },
      })
      if ((result as { skipped?: boolean })?.skipped) {
        skipped++
      } else {
        upserted++
      }
      // Gentle throttle to stay well within Sanity API rate limits on bulk runs.
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error) {
      failed++
      logger.error(
        `Sanity stub failed for product ${product.id} (${product.handle}): ${
          (error as Error).message
        }`
      )
    }
  }

  logger.info(
    `Backfill complete. upserted=${upserted} skipped=${skipped} failed=${failed}`
  )
}
