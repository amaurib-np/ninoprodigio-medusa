import { addToCartWorkflow, completeCartWorkflow } from "@medusajs/medusa/core-flows"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { MedusaContainer } from "@medusajs/framework/types"

const MINUTES_TYPE = "minutes"

/**
 * Enforces the "one provider per cart" constraint from
 * docs/integration-contract.md: a cart paid by a single Stripe account cannot
 * mix minutes items (Gedelimbo) with physical/digital product items (Mundo).
 *
 * `type` is read from product metadata (`metadata.type === "minutes"`).
 */
async function assertNotMixed(
  container: MedusaContainer,
  productIds: string[]
): Promise<void> {
  const uniqueIds = Array.from(new Set(productIds.filter(Boolean)))
  if (uniqueIds.length === 0) {
    return
  }

  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const { data: products } = await query.graph({
    entity: "product",
    fields: ["id", "metadata"],
    filters: { id: uniqueIds },
  })

  let hasMinutes = false
  let hasNonMinutes = false
  for (const product of products) {
    const type = (product.metadata as Record<string, unknown> | null)?.type
    if (type === MINUTES_TYPE) {
      hasMinutes = true
    } else {
      hasNonMinutes = true
    }
  }

  if (hasMinutes && hasNonMinutes) {
    throw new MedusaError(
      MedusaError.Types.INVALID_DATA,
      "A cart cannot mix minutes packages with other products. Minutes must be purchased in a separate checkout (one Stripe account per cart)."
    )
  }
}

// Definitive guard: a mixed cart can never be completed into an order/payment.
completeCartWorkflow.hooks.validate(
  async ({ cart }: { cart: { items?: { product_id?: string }[] } }, { container }) => {
    const productIds = (cart?.items ?? [])
      .map((item) => item.product_id)
      .filter((id): id is string => Boolean(id))
    await assertNotMixed(container, productIds)
  }
)

// Early guard for better UX: reject adding an item that would mix the cart.
addToCartWorkflow.hooks.validate(
  async (
    {
      input,
      cart,
    }: {
      input: { items?: { variant_id?: string }[] }
      cart: { items?: { product_id?: string }[] }
    },
    { container }
  ) => {
    const existingProductIds = (cart?.items ?? [])
      .map((item) => item.product_id)
      .filter((id): id is string => Boolean(id))

    const incomingVariantIds = (input?.items ?? [])
      .map((item) => item.variant_id)
      .filter((id): id is string => Boolean(id))

    let incomingProductIds: string[] = []
    if (incomingVariantIds.length) {
      const query = container.resolve(ContainerRegistrationKeys.QUERY)
      const { data: variants } = await query.graph({
        entity: "variant",
        fields: ["id", "product_id"],
        filters: { id: incomingVariantIds },
      })
      incomingProductIds = variants
        .map((v) => v.product_id)
        .filter((id): id is string => Boolean(id))
    }

    await assertNotMixed(container, [...existingProductIds, ...incomingProductIds])
  }
)
