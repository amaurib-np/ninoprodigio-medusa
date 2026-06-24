import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export type SendOrderShippedInput = {
  fulfillment_id: string
}

const sendOrderShippedStep = createStep(
  { name: "send-order-shipped-email", maxRetries: 3, retryInterval: 30 },
  async (input: SendOrderShippedInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    if (!process.env.RESEND_API_KEY) {
      logger.warn("RESEND_API_KEY not set; skipping order shipped email.")
      return new StepResponse({ skipped: true })
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const notificationModule = container.resolve(Modules.NOTIFICATION)

    const { data } = await query.graph({
      entity: "fulfillment",
      fields: [
        "id",
        "labels.tracking_number",
        "labels.tracking_url",
        "order.id",
        "order.display_id",
        "order.email",
      ],
      filters: { id: input.fulfillment_id },
    })

    const fulfillment = data?.[0] as unknown as
      | {
          labels?: { tracking_number?: string; tracking_url?: string }[]
          order?: { id?: string; display_id?: number; email?: string }
        }
      | undefined
    const order = fulfillment?.order

    if (!order?.email) {
      logger.warn(
        `Fulfillment ${input.fulfillment_id} has no resolvable order email; skipping shipped email.`
      )
      return new StepResponse({ skipped: true })
    }

    const labels = fulfillment?.labels ?? []

    await notificationModule.createNotifications({
      to: order.email,
      channel: "email",
      template: "order-shipped",
      data: {
        order: { display_id: order.display_id, email: order.email },
        fulfillment: {
          tracking_numbers: labels.map((l) => l.tracking_number).filter(Boolean),
          tracking_links: labels
            .filter((l) => l.tracking_url)
            .map((l) => ({ url: l.tracking_url as string, tracking_number: l.tracking_number })),
        },
      },
    })

    return new StepResponse({ skipped: false })
  }
)

export const sendOrderShippedWorkflow = createWorkflow(
  "send-order-shipped",
  (input: SendOrderShippedInput) => {
    const result = sendOrderShippedStep(input)
    return new WorkflowResponse(result)
  }
)
