import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { syncSingleVariantTitle } from "../lib/product/sync-variant-title"

/**
 * On product create/update, for single-variant (optionless) products, set the
 * variant + inventory item title to the product title so the admin variant and
 * /app/inventory lists are legible instead of showing "Default variant" /
 * "Default Title". No manual per-product entry needed. See
 * src/lib/product/sync-variant-title.ts for the (idempotent, loop-safe) logic.
 */
export default async function syncVariantTitleHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const changed = await syncSingleVariantTitle(container, event.data.id)
  if (changed) {
    logger.info(`Synced single-variant title to product title (${event.data.id}).`)
  }
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
