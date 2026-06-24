import { ExecArgs } from "@medusajs/framework/types"
import {
  ContainerRegistrationKeys,
  Modules,
} from "@medusajs/framework/utils"
import {
  createApiKeysWorkflow,
  createRegionsWorkflow,
  createSalesChannelsWorkflow,
  createShippingOptionsWorkflow,
  createShippingProfilesWorkflow,
  createStockLocationsWorkflow,
  createStoresWorkflow,
  createTaxRegionsWorkflow,
  linkSalesChannelsToApiKeyWorkflow,
  linkSalesChannelsToStockLocationWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * Seeds the store baseline for ninoprodigio.com: a single USD region (US), a US
 * stock location, a default sales channel + publishable key, a default shipping
 * profile for physical goods, and a separate "Digital" profile (no shipping
 * options) so digital products skip the shipping step at checkout.
 *
 * No catalog products are seeded here — the real ~250-product catalog is
 * imported in a later, separate step.
 */
export default async function seed({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT)
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL)

  const countries = ["us"]

  logger.info("Seeding sales channel...")
  // Reuse the "Default Sales Channel" Medusa bootstraps; only create if missing.
  // (Creating unconditionally would leave a duplicate channel.)
  let [defaultSalesChannel] = await salesChannelModuleService.listSalesChannels({
    name: "Default Sales Channel",
  })
  if (!defaultSalesChannel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          { name: "Default Sales Channel", description: "Storefront sales channel" },
        ],
      },
    })
    defaultSalesChannel = result[0]
  }

  logger.info("Seeding publishable API key...")
  const {
    result: [publishableApiKey],
  } = await createApiKeysWorkflow(container).run({
    input: {
      api_keys: [
        { title: "Storefront Publishable Key", type: "publishable", created_by: "seed" },
      ],
    },
  })

  await linkSalesChannelsToApiKeyWorkflow(container).run({
    input: { id: publishableApiKey.id, add: [defaultSalesChannel.id] },
  })

  logger.info("Configuring store (USD)...")
  // Update the store Medusa bootstraps (it ships with EUR) instead of creating a
  // new one, which would leave a duplicate store the admin defaults to.
  const storeConfig = {
    name: "El Nino Prodigio",
    supported_currencies: [{ currency_code: "usd", is_default: true }],
    default_sales_channel_id: defaultSalesChannel.id,
  }
  const { data: existingStores } = await query.graph({
    entity: "store",
    fields: ["id"],
  })
  if (existingStores.length) {
    await updateStoresWorkflow(container).run({
      input: { selector: { id: existingStores[0].id }, update: storeConfig },
    })
  } else {
    await createStoresWorkflow(container).run({
      input: { stores: [storeConfig] },
    })
  }

  logger.info("Seeding USD region...")
  const { result: regionResult } = await createRegionsWorkflow(container).run({
    input: {
      regions: [
        {
          name: "United States",
          currency_code: "usd",
          countries,
          // Both Stripe accounts are enabled on the single USD region; the
          // storefront selects the provider per cart. pp_system_default keeps
          // checkout working in dev when no Stripe keys are configured.
          payment_providers: [
            "pp_system_default",
            ...(process.env.STRIPE_MUNDO_SECRET_KEY ? ["pp_stripe_mundo"] : []),
            ...(process.env.STRIPE_GEDELIMBO_SECRET_KEY ? ["pp_stripe_gedelimbo"] : []),
          ],
        },
      ],
    },
  })
  const region = regionResult[0]

  logger.info("Seeding tax region...")
  await createTaxRegionsWorkflow(container).run({
    input: countries.map((country_code) => ({ country_code, provider_id: "tp_system" })),
  })

  logger.info("Seeding stock location...")
  const { result: stockLocationResult } = await createStockLocationsWorkflow(container).run({
    input: {
      locations: [
        {
          name: "Primary Warehouse",
          address: { city: "Miami", country_code: "US", address_1: "" },
        },
      ],
    },
  })
  const stockLocation = stockLocationResult[0]

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_provider_id: "manual_manual" },
  })

  logger.info("Seeding shipping profiles...")
  // Default profile (auto-created by core migrations) is used for physical goods.
  const { data: shippingProfileResult } = await query.graph({
    entity: "shipping_profile",
    fields: ["id", "name"],
  })
  const defaultShippingProfile = shippingProfileResult[0]

  // Digital profile has no shipping options -> checkout skips shipping for
  // digital-only carts. Assign digital products to this profile on import.
  await createShippingProfilesWorkflow(container).run({
    input: { data: [{ name: "Digital", type: "digital" }] },
  })

  logger.info("Seeding fulfillment set + shipping options (USD)...")
  const fulfillmentSet = await fulfillmentModuleService.createFulfillmentSets({
    name: "US delivery",
    type: "shipping",
    service_zones: [
      {
        name: "United States",
        geo_zones: [{ country_code: "us", type: "country" }],
      },
    ],
  })

  await link.create({
    [Modules.STOCK_LOCATION]: { stock_location_id: stockLocation.id },
    [Modules.FULFILLMENT]: { fulfillment_set_id: fulfillmentSet.id },
  })

  // Flat-rate options on the manual provider. When GoShippo is enabled
  // (SHIPPO_API_KEY set), add Shippo-backed options (provider id "shippo_shippo")
  // and/or set price_type "calculated" for live rates.
  await createShippingOptionsWorkflow(container).run({
    input: [
      {
        name: "Standard Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: defaultShippingProfile.id,
        type: { label: "Standard", description: "Ships in 3-5 days.", code: "standard" },
        prices: [
          { currency_code: "usd", amount: 700 },
          { region_id: region.id, amount: 700 },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
      {
        name: "Express Shipping",
        price_type: "flat",
        provider_id: "manual_manual",
        service_zone_id: fulfillmentSet.service_zones[0].id,
        shipping_profile_id: defaultShippingProfile.id,
        type: { label: "Express", description: "Ships in 24 hours.", code: "express" },
        prices: [
          { currency_code: "usd", amount: 1500 },
          { region_id: region.id, amount: 1500 },
        ],
        rules: [
          { attribute: "enabled_in_store", value: "true", operator: "eq" },
          { attribute: "is_return", value: "false", operator: "eq" },
        ],
      },
    ],
  })

  await linkSalesChannelsToStockLocationWorkflow(container).run({
    input: { id: stockLocation.id, add: [defaultSalesChannel.id] },
  })

  logger.info(`Seed complete. Publishable API key: ${publishableApiKey.token}`)
  logger.info("Store is ready for catalog import (no products seeded).")
}
