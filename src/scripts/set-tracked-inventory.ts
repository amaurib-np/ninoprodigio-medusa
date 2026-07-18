import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

/**
 * One-off inventory experiment for the products that track inventory.
 *
 * The Shopify import left 9 products with `manage_inventory = true` but 0 stock
 * and no backorder, so they were unsellable ("Default Title" rows at 0 in
 * /app/inventory). This:
 *   1. Renames the (single) stock location to "1800 Warehouse" if needed.
 *   2. Assigns a short, category-based SKU (CHK-001, RIT-001, ARC-001...) to
 *      both the variant and its inventory item, and sets the inventory item
 *      title to the product title, so the admin inventory list is legible.
 *   3. Sets the configured stock at the warehouse (0 is allowed = in list but
 *      out of stock).
 *
 * SKU = <category prefix>-<3-digit sequence>. The sequence is assigned per
 * category across the handles processed here (sorted by handle). A full-catalog
 * rollout should sequence across ALL products in each category, not just this
 * tracked subset.
 *
 * Idempotent (safe to re-run). Run:
 *   npx medusa exec ./src/scripts/set-tracked-inventory.ts
 */
const WAREHOUSE_NAME = "1800 Warehouse"

// handle -> stocked quantity at the warehouse
const STOCK: Record<string, number> = {
  "chakra-muladhara-raiz": 10,
  "chakra-svadhisthana-bazo": 10,
  "chakra-manipura-plexo-solar": 10,
  "chakra-anahata-corazon": 10,
  "chakra-vishudha-purificacion": 10,
  "chakra-del-tercer-ojo-o-ajna": 10,
  "chakra-corona-o-sahasrara": 10,
  "ritual-de-sellamiento-del-amor": 1,
  "invocacion-espiritual-al-arcangel-de-la-justicia": 0,
}

// Curated 3-letter SKU prefixes per category. Unlisted categories fall back to
// the accent-stripped first 3 letters of the category name (or "NP").
const CATEGORY_PREFIX: Record<string, string> = {
  Chakras: "CHK",
  Rituales: "RIT",
  Arcángeles: "ARC",
}

function prefixForCategory(categoryName?: string): string {
  if (!categoryName) return "NP"
  if (CATEGORY_PREFIX[categoryName]) return CATEGORY_PREFIX[categoryName]
  const normalized = categoryName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
  return normalized.slice(0, 3) || "NP"
}

type Entry = {
  handle: string
  title: string
  variantId: string
  inventoryItemId: string
  prefix: string
  sku: string
}

export default async function setTrackedInventory({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const stockLocationService = container.resolve(Modules.STOCK_LOCATION)
  const inventoryService = container.resolve(Modules.INVENTORY)
  const productService = container.resolve(Modules.PRODUCT)

  const handles = Object.keys(STOCK)

  // 1. Resolve the (single) seeded stock location and normalize its name.
  const locations = await stockLocationService.listStockLocations({})
  const location = locations[0]
  if (!location) {
    throw new Error("No stock location found; run the store seed first.")
  }
  if (location.name !== WAREHOUSE_NAME) {
    await stockLocationService.updateStockLocations(location.id, {
      name: WAREHOUSE_NAME,
    })
    logger.info(`Renamed stock location "${location.name}" -> "${WAREHOUSE_NAME}".`)
  }
  const locationId = location.id

  // 2. Resolve products -> first variant -> linked inventory item + category.
  const { data: products } = await query.graph({
    entity: "product",
    filters: { handle: handles },
    fields: [
      "id",
      "title",
      "handle",
      "categories.name",
      "variants.id",
      "variants.manage_inventory",
      "variants.inventory_items.inventory.id",
    ],
  })

  // 3. Build entries and assign a per-category sequence (sorted by handle).
  const entries: Entry[] = []
  for (const handle of handles) {
    const product = products.find((p) => p.handle === handle)
    if (!product) {
      logger.warn(`Product not found for handle "${handle}"; skipping.`)
      continue
    }
    const variant = product.variants?.[0]
    const inventoryItemId = variant?.inventory_items?.[0]?.inventory?.id
    if (!variant?.id || !inventoryItemId) {
      logger.warn(
        `No variant/inventory item for "${handle}" (manage_inventory=${variant?.manage_inventory}); skipping.`
      )
      continue
    }
    entries.push({
      handle,
      title: product.title,
      variantId: variant.id,
      inventoryItemId,
      prefix: prefixForCategory(product.categories?.[0]?.name),
      sku: "",
    })
  }

  const byPrefix: Record<string, Entry[]> = {}
  for (const entry of entries) {
    ;(byPrefix[entry.prefix] ||= []).push(entry)
  }
  for (const prefix of Object.keys(byPrefix)) {
    byPrefix[prefix]
      .sort((a, b) => a.handle.localeCompare(b.handle))
      .forEach((entry, index) => {
        entry.sku = `${prefix}-${String(index + 1).padStart(3, "0")}`
      })
  }

  // 4. Apply SKU (variant + inventory item), title, and stock level.
  for (const entry of entries) {
    await productService.updateProductVariants(entry.variantId, { sku: entry.sku })
    await inventoryService.updateInventoryItems([
      { id: entry.inventoryItemId, sku: entry.sku, title: entry.title },
    ])

    const quantity = STOCK[entry.handle]
    const existingLevels = await inventoryService.listInventoryLevels({
      inventory_item_id: entry.inventoryItemId,
      location_id: locationId,
    })
    if (existingLevels.length) {
      await inventoryService.updateInventoryLevels([
        {
          inventory_item_id: entry.inventoryItemId,
          location_id: locationId,
          stocked_quantity: quantity,
        },
      ])
    } else {
      await inventoryService.createInventoryLevels([
        {
          inventory_item_id: entry.inventoryItemId,
          location_id: locationId,
          stocked_quantity: quantity,
        },
      ])
    }
    logger.info(`${entry.handle}: sku=${entry.sku}, stock=${quantity} @ ${WAREHOUSE_NAME}.`)
  }

  logger.info("Tracked inventory experiment complete.")
}
