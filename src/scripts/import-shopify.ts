import { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { ShopifyClient } from "../lib/shopify/client"
import { importShopifyProductsWorkflow } from "../workflows/import-shopify-products"

function parseList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * Local entrypoint for the Shopify catalog import (`npm run import:shopify`).
 *
 * Discovery / pause: if neither SHOPIFY_DIGITAL_PRODUCT_TYPES nor
 * SHOPIFY_DIGITAL_TAGS is set, this lists the distinct productType + tags found
 * in active Shopify products and EXITS without importing — so you can confirm
 * which value(s) mark a product as digital, set the env var, and re-run.
 *
 * On Cloud, use the admin route (src/api/admin/import-shopify) instead, which
 * fires the same workflow asynchronously.
 */
export default async function importShopify({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

  const digitalProductTypes = parseList(process.env.SHOPIFY_DIGITAL_PRODUCT_TYPES)
  const digitalTags = parseList(process.env.SHOPIFY_DIGITAL_TAGS)
  const excludeProductTypes = parseList(process.env.SHOPIFY_EXCLUDE_PRODUCT_TYPES)

  if (!digitalProductTypes.length && !digitalTags.length) {
    logger.info(
      "No digital marker configured. Running discovery (no products will be imported)..."
    )
    const { productTypes, tags } = await ShopifyClient.fromEnv().fetchProductTypesAndTags()
    logger.info(`Distinct productType values (${productTypes.length}):`)
    logger.info(productTypes.length ? productTypes.join(" | ") : "(none)")
    logger.info(`Distinct tags (${tags.length}):`)
    logger.info(tags.length ? tags.join(" | ") : "(none)")
    logger.info(
      "Set SHOPIFY_DIGITAL_PRODUCT_TYPES and/or SHOPIFY_DIGITAL_TAGS in .env " +
        "(comma-separated) with the value(s) that mark a digital product, then re-run."
    )
    return
  }

  logger.info(
    `Importing active Shopify products (digital types: [${digitalProductTypes.join(
      ", "
    )}], digital tags: [${digitalTags.join(", ")}])...`
  )

  const { result } = await importShopifyProductsWorkflow(container).run({
    input: { digitalProductTypes, digitalTags, excludeProductTypes },
  })

  const summary = result.upsert.summary
  logger.info("Shopify import complete:")
  logger.info(
    `  created=${summary.created} updated=${summary.updated} skipped=${summary.skipped} variants=${summary.variants}`
  )
  logger.info(
    `  imagesUploaded=${summary.imagesUploaded} inventoryLevels=${result.inventory.inventoryLevels}`
  )
  if (summary.errors.length) {
    logger.warn(`  errors=${summary.errors.length}:`)
    for (const err of summary.errors) {
      logger.warn(`    ${err.handle}: ${err.message}`)
    }
  }
}
