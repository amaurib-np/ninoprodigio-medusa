import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { seedStore } from "../../../lib/seed/seed-store"

/**
 * Cloud entrypoint for the store baseline seed (USD region, stock location,
 * sales channel + publishable key, shipping profiles + options).
 *
 * Medusa Cloud has no CLI exec/SSH, so the seed that runs via `npm run seed`
 * locally is triggered here instead. It is idempotent (no-op if a USD region
 * already exists) and fast enough to run synchronously within the request.
 *
 * Routes under `src/api/admin` are protected by Medusa's admin auth, so this
 * requires an authenticated admin (bearer token or session).
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  try {
    const result = await seedStore(req.scope)
    return res.status(200).json({
      message: result.alreadySeeded
        ? "Store already seeded; no changes made."
        : "Store seeded successfully.",
      already_seeded: result.alreadySeeded,
      ...(result.publishableKey
        ? { publishable_api_key: result.publishableKey }
        : {}),
    })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error(`Store seed failed: ${message}`)
    return res.status(500).json({ message: `Seed failed: ${message}` })
  }
}
