import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { upsertSanityProductStubWorkflow } from "../workflows/upsert-sanity-product-stub"

/**
 * On product create/update, ensure a Sanity `productDescription` stub exists
 * (keyed by handle) so marketing can enrich it. Idempotent + non-destructive:
 * `createIfNotExists` means updates never clobber editorial edits. Medusa owns
 * commerce data; Sanity owns editorial. See docs/integration-contract.md.
 */
export default async function productStubHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  await upsertSanityProductStubWorkflow(container).run({
    input: { product_id: event.data.id },
  })
}

export const config: SubscriberConfig = {
  event: ["product.created", "product.updated"],
}
