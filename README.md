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
- Deploy target: Railway (managed Postgres + Redis) or Docker on a Coolify server
- Admin dashboard served at `/app`

## Getting started

> Scaffolding (Medusa install, provider config, Dockerfile, migrations) is not
> created yet. This repo currently contains only the documentation and
> `.cursor/rules` seeded from the platform context. Use them as the source of
> truth when scaffolding the Medusa application.

Planned local setup once scaffolded:

```bash
# 1. install
yarn

# 2. configure environment (see docs/integration-contract.md for required vars)
cp .env.template .env

# 3. start Postgres + Redis (docker compose) and run migrations
yarn medusa db:migrate

# 4. seed an admin user and run
yarn medusa user -e admin@ninoprodigio.com -p <password>
yarn dev   # API + admin at /app
```

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

- **MCP docs server (optional).** For live documentation lookups, add the Medusa
  MCP server to `.cursor/mcp.json`. Note it is gated to **Medusa Cloud**
  accounts (OAuth / personal access token), so only add it if you use Cloud:

  ```jsonc
  {
    "mcpServers": {
      "medusa": {
        "url": "https://docs.medusajs.com/mcp"
        // add: "headers": { "Authorization": "Bearer <token>" } if required
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
