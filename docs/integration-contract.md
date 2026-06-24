# Integration Contract: Medusa <-> Platform

This is the contract between this Medusa backend and the Next.js platform
(`ninoprodigio-platform`). Both repos must honor it. Change it deliberately and
update both sides together, since they are loosely coupled via a stable API.

## Principles

- **Medusa is the source of truth for store catalog and orders.** The platform
  keeps only a lightweight mirror for portal display and CRM sync.
- **Supabase is the identity provider.** The join key between a portal user and a
  Medusa customer is **email**. Medusa is not the identity master.
- **Stripe spans two accounts.** Medusa registers **two Stripe providers**:
  **Mundo Espiritual** (store products) and **Gedelimbo** (minutes). Membership
  stays on the platform's direct-Stripe flow (also Gedelimbo). Customers are
  inherently separate across accounts — see "Stripe accounts" below.

## Direction of calls

```
Platform  --(Store API, server-side via Medusa JS SDK)-->  Medusa
   - list/search products, get product by handle
   - create/update cart, line items, shipping method
   - init payment session (Stripe), complete cart
   - find-or-create customer by email; read order history

Medusa    --(event notification)-->  Platform
   - order.placed  -> platform endpoint (see below)
```

## Customer mapping

- On a user's first shop action, the platform calls Medusa to **find-or-create a
  customer by email**, then stores the Medusa customer id in its
  `user_external_ids` table (`provider = 'medusa'`, per platform ADR-022).
- Medusa should allow customer lookup/creation by email and must not require a
  Supabase user id.
- **Guests**: complete the cart with an email and no customer. The platform
  reconciles the order to a user if they later register with the same email.

## Event: `order.placed`

A Medusa subscriber on `order.placed` notifies the platform so it can mirror the
transaction and trigger CRM sync. Recommended transport: an authenticated HTTP
POST to a platform endpoint (shared secret header), or a queue if/when available.

Suggested payload (stable shape — keep additive):

```jsonc
{
  "event": "order.placed",
  "order": {
    "id": "order_...",            // Medusa order id (source of truth)
    "display_id": 1234,            // human-facing order number
    "email": "buyer@example.com",  // join key to platform user
    "currency_code": "usd",
    "total": 5499,                 // minor units
    "items": [
      { "variant_id": "variant_...", "product_id": "prod_...",
        "title": "...", "quantity": 1, "unit_price": 2499,
        "metadata": { "type": "physical" } }
    ],
    "shipping_address": { /* ... */ },
    "payment": {
      "provider_id": "pp_stripe_mundo",      // WHICH Stripe account: pp_stripe_mundo | pp_stripe_gedelimbo
      "stripe_account": "mundo",             // "mundo" | "gedelimbo" (convenience alias)
      "stripe_payment_intent_id": "pi_..."   // only resolvable within its own account
    },
    "created_at": "2026-..."
  }
}
```

What the platform does on receipt (for reference; implemented in the platform):
- Resolve the user by email (or store as a guest order).
- Insert a mirror row into `transactions` (or `guest_orders`), recording
  `stripe_account` so the `pi_...` is reconciled against the correct Stripe
  account (Mundo Espiritual vs Gedelimbo — they are separate accounts).
- Enqueue `create_transaction` into Supabase `sync_queue` -> SpiritualCRM.
- Trigger any portal-side notifications it owns.

> The subscriber/workflow should be **idempotent + retryable**: use Medusa's
> workflow retries and send the Medusa `order.id` as an idempotency key so the
> platform can dedupe duplicate deliveries.

> Order **emails** (confirmation, shipped/tracking) are sent by **Medusa** via
> Resend, not by the platform. Keep these responsibilities distinct to avoid
> duplicate emails.

## Minutes packages (later)

For `minutes`-type products, a Medusa module + `order.placed` subscriber will
credit the minutes balance. The platform/CRM owns the balance today, so the
contract for crediting minutes will be defined when that phase starts. Until
then, just ensure minutes products are modeled so they are identifiable
(e.g., product `metadata.type = "minutes"` and a `minutes` quantity).

## Product content sync (Medusa -> Sanity)

Two teams author product data in two tools: **support/sales** create products in
Medusa (commerce data); **marketing** writes descriptions and curates the gallery
in Sanity. Medusa is the trigger; Sanity is the enrichment. Canonical record:
platform repo `docs/adr/024-commerce-medusa.md` -> "Product content & images".

**This backend owns a `product.*` subscriber** that keeps a Sanity stub in sync:

```
product.created  -> upsert Sanity `productDescription` stub (by medusaHandle, empty editorial fields)
product.updated  -> upsert stub if missing (keep marketing's edits; only sync the handle/link)
product.deleted  -> archive/unpublish the Sanity stub
```

- **Link key:** the Medusa product `handle` -> Sanity `productDescription.medusaHandle`
  (1:1; the durable cross-system key — never change handles after launch).
- The subscriber needs **Sanity write credentials** (project id, dataset, write
  token, API version) in this repo's env — see the table below.
- Create at least the **ES** document (the platform uses Sanity's
  `document-internationalization` plugin; EN is added later, ES is the fallback).
- The storefront merges Medusa + Sanity by handle and **falls back to Medusa's own
  fields** when the stub is still empty, so a product is sellable immediately.

> **Import / bulk caveat.** Products arrive from several channels: a **small
> Shopify import** (~80 products, many inactive — only `status:active` imported),
> plus **manual admin entry** and an **Excel/CSV import** that together build the
> ~250-product catalog. Each `product.created` event hits this subscriber, so it
> MUST be **idempotent** (upsert by handle — no duplicate stubs on re-runs). An
> Excel batch can still create many products at once, so **respect Sanity API rate
> limits** (batch/throttle) or skip per-event creation during a bulk load and
> generate stubs in a single controlled post-import batch script.

