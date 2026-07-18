import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export type SendOrderConfirmationInput = {
  order_id: string
}

const sendOrderConfirmationStep = createStep(
  { name: "send-order-confirmation-email", maxRetries: 3, retryInterval: 30 },
  async (input: SendOrderConfirmationInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    // Email is only sent when an email-channel provider (Resend) is configured.
    if (!process.env.RESEND_API_KEY) {
      logger.warn("RESEND_API_KEY not set; skipping order confirmation email.")
      return new StepResponse({ skipped: true })
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const notificationModule = container.resolve(Modules.NOTIFICATION)

    const { data } = await query.graph({
      entity: "order",
      // `items.*` expands the computed item entity (quantity, unit_price,
      // total, ...); granular fields like `items.quantity` return null/0 for
      // computed properties, and the `*items` prefix form returns no `items`
      // key at all when called in-process via `query.graph` (unlike the
      // Store API HTTP route, which normalizes it). Verified directly against
      // this container. Same `item_total`/`shipping_total` computed fields.
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "total",
        "item_total",
        "shipping_total",
        "items.*",
        "shipping_address.*",
      ],
      filters: { id: input.order_id },
    })

    const order = data?.[0]
    if (!order?.email) {
      logger.warn(`Order ${input.order_id} has no email; skipping confirmation email.`)
      return new StepResponse({ skipped: true })
    }

    await notificationModule.createNotifications({
      to: order.email,
      channel: "email",
      template: "order-placed",
      data: { order },
    })

    return new StepResponse({ skipped: false })
  }
)

export const sendOrderConfirmationWorkflow = createWorkflow(
  "send-order-confirmation",
  (input: SendOrderConfirmationInput) => {
    const result = sendOrderConfirmationStep(input)
    return new WorkflowResponse(result)
  }
)
