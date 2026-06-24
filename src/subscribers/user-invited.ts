import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { sendInviteWorkflow } from "../workflows/send-invite"

export default async function userInvitedHandler({
  event,
  container,
}: SubscriberArgs<{ id: string }>) {
  // Admin invite email is sent from Medusa via Resend.
  await sendInviteWorkflow(container).run({
    input: { invite_id: event.data.id },
  })
}

export const config: SubscriberConfig = {
  event: ["invite.created", "invite.resent"],
}
