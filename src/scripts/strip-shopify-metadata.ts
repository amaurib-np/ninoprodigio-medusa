import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * One-off cleanup: removes leftover `shopify_*` metadata keys from every product
 * (the Shopify import stamped shopify_handle / shopify_image_ids /
 * shopify_product_id / shopify_product_type). We no longer use Shopify and
 * nothing in either repo reads these keys, so they are dead data.
 *
 * Idempotent (safe to re-run). Run:
 *   npx medusa exec ./src/scripts/strip-shopify-metadata.ts
 */
const PREFIX = "shopify_"

export default async function stripShopifyMetadata({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productService = container.resolve(Modules.PRODUCT)

  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "handle", "metadata"],
  })

  let updated = 0
  for (const product of products) {
    const metadata = product.metadata as Record<string, unknown> | null
    if (!metadata) continue

    const shopifyKeys = Object.keys(metadata).filter((key) =>
      key.toLowerCase().startsWith(PREFIX)
    )
    if (!shopifyKeys.length) continue

    const cleaned: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(metadata)) {
      if (!key.toLowerCase().startsWith(PREFIX)) cleaned[key] = value
    }

    await productService.updateProducts(product.id, { metadata: cleaned })
    updated++
    logger.info(`${product.handle}: removed ${shopifyKeys.join(", ")}`)
  }

  logger.info(`Stripped Shopify metadata from ${updated} product(s).`)
}
