import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

/**
 * On product delete, we do NOT destroy the Sanity `productDescription` stub:
 * marketing may have added editorial content, and the delete event only carries
 * the product id (not the handle we key the Sanity doc on). For now we log so the
 * deletion is traceable; a deliberate archival policy (unpublish vs keep) is
 * deferred. Products are normally set to a non-published status rather than
 * hard-deleted, which flows through the create/update stub subscriber.
 */
export default async function productDeletedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  logger.info(
    `product.deleted (${event.data.id}); leaving any Sanity productDescription stub intact (archival policy deferred).`
  )
}

export const config: SubscriberConfig = {
  event: "product.deleted",
}
