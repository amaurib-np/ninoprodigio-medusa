import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { backfillProductStubs } from "../../../lib/sanity/product-stub"

/**
 * Cloud entrypoint for the Sanity `productDescription` stub backfill (one-off,
 * safe to re-run). Medusa Cloud has no CLI exec/SSH, so the backfill that runs
 * via `npx medusa exec ./src/scripts/backfill-sanity-stubs.ts` locally is
 * triggered here instead.
 *
 * Commits all products in one (or a few, chunked) Sanity transaction(s) rather
 * than one workflow run per product, so it stays well within an HTTP request
 * timeout even for a full ~80+ product catalog. Idempotent (createIfNotExists)
 * and non-destructive to any editorial content already in Sanity.
 *
 * Routes under `src/api/admin` are protected by Medusa's admin auth, so this
 * requires an authenticated admin (bearer token or session).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const result = await backfillProductStubs(req.scope)
    return res.status(200).json({
      message: result.skipped
        ? "SANITY_* env not configured; no changes made."
        : `Backfilled ${result.committed}/${result.total} products.`,
      ...result,
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error(`Sanity stub backfill failed: ${message}`)
    return res.status(500).json({ message: `Backfill failed: ${message}` })
  }
}
