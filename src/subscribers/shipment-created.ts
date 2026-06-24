import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendOrderShippedWorkflow } from "../workflows/send-order-shipped"

export default async function shipmentCreatedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  await sendOrderShippedWorkflow(container).run({
    input: { fulfillment_id: event.data.id },
  })
}

export const config: SubscriberConfig = {
  event: "shipment.created",
}
