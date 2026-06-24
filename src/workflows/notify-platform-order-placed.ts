import {
  createWorkflow,
  createStep,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"

export type NotifyPlatformInput = {
  order_id: string
}

type OrderPlacedPayload = {
  event: "order.placed"
  order: {
    id: string
    display_id?: number
    email?: string
    currency_code?: string
    total?: number
    items: {
      variant_id?: string
      product_id?: string
      title?: string
      quantity?: number
      unit_price?: number
      metadata?: Record<string, unknown> | null
    }[]
    shipping_address?: Record<string, unknown> | null
    payment: {
      provider_id?: string
      stripe_account?: string
      stripe_payment_intent_id?: string
    }
    created_at?: string | Date
  }
}

const STRIPE_PROVIDER_PREFIX = "pp_stripe_"

type FetchedOrderItem = {
  variant_id?: string
  product_id?: string
  title?: string
  quantity?: number
  unit_price?: number
  metadata?: Record<string, unknown> | null
}

type FetchedOrder = {
  id: string
  display_id?: number
  email?: string
  currency_code?: string
  total?: number
  created_at?: string | Date
  items?: (FetchedOrderItem | null)[]
  shipping_address?: Record<string, unknown> | null
  payment_collections?: {
    payments?: { provider_id?: string; data?: Record<string, unknown> }[]
  }[]
}

const prepareOrderNotificationStep = createStep(
  "prepare-order-notification",
  async (input: NotifyPlatformInput, { container }) => {
    const query = container.resolve(ContainerRegistrationKeys.QUERY)

    const { data } = await query.graph({
      entity: "order",
      fields: [
        "id",
        "display_id",
        "email",
        "currency_code",
        "total",
        "created_at",
        "items.variant_id",
        "items.product_id",
        "items.title",
        "items.quantity",
        "items.unit_price",
        "items.metadata",
        "shipping_address.*",
        "payment_collections.payments.provider_id",
        "payment_collections.payments.data",
      ],
      filters: { id: input.order_id },
    })

    // Decouple from the strongly-typed query result (BigNumber/Maybe shapes);
    // the wire payload uses plain JSON types per the integration contract.
    const order = data?.[0] as unknown as FetchedOrder | undefined
    if (!order) {
      throw new Error(`Order ${input.order_id} not found when preparing notification.`)
    }

    const payment = order.payment_collections?.[0]?.payments?.[0]
    const providerId: string | undefined = payment?.provider_id
    const paymentData = (payment?.data ?? {}) as Record<string, unknown>
    const stripePaymentIntentId =
      typeof paymentData.id === "string" ? paymentData.id : undefined
    const stripeAccount = providerId?.startsWith(STRIPE_PROVIDER_PREFIX)
      ? providerId.slice(STRIPE_PROVIDER_PREFIX.length)
      : undefined

    const items = (order.items ?? []).filter(
      (item): item is FetchedOrderItem => Boolean(item)
    )

    const payload: OrderPlacedPayload = {
      event: "order.placed",
      order: {
        id: order.id,
        display_id: order.display_id,
        email: order.email,
        currency_code: order.currency_code,
        total: order.total,
        items: items.map((item) => ({
          variant_id: item.variant_id,
          product_id: item.product_id,
          title: item.title,
          quantity: item.quantity,
          unit_price: item.unit_price,
          metadata: item.metadata,
        })),
        shipping_address: order.shipping_address,
        payment: {
          provider_id: providerId,
          stripe_account: stripeAccount,
          stripe_payment_intent_id: stripePaymentIntentId,
        },
        created_at: order.created_at,
      },
    }

    return new StepResponse(payload)
  }
)

const sendPlatformNotificationStep = createStep(
  { name: "send-platform-notification", maxRetries: 5, retryInterval: 30 },
  async (payload: OrderPlacedPayload, { container }) => {
    const logger = container.resolve(ContainerRegistrationKeys.LOGGER)

    const url = process.env.PLATFORM_WEBHOOK_URL
    const secret = process.env.PLATFORM_WEBHOOK_SECRET

    if (!url || !secret) {
      logger.warn(
        "PLATFORM_WEBHOOK_URL/SECRET not set; skipping order.placed platform notification."
      )
      return new StepResponse({ skipped: true })
    }

    // order.id is the idempotency key so the platform can dedupe retries.
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Secret": secret,
        "Idempotency-Key": payload.order.id,
      },
      body: JSON.stringify({ ...payload, idempotency_key: payload.order.id }),
    })

    if (!response.ok) {
      const body = await response.text().catch(() => "")
      // Throwing lets the workflow engine retry per the step's retry policy.
      throw new Error(
        `Platform notification failed (${response.status} ${response.statusText}): ${body}`
      )
    }

    return new StepResponse({ skipped: false, status: response.status })
  }
)

export const notifyPlatformOrderPlacedWorkflow = createWorkflow(
  "notify-platform-order-placed",
  (input: NotifyPlatformInput) => {
    const payload = prepareOrderNotificationStep(input)
    const result = sendPlatformNotificationStep(payload)
    return new WorkflowResponse(result)
  }
)
