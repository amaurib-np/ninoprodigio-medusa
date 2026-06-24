import { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { randomUUID } from "crypto"
import { importShopifyProductsWorkflow } from "../../../workflows/import-shopify-products"

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((v) => String(v).trim()).filter(Boolean)
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean)
  }
  return []
}

type ImportRequestBody = {
  digital_product_types?: string[] | string
  digital_tags?: string[] | string
  exclude_product_types?: string[] | string
}

/**
 * Cloud entrypoint for the Shopify catalog import.
 *
 * Re-uploading ~80 products' images can exceed Cloud's request timeout, so this
 * does NOT run the import synchronously. It fires the durable workflow
 * asynchronously and returns 202 + a transaction id; progress is followed via
 * logs / workflow execution status. The workflow is idempotent (upsert by
 * handle), so re-triggering is safe.
 */
export async function POST(req: MedusaRequest, res: MedusaResponse) {
  const logger = req.scope.resolve(ContainerRegistrationKeys.LOGGER)
  const body = (req.body ?? {}) as ImportRequestBody

  const digitalProductTypes = parseList(
    body.digital_product_types ?? process.env.SHOPIFY_DIGITAL_PRODUCT_TYPES
  )
  const digitalTags = parseList(
    body.digital_tags ?? process.env.SHOPIFY_DIGITAL_TAGS
  )
  const excludeProductTypes = parseList(
    body.exclude_product_types ?? process.env.SHOPIFY_EXCLUDE_PRODUCT_TYPES
  )

  if (!digitalProductTypes.length && !digitalTags.length) {
    return res.status(400).json({
      message:
        "No digital marker provided. Send digital_product_types / digital_tags " +
        "in the body, or set SHOPIFY_DIGITAL_PRODUCT_TYPES / SHOPIFY_DIGITAL_TAGS in env.",
    })
  }

  const transactionId = `shopify-import-${randomUUID()}`

  // Fire-and-forget: do not await completion (avoids the request timeout). The
  // server process keeps the durable workflow running; failures are logged.
  void importShopifyProductsWorkflow(req.scope)
    .run({
      input: { digitalProductTypes, digitalTags, excludeProductTypes },
      context: { transactionId },
      throwOnError: false,
    })
    .then((res) => {
      const summary = res.result?.upsert?.summary
      logger.info(
        `[${transactionId}] Shopify import finished: ` +
          `created=${summary?.created ?? "?"} updated=${summary?.updated ?? "?"} ` +
          `errors=${summary?.errors?.length ?? "?"}`
      )
    })
    .catch((e) => {
      const message = e instanceof Error ? e.message : String(e)
      logger.error(`[${transactionId}] Shopify import failed: ${message}`)
    })

  return res.status(202).json({
    message: "Shopify import started.",
    transaction_id: transactionId,
  })
}
