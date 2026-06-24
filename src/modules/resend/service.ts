import { AbstractNotificationProviderService, MedusaError } from "@medusajs/framework/utils"
import {
  Logger,
  ProviderSendNotificationDTO,
  ProviderSendNotificationResultsDTO,
} from "@medusajs/framework/types"
import { Resend, CreateEmailOptions } from "resend"
import { ReactElement } from "react"
import { orderPlacedEmail } from "./emails/order-placed"
import { orderShippedEmail } from "./emails/order-shipped"
import { inviteUserEmail } from "./emails/invite-user"

export enum ResendTemplate {
  ORDER_PLACED = "order-placed",
  ORDER_SHIPPED = "order-shipped",
  USER_INVITED = "user-invited",
}

type ResendOptions = {
  api_key: string
  from: string
  channels?: string[]
}

type InjectedDependencies = {
  logger: Logger
}

const templates: {
  [key in ResendTemplate]: {
    subject: (data: Record<string, unknown>) => string
    render: (data: Record<string, unknown>) => ReactElement
  }
} = {
  [ResendTemplate.ORDER_PLACED]: {
    subject: (data) => {
      const order = data.order as { display_id?: number } | undefined
      return order?.display_id ? `Order #${order.display_id} confirmed` : "Your order is confirmed"
    },
    render: (data) => orderPlacedEmail(data as Parameters<typeof orderPlacedEmail>[0]),
  },
  [ResendTemplate.ORDER_SHIPPED]: {
    subject: (data) => {
      const order = data.order as { display_id?: number } | undefined
      return order?.display_id ? `Order #${order.display_id} has shipped` : "Your order has shipped"
    },
    render: (data) => orderShippedEmail(data as Parameters<typeof orderShippedEmail>[0]),
  },
  [ResendTemplate.USER_INVITED]: {
    subject: (data) => {
      const storeName = (data.store_name as string | undefined) || "the team"
      return `You've been invited to join ${storeName}`
    },
    render: (data) => inviteUserEmail(data as Parameters<typeof inviteUserEmail>[0]),
  },
}

class ResendNotificationProviderService extends AbstractNotificationProviderService {
  static identifier = "notification-resend"

  private resendClient: Resend
  private options: ResendOptions
  private logger: Logger

  constructor({ logger }: InjectedDependencies, options: ResendOptions) {
    super()
    this.resendClient = new Resend(options.api_key)
    this.options = options
    this.logger = logger
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.api_key) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Resend notification provider requires an `api_key` option."
      )
    }
    if (!options.from) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Resend notification provider requires a `from` option."
      )
    }
  }

  async send(
    notification: ProviderSendNotificationDTO
  ): Promise<ProviderSendNotificationResultsDTO> {
    if (!notification.to) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "A recipient (`to`) is required to send an email."
      )
    }

    const template = templates[notification.template as ResendTemplate]
    const data = (notification.data ?? {}) as Record<string, unknown>

    const message: CreateEmailOptions = {
      from: notification.from ?? this.options.from,
      to: [notification.to],
      subject: notification.content?.subject ?? (template ? template.subject(data) : "Notification"),
    } as CreateEmailOptions

    if (template) {
      message.react = template.render(data)
    } else if (notification.content?.html) {
      message.html = notification.content.html
    } else {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        `No template registered for "${notification.template}" and no html content provided.`
      )
    }

    const { data: result, error } = await this.resendClient.emails.send(message)

    if (error) {
      this.logger.error(`Failed to send "${notification.template}" email via Resend: ${error.message}`)
      throw new MedusaError(MedusaError.Types.UNEXPECTED_STATE, error.message)
    }

    return { id: result?.id }
  }
}

export default ResendNotificationProviderService