### Images: two-tier (do NOT store the full gallery in Medusa)

| Tier | Stored in | Purpose | Owner |
|---|---|---|---|
| Base / thumbnail | **Medusa File Module** (local dev, managed **S3** on Cloud) | Admin, cart/order/email thumbnails, storefront **fallback** | Shopify import populates it |
| Curated gallery | **Sanity** (asset CDN + transforms) | Public PDP gallery | Marketing |

The Shopify importer re-uploads source images to the Medusa File Module (base
tier). Marketing later curates the PDP gallery in Sanity. The storefront prefers
the Sanity gallery and falls back to Medusa base images.

## Shared / required environment

Medusa side (names are conventional; finalize during scaffold):

| Var | Purpose |
|-----|---------|
| `DATABASE_URL` | Medusa Postgres |
| `REDIS_URL` | Cache, event bus, workflow engine |
| `STRIPE_MUNDO_SECRET_KEY` | Stripe secret — **Mundo Espiritual** (products) |
| `STRIPE_MUNDO_WEBHOOK_SECRET` | Webhook signing secret — Mundo Espiritual endpoint |
| `STRIPE_GEDELIMBO_SECRET_KEY` | Stripe secret — **Gedelimbo** (minutes) |
| `STRIPE_GEDELIMBO_WEBHOOK_SECRET` | Webhook signing secret — Gedelimbo endpoint |
| `SHIPPO_API_KEY` | GoShippo |
| `RESEND_API_KEY` | Order emails |
| `SANITY_PROJECT_ID` | Sanity project for the `product.*` stub subscriber |
| `SANITY_DATASET` | Sanity dataset (e.g. `production`) |
| `SANITY_API_VERSION` | Sanity API version (e.g. `2025-01-01`) |
| `SANITY_WRITE_TOKEN` | Sanity token with **write** access (create/patch `productDescription` stubs) |
| `STORE_CORS` / `ADMIN_CORS` / `AUTH_CORS` | Allowed origins (storefront + admin) |
| `JWT_SECRET` / `COOKIE_SECRET` | Medusa auth secrets |
| `PLATFORM_WEBHOOK_URL` | Where to POST `order.placed` |
| `PLATFORM_WEBHOOK_SECRET` | Shared secret to authenticate the notification |

Platform side (already exists / to add): the Medusa Store API base URL +
publishable key, plus the shared `PLATFORM_WEBHOOK_SECRET` to verify incoming
`order.placed` notifications.

> **Publishable key is per sales channel.** Each selling surface (web today;
> Línea Psíquica / mobile app later) uses its own publishable key scoped to its
> channel — see `docs/architecture.md` -> "Sales channels". The web storefront
> uses the key bound to the default (web) channel. New clients get their own key;
> they do not share the web key.

## Versioning / change management

- Treat payloads as **additive**: add fields, don't repurpose or remove without
  coordinating both repos.
- The product `handle` is the durable cross-system key for editorial linking
  (Sanity) and storefront URLs — avoid changing handles after launch.

## Stripe accounts (two)

Medusa registers TWO Stripe payment providers, one per business account:

| Provider id (suggested) | Stripe account | Charges |
|---|---|---|
| `pp_stripe_mundo` | Mundo Espiritual | Physical + digital products |
| `pp_stripe_gedelimbo` | Gedelimbo | Minutes packages only |

- Each provider has its own secret/publishable keys and its own webhook signing secret (two webhook endpoints).
- Membership subscriptions are NOT here — they stay on the platform's direct-Stripe flow (also Gedelimbo). The platform repo's STRIPE_SECRET_KEY is the Gedelimbo account.
- Canonical record: platform repo `docs/adr/024-commerce-medusa.md` → "Stripe accounts".

### One provider per cart (hard constraint)

A Medusa cart is paid by a **single** payment provider, i.e. a **single Stripe
account**. Therefore **a cart cannot mix product items (Mundo) with minutes items
(Gedelimbo)** — that charge cannot be split across two accounts.

- **Rule:** minutes are sold in a **separate, minutes-only cart/checkout** from
  physical/digital products. The storefront enforces this.
- **Provider selection:** both providers are enabled on the single USD region;
  the storefront picks the provider when initializing the payment session —
  `pp_stripe_gedelimbo` for a minutes-only cart, `pp_stripe_mundo` otherwise.
- **Backend guard (recommended):** add a validation (cart workflow hook or a
  check at payment-session creation) that rejects a cart containing both a
  `metadata.type = "minutes"` item and a non-minutes item, so a mixed cart can
  never reach payment. At minimum, document the rule until minutes ship.
- **Status:** minutes are a **later phase** (no minutes products exist yet), so
  Gedelimbo is **config-only** in this scaffold pass — register it (placeholder
  keys) but it is not exercised until the minutes module lands. Consider gating
  its registration on `STRIPE_GEDELIMBO_SECRET_KEY` being present so local/dev
  boots cleanly without it.

### Webhook paths

Verify the exact per-instance webhook path Medusa generates (it derives from the
provider id; confirm `pp_stripe_mundo` vs `stripe_mundo` against the installed
provider version — do not assume). Point each Stripe account's webhook at its
matching path; a mismatch = silent signature-verification failures.

```bash
# Medusa env (one pair per account)
STRIPE_MUNDO_SECRET_KEY=
STRIPE_MUNDO_WEBHOOK_SECRET=
STRIPE_GEDELIMBO_SECRET_KEY=
STRIPE_GEDELIMBO_WEBHOOK_SECRET=
```