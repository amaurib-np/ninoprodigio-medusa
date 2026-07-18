import { MedusaContainer } from "@medusajs/framework/types"
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
  updateSalesChannelsWorkflow,
  updateStoresWorkflow,
} from "@medusajs/medusa/core-flows"

/**
 * The public web storefront sales channel. Medusa bootstraps a channel named
 * "Default Sales Channel"; we normalize it to this label. New selling surfaces
 * (Línea Psíquica, mobile app) get their own named channel + publishable key
 * when they go live. See docs/architecture.md -> "Sales channels".
 */
const WEB_SALES_CHANNEL_NAME = "Web — ninoprodigio.com"

export type SeedResult = {
  alreadySeeded: boolean
  publishableKey?: string
}

/**
 * Resolves the store's default sales channel by id (the one Medusa bootstraps)
 * and normalizes its label to {@link WEB_SALES_CHANNEL_NAME}. Resolving by id —
 * rather than by name — means renaming the channel never produces a duplicate,
 * and re-running the seed always converges the label. Only creates a channel as
 * a last resort (a store with no default configured yet).
 */
async function resolveAndRenameDefaultSalesChannel(container: MedusaContainer) {
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const salesChannelModuleService = container.resolve(Modules.SALES_CHANNEL)

  const { data: stores } = await query.graph({
    entity: "store",
    fields: ["id", "default_sales_channel_id"],
  })
  const defaultId = stores[0]?.default_sales_channel_id

  let channel
  if (defaultId) {
    ;[channel] = await salesChannelModuleService.listSalesChannels({
      id: defaultId,
    })
  }
  // Fallbacks for a store with no default set yet: reuse by the target name,
  // then the channel Medusa bootstraps, then create it.
  if (!channel) {
    ;[channel] = await salesChannelModuleService.listSalesChannels({
      name: WEB_SALES_CHANNEL_NAME,
    })
  }
  if (!channel) {
    ;[channel] = await salesChannelModuleService.listSalesChannels({
      name: "Default Sales Channel",
    })
  }
  if (!channel) {
    const { result } = await createSalesChannelsWorkflow(container).run({
      input: {
        salesChannelsData: [
          {
            name: WEB_SALES_CHANNEL_NAME,
            description: "Public web storefront (ninoprodigio.com)",
          },
        ],
      },
    })
    channel = result[0]
  }

  // Normalize the label (idempotent, by id) so every environment converges.
  if (channel.name !== WEB_SALES_CHANNEL_NAME) {
    await updateSalesChannelsWorkflow(container).run({
      input: {
        selector: { id: channel.id },
        update: { name: WEB_SALES_CHANNEL_NAME },
      },
    })
    channel = { ...channel, name: WEB_SALES_CHANNEL_NAME }
  }

  return channel
}

/**
 * Seeds the store baseline for ninoprodigio.com: a single USD region (US), a US
 * stock location, a default sales channel + publishable key, a default shipping
 * profile for physical goods, and a separate "Digital" profile (no shipping
 * options) so digital products skip the shipping step at checkout.
 *
 * No catalog products are seeded here — the real ~250-product catalog is
 * imported in a later, separate step.
 *
 * Several core-flow creates here are not individually idempotent (region, tax
 * region, stock location, etc. would duplicate or error on a second run), so the
 * whole routine is guarded: if a USD region already exists, the store is treated
 * as seeded and the routine is a no-op. This makes it safe to expose as an admin
 * route and trigger more than once (e.g. on Cloud, where there is no CLI exec).
 */
export async function seedStore(
  container: MedusaContainer
): Promise<SeedResult> {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const link = container.resolve(ContainerRegistrationKeys.LINK)
  const query = container.resolve(ContainerRegistrationKeys.QUERY)
  const fulfillmentModuleService = container.resolve(Modules.FULFILLMENT)

  // Resolve the store's default sales channel BY ID and normalize its label to
  // the web storefront name. Done before the idempotency guard below so the
  // rename is applied on every seed call (including already-seeded stores, e.g.
  // Cloud) and — being by id — never creates a duplicate channel.
  logger.info("Normalizing default sales channel...")
  const defaultSalesChannel = await resolveAndRenameDefaultSalesChannel(container)

  // Idempotency guard: a USD region is the marker that the baseline already ran.
  // (The sales-channel normalization above still runs on repeat calls.)
  const { data: existingRegions } = await query.graph({
    entity: "region",
    fields: ["id", "currency_code"],
  })
  if (existingRegions.some((r) => r.currency_code === "usd")) {
    logger.info(
      "Store already seeded (USD region exists); channel name normalized; skipping rest."
    )
    return { alreadySeeded: true }
  }

  const countries = ["us"]

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
          name: "1800 Warehouse",
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
  return { alreadySeeded: false, publishableKey: publishableApiKey.token }
}
