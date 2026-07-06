import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { backfillProductStubs } from "../lib/sanity/product-stub"

/**
 * One-off backfill: creates a Sanity `productDescription` stub for every existing
 * Medusa product (the catalog was imported before the `product.*` subscriber
 * existed). Reuses the SAME logic as the admin route
 * (`src/api/admin/backfill-sanity-stubs/route.ts`), so there is one
 * stub-creation code path for bulk runs. Idempotent (createIfNotExists), so it
 * is safe to re-run.
 *
 * Run: `npx medusa exec ./src/scripts/backfill-sanity-stubs.ts`
 */
export default async function backfillSanityStubs({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const result = await backfillProductStubs(container)
  logger.info(`Backfill complete. ${JSON.stringify(result)}`)
}
