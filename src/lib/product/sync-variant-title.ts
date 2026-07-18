import { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * For a single-variant (optionless) product, sync the variant title and its
 * inventory item title to the PRODUCT title, instead of Medusa's "Default
 * variant" / "Default Title" placeholder. Returns true if anything changed.
 *
 * Only touches single-variant products (`variants.length === 1`). Multi-variant
 * products name their variants by option values like "Red / L", which must not
 * be overwritten. Note: optionless products are NOT `options.length === 0` in
 * Medusa — they carry a placeholder option ("Title" -> "Default Title", or
 * "Default option value" from the admin), so we key off the variant count, not
 * the options. Idempotent: only writes when a title differs, so the subscriber
 * never loops on its own product.updated event.
 */
export async function syncSingleVariantTitle(
  container: MedusaContainer,
  productId: string
): Promise<boolean> {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const productService = container.resolve(Modules.PRODUCT)
  const inventoryService = container.resolve(Modules.INVENTORY)

  const { data } = await query.graph({
    entity: "product",
    filters: { id: productId },
    fields: [
      "id",
      "title",
      "variants.id",
      "variants.title",
      "variants.inventory_items.inventory.id",
      "variants.inventory_items.inventory.title",
    ],
  })

  const product = data?.[0]
  if (!product?.title) return false
  if (product.variants?.length !== 1) return false

  const variant = product.variants[0]
  let changed = false

  if (variant.title !== product.title) {
    await productService.updateProductVariants(variant.id, { title: product.title })
    changed = true
  }

  const inventoryItem = variant.inventory_items?.[0]?.inventory
  if (inventoryItem?.id && inventoryItem.title !== product.title) {
    await inventoryService.updateInventoryItems([
      { id: inventoryItem.id, title: product.title },
    ])
    changed = true
  }

  return changed
}
