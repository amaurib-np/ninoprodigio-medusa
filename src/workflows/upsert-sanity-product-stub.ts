import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { createClient } from "@sanity/client"

export type UpsertSanityStubInput = {
  product_id: string
}

type ResolvedProduct = {
  handle: string
}

const resolveProductStep = createStep(
  "resolve-product-for-sanity-stub",
  async (input: UpsertSanityStubInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "product",
      fields: ["handle"],
      filters: { id: input.product_id },
    })

    const product = data?.[0] as unknown as ResolvedProduct | undefined
    if (!product?.handle) {
      throw new Error(
        `Product ${input.product_id} not found (or has no handle) for Sanity stub.`
      )
    }

    return new StepResponse({ handle: product.handle })
  }
)

const upsertStubStep = createStep(
  "upsert-sanity-product-stub",
  async (product: ResolvedProduct, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const projectId = process.env.SANITY_PROJECT_ID
    const dataset = process.env.SANITY_DATASET
    const token = process.env.SANITY_WRITE_TOKEN
    const apiVersion = process.env.SANITY_API_VERSION || "2025-01-01"

    // Skip cleanly when unconfigured so local/dev boots without Sanity creds
    // (same pattern as the platform-notification workflow).
    if (!projectId || !dataset || !token) {
      logger.warn(
        "SANITY_PROJECT_ID/DATASET/WRITE_TOKEN not set; skipping productDescription stub."
      )
      return new StepResponse({ skipped: true, handle: product.handle })
    }

    const client = createClient({
      projectId,
      dataset,
      apiVersion,
      token,
      useCdn: false,
    })

    // Deterministic id keyed by handle so re-runs never duplicate. `.es` because
    // productDescription uses the document-internationalization plugin; the ES
    // document is the stub, EN is added later by editors.
    const docId = `productDescription.${product.handle}.es`

    // createIfNotExists (NOT createOrReplace): seed the stub without ever
    // overwriting marketing's editorial edits on re-runs.
    await client.createIfNotExists({
      _id: docId,
      _type: "productDescription",
      language: "es",
      medusaHandle: product.handle,
    })

    return new StepResponse({ skipped: false, handle: product.handle, docId })
  }
)

/**
 * Upserts a Sanity `productDescription` stub for a Medusa product, keyed by the
 * product `handle`. Idempotent and non-destructive. Shared by the `product.*`
 * subscriber and the backfill script (`src/scripts/backfill-sanity-stubs.ts`)
 * so there is a single stub-creation code path. See
 * docs/integration-contract.md -> "Product content sync".
 */
export const upsertSanityProductStubWorkflow = createWorkflow(
  "upsert-sanity-product-stub",
  (input: UpsertSanityStubInput) => {
    const product = resolveProductStep(input)
    const result = upsertStubStep(product)
    return new WorkflowResponse(result)
  }
)
