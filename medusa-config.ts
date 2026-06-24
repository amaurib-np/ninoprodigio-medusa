import { loadEnv, defineConfig } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "development", process.cwd())

const REDIS_URL = process.env.REDIS_URL

/**
 * Payment providers. Two Stripe accounts (see docs/integration-contract.md):
 * - Mundo Espiritual -> physical/digital products (provider id `pp_stripe_mundo`).
 * - Gedelimbo        -> minutes packages        (provider id `pp_stripe_gedelimbo`).
 *
 * Each instance is registered only when its secret key is present so local/dev
 * boots cleanly. Webhook paths (route drops the `pp_` prefix):
 *   /hooks/payment/stripe_mundo   and   /hooks/payment/stripe_gedelimbo
 */
type ProviderConfig = {
  resolve: string
  id: string
  options?: Record<string, unknown>
}

const paymentProviders: ProviderConfig[] = []

if (process.env.STRIPE_MUNDO_SECRET_KEY) {
  paymentProviders.push({
    resolve: "@medusajs/medusa/payment-stripe",
    id: "mundo",
    options: {
      apiKey: process.env.STRIPE_MUNDO_SECRET_KEY,
      webhookSecret: process.env.STRIPE_MUNDO_WEBHOOK_SECRET,
    },
  })
}

// Minutes are a later phase: Gedelimbo is config-only until the minutes module
// lands. Registered only when its key is present (keeps dev boots clean).
if (process.env.STRIPE_GEDELIMBO_SECRET_KEY) {
  paymentProviders.push({
    resolve: "@medusajs/medusa/payment-stripe",
    id: "gedelimbo",
    options: {
      apiKey: process.env.STRIPE_GEDELIMBO_SECRET_KEY,
      webhookSecret: process.env.STRIPE_GEDELIMBO_WEBHOOK_SECRET,
    },
  })
}

/**
 * Notification providers. `local` handles the in-admin feed; Resend sends order
 * emails (confirmation, shipped/tracking) and is registered only when its key
 * is present. The Notification Module allows one provider per channel.
 */
const notificationProviders: ProviderConfig[] = [
  {
    resolve: "@medusajs/medusa/notification-local",
    id: "local",
    options: {
      name: "Local Notification Provider",
      channels: ["feed"],
    },
  },
]

if (process.env.RESEND_API_KEY) {
  notificationProviders.push({
    resolve: "./src/modules/resend",
    id: "resend",
    options: {
      channels: ["email"],
      api_key: process.env.RESEND_API_KEY,
      from: process.env.RESEND_FROM_EMAIL,
    },
  })
}

/**
 * Fulfillment providers. `manual` is the built-in default; GoShippo (custom
 * provider module) handles real shipping rates + labels and is registered only
 * when its key is present. Digital products use a no-shipping profile.
 */
const fulfillmentProviders: ProviderConfig[] = [
  {
    resolve: "@medusajs/medusa/fulfillment-manual",
    id: "manual",
  },
]

if (process.env.SHIPPO_API_KEY) {
  fulfillmentProviders.push({
    resolve: "./src/modules/shippo",
    id: "shippo",
    options: {
      apiKey: process.env.SHIPPO_API_KEY,
      // Ship-from address used for rate quotes and label purchase.
      from: {
        name: process.env.SHIPPO_FROM_NAME,
        company: process.env.SHIPPO_FROM_COMPANY,
        street1: process.env.SHIPPO_FROM_STREET1,
        city: process.env.SHIPPO_FROM_CITY,
        state: process.env.SHIPPO_FROM_STATE,
        zip: process.env.SHIPPO_FROM_ZIP,
        country: process.env.SHIPPO_FROM_COUNTRY,
        phone: process.env.SHIPPO_FROM_PHONE,
      },
    },
  })
}

const modules: Array<{ resolve: string; options?: Record<string, unknown> }> = [
  {
    resolve: "@medusajs/medusa/payment",
    options: { providers: paymentProviders },
  },
  {
    resolve: "@medusajs/medusa/notification",
    options: { providers: notificationProviders },
  },
  {
    resolve: "@medusajs/medusa/fulfillment",
    options: { providers: fulfillmentProviders },
  },
]

// Redis-backed infrastructure modules in production / when REDIS_URL is set.
// Without REDIS_URL, Medusa falls back to its in-memory implementations (dev only).
if (REDIS_URL) {
  modules.push(
    {
      resolve: "@medusajs/medusa/cache-redis",
      options: { redisUrl: REDIS_URL },
    },
    {
      resolve: "@medusajs/medusa/event-bus-redis",
      options: { redisUrl: REDIS_URL },
    },
    {
      resolve: "@medusajs/medusa/workflow-engine-redis",
      // This module reads the connection from `redis.url` (despite a misleading
      // deprecation warning suggesting `redisUrl`).
      options: { redis: { url: REDIS_URL } },
    }
  )
}

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: REDIS_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    },
  },
  modules,
})
