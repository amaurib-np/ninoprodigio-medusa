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
      "provider": "stripe",
      "stripe_payment_intent_id": "pi_..."   // for the platform's tx mirror
    },
    "created_at": "2026-..."
  }
}
```

What the platform does on receipt (for reference; implemented in the platform):
- Resolve the user by email (or store as a guest order).
- Insert a mirror row into `transactions` (or `guest_orders`).
- Enqueue `create_transaction` into Supabase `sync_queue` -> SpiritualCRM.
- Trigger any portal-side notifications it owns.

> Order **emails** (confirmation, shipped/tracking) are sent by **Medusa** via
> Resend, not by the platform. Keep these responsibilities distinct to avoid
> duplicate emails.

## Minutes packages (later)

For `minutes`-type products, a Medusa module + `order.placed` subscriber will
credit the minutes balance. The platform/CRM owns the balance today, so the
contract for crediting minutes will be defined when that phase starts. Until
then, just ensure minutes products are modeled so they are identifiable
(e.g., product `metadata.type = "minutes"` and a `minutes` quantity).

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
| `STORE_CORS` / `ADMIN_CORS` / `AUTH_CORS` | Allowed origins (storefront + admin) |
| `JWT_SECRET` / `COOKIE_SECRET` | Medusa auth secrets |
| `PLATFORM_WEBHOOK_URL` | Where to POST `order.placed` |
| `PLATFORM_WEBHOOK_SECRET` | Shared secret to authenticate the notification |

Platform side (already exists / to add): the Medusa Store API base URL +
publishable key, plus the shared `PLATFORM_WEBHOOK_SECRET` to verify incoming
`order.placed` notifications.

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
- Select the provider per cart/region: minutes carts → Gedelimbo, product carts → Mundo Espiritual.
- Membership subscriptions are NOT here — they stay on the platform's direct-Stripe flow (also Gedelimbo). The platform repo's STRIPE_SECRET_KEY is the Gedelimbo account.
- Canonical record: platform repo `docs/adr/024-commerce-medusa.md` → "Stripe accounts".

```bash
# Medusa env (one pair per account)
STRIPE_MUNDO_SECRET_KEY=
STRIPE_MUNDO_WEBHOOK_SECRET=
STRIPE_GEDELIMBO_SECRET_KEY=
STRIPE_GEDELIMBO_WEBHOOK_SECRET=
```