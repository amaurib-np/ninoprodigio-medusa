import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import { CreateShippingOptionDTO, Logger } from "@medusajs/framework/types"
import { Shippo } from "shippo"

type ShippoFromAddress = {
  name?: string
  company?: string
  street1?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  phone?: string
}

type ShippoOptions = {
  apiKey: string
  from?: ShippoFromAddress
}

type InjectedDependencies = {
  logger: Logger
}

/**
 * Minimal structural view of the Shippo SDK surface this provider uses. Keeps us
 * decoupled from the generated SDK types while remaining strictly typed.
 */
type ShippoRate = {
  objectId?: string
  amount?: string
  currency?: string
  provider?: string
  servicelevel?: { name?: string; token?: string }
}
type ShippoShipment = { objectId?: string; rates?: ShippoRate[] }
type ShippoTransaction = {
  objectId?: string
  status?: string
  trackingNumber?: string
  trackingUrlProvider?: string
  labelUrl?: string
  messages?: { text?: string }[]
}
interface ShippoClient {
  shipments: { create(req: Record<string, unknown>): Promise<ShippoShipment> }
  transactions: {
    create(req: Record<string, unknown>): Promise<ShippoTransaction>
  }
}

const STANDARD_OPTION_ID = "shippo-standard"
const EXPRESS_OPTION_ID = "shippo-express"
const RETURN_OPTION_ID = "shippo-return"

/**
 * Custom GoShippo fulfillment provider for Medusa v2 (no maintained first-party
 * provider exists). Provides shipping options and label purchase. Live-rate
 * calculation is implemented but disabled by default (`canCalculate` returns
 * false) so the seeded options are flat-rate; flip a shipping option to
 * `price_type: "calculated"` to opt into live rates.
 */
class ShippoFulfillmentProviderService extends AbstractFulfillmentProviderService {
  static identifier = "shippo"

  private client: ShippoClient
  private options: ShippoOptions
  private logger: Logger

  constructor({ logger }: InjectedDependencies, options: ShippoOptions) {
    super()
    this.logger = logger
    this.options = options
    this.client = new Shippo({
      apiKeyHeader: `ShippoToken ${options.apiKey}`,
    }) as unknown as ShippoClient
  }

