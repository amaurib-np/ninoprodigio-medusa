import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { linkCustomerWorkflow } from "../../../workflows/link-customer"
import type { PostStoreLinkCustomerSchema } from "./validators"

/**
 * Find-or-create a Medusa customer by email and optionally attach them to a cart.
 *
 * Called server-side from the Next.js platform (never from the browser). Protected
 * by `x-platform-secret` in addition to the publishable API key, because store
 * routes are otherwise open to anyone with the public key.
 *
 * See docs/integration-contract.md → "Customer mapping".
 */
export async function POST(
  req: MedusaRequest<PostStoreLinkCustomerSchema>,
  res: MedusaResponse
) {
  const expected = process.env.PLATFORM_SHARED_SECRET
  const provided = req.headers["x-platform-secret"]

  if (!expected) {
    throw new MedusaError(
      MedusaError.Types.UNEXPECTED_STATE,
      "PLATFORM_SHARED_SECRET is not configured on this Medusa instance."
    )
  }

  if (typeof provided !== "string" || provided !== expected) {
    throw new MedusaError(
      MedusaError.Types.NOT_ALLOWED,
      "Invalid or missing x-platform-secret header."
    )
  }

  const { email, cart_id, first_name, last_name } = req.validatedBody

  const { result } = await linkCustomerWorkflow(req.scope).run({
    input: { email, cart_id, first_name, last_name },
  })

  return res.status(200).json({ customer: result.customer })
}
