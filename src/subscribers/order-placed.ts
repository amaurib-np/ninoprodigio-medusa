import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { notifyPlatformOrderPlacedWorkflow } from "../workflows/notify-platform-order-placed"
import { sendOrderConfirmationWorkflow } from "../workflows/send-order-confirmation"

export default async function orderPlacedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  const orderId = event.data.id

  // Notify the platform (mirror tx + CRM sync). Idempotent + retryable.
  await notifyPlatformOrderPlacedWorkflow(container).run({
    input: { order_id: orderId },
  })

  // Order confirmation email is sent from Medusa via Resend (not the platform).
  await sendOrderConfirmationWorkflow(container).run({
    input: { order_id: orderId },
  })
}

export const config: SubscriberConfig = {
  event: "order.placed",
}
