# ninoprodigio-medusa

Headless commerce backend for **ninoprodigio.com**, built on **Medusa v2**.

This service is the e-commerce engine for the store: it owns the product catalog
(with variants), inventory, carts, orders, fulfillment, and returns. It exposes
Medusa's Store and Admin APIs. The customer-facing storefront lives in a
**separate** repository (the Next.js platform, `ninoprodigio-platform`) and
consumes this backend's Store API via the Medusa JS SDK.

> Why a separate repo? Medusa is a long-running Node service with its own
> Postgres + Redis + background workers; it cannot deploy to Vercel and has a
> different release cadence than the Next.js site. See
> `docs/architecture.md` and the platform repo's ADR-024.

## Role in the wider system

```
Shopper -> Next.js storefront (ninoprodigio-platform)
              |  Store API (catalog, cart, checkout)
              v
        Medusa v2 (this repo)  --> Postgres + Redis
              |-- Stripe         (payments only; TWO accounts: Mundo Espiritual=products, Gedelimbo=minutes)
              |-- GoShippo       (shipping rates + labels)
              |-- Resend         (order emails)
              `-- order.placed --> notifies the platform (mirror tx -> Supabase -> SpiritualCRM)
```

What this repo does **not** do:

- **No membership/subscriptions.** Membership ("Club Mundo Espiritual") stays on
  the platform's direct-Stripe flow. Medusa v2 has no native subscriptions.
- **No auth/identity master.** Supabase (in the platform) is the identity
  provider. A Medusa customer is mapped to a Supabase user by email.
- **No editorial content.** Rich product descriptions, galleries, and SEO live
  in Sanity (in the platform), linked to Medusa products by `handle`.

## Stack

- Medusa v2 (Node.js + TypeScript), Postgres, Redis
- Providers: Stripe (payment), GoShippo (fulfillment), Resend (notification)
- Hosting: **Medusa Cloud** — Develop tier for build/preview, Launch tier for
  production (push-to-deploy from GitHub; managed Postgres + Redis + workers).
  Local dev runs Postgres + Redis via Docker Compose. No lock-in (MIT + export).
- Admin dashboard served at `/app`

## Getting started

> Scaffolding (Medusa install, provider config, Dockerfile, migrations) is not
> created yet. This repo currently contains only the documentation and
> `.cursor/rules` seeded from the platform context. Use them as the source of
> truth when scaffolding the Medusa application.

Local setup (npm — yarn is not used in this repo; `.npmrc` sets
`legacy-peer-deps=true` to resolve Medusa's optional peer pins):

```bash
# 1. install
npm install

# 2. configure environment (see docs/integration-contract.md for required vars)
cp .env.template .env

# 3. start Postgres + Redis and run migrations
docker compose up -d
npx medusa db:migrate

# 4. seed an admin user + store baseline, then run
npx medusa user -e admin@ninoprodigio.com -p <password>
npm run seed   # USD region, US stock location, shipping options (no catalog)
npm run dev    # API + admin at http://localhost:9000/app
```

### What's configured

- **Payment (Stripe, two accounts):** `pp_stripe_mundo` (products) is registered
  when `STRIPE_MUNDO_SECRET_KEY` is set; `pp_stripe_gedelimbo` (minutes, later
  phase) when `STRIPE_GEDELIMBO_SECRET_KEY` is set. Both attach to the single USD
  region. Webhook endpoints (route drops the `pp_` prefix):
  `/hooks/payment/stripe_mundo` and `/hooks/payment/stripe_gedelimbo`.
- **Cart guard:** a `completeCartWorkflow` + `addToCartWorkflow` validate hook
  rejects carts mixing minutes with non-minutes items (one Stripe account per
  cart). See [`src/workflows/hooks/cart-single-provider-guard.ts`](src/workflows/hooks/cart-single-provider-guard.ts).
- **Fulfillment (GoShippo):** custom v2 provider module at
  [`src/modules/shippo`](src/modules/shippo) (no maintained first-party provider
  exists), registered when `SHIPPO_API_KEY` is set. Digital products use a
  no-shipping `Digital` profile.
- **Notifications (Resend):** custom provider at [`src/modules/resend`](src/modules/resend)
  with order-confirmation and shipped templates, registered when `RESEND_API_KEY`
  is set. Order emails are sent from here, not the platform.
- **`order.placed`:** an idempotent, retryable subscriber/workflow
  ([`src/workflows/notify-platform-order-placed.ts`](src/workflows/notify-platform-order-placed.ts))
  POSTs the additive payload (incl. `payment.provider_id` + `payment.stripe_account`,
  `order.id` as idempotency key) to the platform.

Deployment is via **Medusa Cloud** (connect the GitHub repo; push-to-deploy).
Develop tier for preview environments, Launch tier for production. See
[`docs/deployment.md`](docs/deployment.md).

## AI tooling (Medusa official)

Medusa ships first-class AI-assistant support. This repo is set up to use it:

- **Cursor rules.** `.cursor/rules/medusa.mdc` is the official Medusa framework
  rule (workflows, data models, services, `MedusaError`), vendored here.
  Project-specific boundaries live in `medusa-conventions.mdc` and
  `project-context.mdc`.
- **Agent skills (post-scaffold).** Medusa publishes official
  [agent skills](https://docs.medusajs.com/learn/introduction/build-with-llms-ai/agentic-skills)
  grouped into plugins. Install after the app is scaffolded.

  Non-Claude agents (Cursor, etc.):

  ```bash
  npx skills add medusajs/medusa-agent-skills
  ```

  Or via Claude Code:

  ```bash
  /plugin marketplace add medusajs/medusa-agent-skills
  /plugin install medusa-dev@medusa
  ```

  Plugins / skills and where they belong:

  | Plugin | Skills | Use in |
  |--------|--------|--------|
  | `medusa-dev` | `building-with-medusa`, `building-admin-dashboard-customizations`, `building-storefronts`, `db-generate`, `db-migrate`, `new-user` | **This backend repo** |
  | `ecommerce-storefront` | `storefront-best-practices` | The **platform** repo (Next.js `/shop`) |
  | `learn-medusa` | `learning-medusa` | Optional, interactive learning |

  `medusa-dev` also exposes commands: `/medusa-dev:db-migrate`,
  `/medusa-dev:db-generate <module>`, `/medusa-dev:new-user <email> <password>`.

- **MCP docs server.** This project is on **Medusa Cloud** (Develop tier), which
  includes the Docs MCP (gated to Cloud accounts). Add it to `.cursor/mcp.json`
  for live documentation lookups, authenticating with your Cloud token:

  ```jsonc
  {
    "mcpServers": {
      "medusa": {
        "url": "https://docs.medusajs.com/mcp",
        "headers": { "Authorization": "Bearer <medusa-cloud-token>" }
      }
    }
  }
  ```

- **Plain-text docs.** `https://docs.medusajs.com/llms.txt` (index) and
  `https://docs.medusajs.com/llms-full.txt` (full) for LLM consumption.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — ownership boundaries, the
  fulfillment pipeline, and deferred work.
- [`docs/integration-contract.md`](docs/integration-contract.md) — the concrete
  contract between this backend and the Next.js platform (events, identity
  mapping, shared env). Read this before changing anything that crosses the
  repo boundary.

The canonical architecture decisions (ADR-024 for this adoption, ADR-022 for the
user/customer identity mapping) live in the **platform repo** under `docs/adr/`.
This repo summarizes the parts relevant to Medusa rather than duplicating them.
