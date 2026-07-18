import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { buildProductStubDoc, getSanityWriteClient } from "../lib/sanity/product-stub"

export type UpsertSanityStubInput = {
  product_id: string
}

type ResolvedProduct = {
  handle: string
  thumbnail?: string | null
}

const resolveProductStep = createStep(
  "resolve-product-for-sanity-stub",
  async (input: UpsertSanityStubInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "product",
      fields: ["handle", "thumbnail"],
      filters: { id: input.product_id },
    })

    const product = data?.[0] as unknown as ResolvedProduct | undefined
    if (!product?.handle) {
      throw new Error(
        `Product ${input.product_id} not found (or has no handle) for Sanity stub.`
      )
    }

    return new StepResponse({ handle: product.handle, thumbnail: product.thumbnail })
  }
)

const upsertStubStep = createStep(
  "upsert-sanity-product-stub",
  async (product: ResolvedProduct, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const client = getSanityWriteClient()
    // Skip cleanly when unconfigured so local/dev boots without Sanity creds
    // (same pattern as the platform-notification workflow).
    if (!client) {
      logger.warn(
        "SANITY_PROJECT_ID/DATASET/WRITE_TOKEN not set; skipping productDescription stub."
      )
      return new StepResponse({ skipped: true, handle: product.handle })
    }

    const doc = buildProductStubDoc(product.handle, product.thumbnail)

    // createIfNotExists (NOT createOrReplace): seed the stub without ever
    // overwriting marketing's editorial edits on re-runs. medusaThumbnailUrl
    // is Medusa-owned (Studio preview only), so it's kept fresh via a
    // separate patch — safe even when the stub already existed.
    await client.createIfNotExists(doc)
    if (doc.medusaThumbnailUrl) {
      await client.patch(doc._id).set({ medusaThumbnailUrl: doc.medusaThumbnailUrl }).commit()
    }

    return new StepResponse({ skipped: false, handle: product.handle, docId: doc._id })
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
