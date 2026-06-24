import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export type SendInviteInput = {
  invite_id: string
}

const sendInviteStep = createStep(
  { name: "send-invite-email", maxRetries: 3, retryInterval: 30 },
  async (input: SendInviteInput, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    // Email is only sent when an email-channel provider (Resend) is configured.
    if (!process.env.RESEND_API_KEY) {
      logger.warn("RESEND_API_KEY not set; skipping admin invite email.")
      return new StepResponse({ skipped: true })
    }

    const query = container.resolve(ContainerRegistrationKeys.QUERY)
    const configModule = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE)
    const notificationModule = container.resolve(Modules.NOTIFICATION)

    const { data: inviteData } = await query.graph({
      entity: "invite",
      fields: ["email", "token"],
      filters: { id: input.invite_id },
    })

    const invite = inviteData?.[0]
    if (!invite?.email || !invite?.token) {
      logger.warn(`Invite ${input.invite_id} has no email/token; skipping invite email.`)
      return new StepResponse({ skipped: true })
    }

    const { data: storeData } = await query.graph({
      entity: "store",
      fields: ["name"],
    })
    const storeName = storeData?.[0]?.name ?? undefined

    const backendUrl =
      configModule.admin.backendUrl && configModule.admin.backendUrl !== "/"
        ? configModule.admin.backendUrl
        : "http://localhost:9000"
    const adminPath = configModule.admin.path
    const inviteUrl = `${backendUrl}${adminPath}/invite?token=${invite.token}`

    await notificationModule.createNotifications({
      to: invite.email,
      channel: "email",
      template: "user-invited",
      data: {
        invite_url: inviteUrl,
        store_name: storeName,
      },
    })

    return new StepResponse({ skipped: false })
  }
)

export const sendInviteWorkflow = createWorkflow(
  "send-invite",
  (input: SendInviteInput) => {
    const result = sendInviteStep(input)
    return new WorkflowResponse(result)
  }
)