  static validateOptions(options: Record<string, unknown>): void {
    if (!options.apiKey) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Shippo fulfillment provider requires an `apiKey` option."
      )
    }
  }

  async getFulfillmentOptions() {
    return [
      { id: STANDARD_OPTION_ID, name: "Standard (Shippo)" },
      { id: EXPRESS_OPTION_ID, name: "Express (Shippo)" },
      { id: RETURN_OPTION_ID, name: "Return (Shippo)", is_return: true },
    ]
  }

  async validateFulfillmentData(
    optionData: Record<string, unknown>,
    data: Record<string, unknown>,
    _context: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    return { ...optionData, ...data }
  }

  async validateOption(data: Record<string, unknown>): Promise<boolean> {
    return typeof data.id === "string"
  }

  async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
    // Flat-rate by default. Enable per shipping option to use live rates.
    return false
  }

  async calculatePrice(
    _optionData: Record<string, unknown>,
    _data: Record<string, unknown>,
    context: Record<string, unknown>
  ): Promise<{ calculated_amount: number; is_calculated_price_tax_inclusive: boolean }> {
    const shipment = await this.createRateShipment(context)
    const rates = shipment.rates ?? []

    if (!rates.length) {
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        "Shippo returned no rates for this shipment."
      )
    }

    const cheapest = rates.reduce((min, rate) => {
      const amount = Number(rate.amount ?? Number.POSITIVE_INFINITY)
      const minAmount = Number(min.amount ?? Number.POSITIVE_INFINITY)
      return amount < minAmount ? rate : min
    })

    return {
      // Shippo amounts are major units (e.g. "12.50"); Medusa expects minor units.
      calculated_amount: Math.round(Number(cheapest.amount ?? 0) * 100),
      is_calculated_price_tax_inclusive: false,
    }
  }

  async createFulfillment(
    data: Record<string, unknown>,
    _items: Record<string, unknown>[],
    _order: Record<string, unknown> | undefined,
    _fulfillment: Record<string, unknown>
  ): Promise<{
    data: Record<string, unknown>
    labels: { tracking_number: string; tracking_url: string; label_url: string }[]
  }> {
    const rateId = typeof data.rate_id === "string" ? data.rate_id : undefined

    if (!rateId) {
      // No purchasable rate selected (e.g. flat-rate option). Record intent so
      // the merchant can buy a label from the Shippo dashboard or a later step.
      this.logger.info("Shippo createFulfillment called without a rate_id; no label purchased.")
      return { data: { ...data, label_purchased: false }, labels: [] }
    }

    const transaction = await this.client.transactions.create({
      rate: rateId,
      labelFileType: "PDF",
      async: false,
    })

    if (transaction.status && transaction.status !== "SUCCESS") {
      const message = transaction.messages?.map((m) => m.text).filter(Boolean).join("; ")
      throw new MedusaError(
        MedusaError.Types.UNEXPECTED_STATE,
        `Shippo label purchase failed: ${message || transaction.status}`
      )
    }

    return {
      data: { ...data, transaction_id: transaction.objectId, label_purchased: true },
      labels: [
        {
          tracking_number: transaction.trackingNumber ?? "",
          tracking_url: transaction.trackingUrlProvider ?? "",
          label_url: transaction.labelUrl ?? "",
        },
      ],
    }
  }

  async cancelFulfillment(_fulfillment: Record<string, unknown>): Promise<Record<string, unknown>> {
    // Shippo labels are refunded via the Refunds API; left as a no-op for now.
    this.logger.info("Shippo cancelFulfillment is a no-op; refund the label in Shippo if needed.")
    return {}
  }

  async createReturnFulfillment(
    fromData: Record<string, unknown>
  ): Promise<{
    data: Record<string, unknown>
    labels: { tracking_number: string; tracking_url: string; label_url: string }[]
  }> {
    return { data: { ...fromData, is_return: true }, labels: [] }
  }

  private async createRateShipment(context: Record<string, unknown>): Promise<ShippoShipment> {
    const from = this.options.from
    if (!from?.street1 || !from?.city || !from?.zip || !from?.country) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Shippo ship-from address is not fully configured (SHIPPO_FROM_*)."
      )
    }

    const shippingAddress = (context.shipping_address ?? {}) as Record<string, unknown>
    const addressTo = {
      name: [shippingAddress.first_name, shippingAddress.last_name].filter(Boolean).join(" ") || "Customer",
      street1: String(shippingAddress.address_1 ?? ""),
      city: String(shippingAddress.city ?? ""),
      state: String(shippingAddress.province ?? ""),
      zip: String(shippingAddress.postal_code ?? ""),
      country: String(shippingAddress.country_code ?? "").toUpperCase(),
    }

    if (!addressTo.street1 || !addressTo.city || !addressTo.zip || !addressTo.country) {
      throw new MedusaError(
        MedusaError.Types.INVALID_DATA,
        "Destination address is incomplete; cannot fetch Shippo rates."
      )
    }

    return this.client.shipments.create({
      addressFrom: {
        name: from.name,
        company: from.company,
        street1: from.street1,
        city: from.city,
        state: from.state,
        zip: from.zip,
        country: from.country,
        phone: from.phone,
      },
      addressTo,
      // Default parcel; replace with item-derived dimensions before going live.
      parcels: [
        {
          length: "10",
          width: "8",
          height: "4",
          distanceUnit: "in",
          weight: "1",
          massUnit: "lb",
        },
      ],
      async: false,
    })
  }
}

export default ShippoFulfillmentProviderService
