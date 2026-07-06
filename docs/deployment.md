# Deployment

Primary target: **Medusa Cloud** (managed PaaS, push-to-deploy from GitHub).
A `Dockerfile` is included as a **self-host fallback** (Railway/Coolify) only.

## Medusa Cloud (primary)

Cloud builds from source on every push; it does **not** use the `Dockerfile`.

1. Push this repo to GitHub (private recommended).
2. In the Medusa Cloud dashboard, create a project and **connect the GitHub repo**
   (Develop tier for build/preview, Launch tier for production).
3. Cloud provisions managed **Postgres + Redis + workers** and sets `DATABASE_URL`
   / `REDIS_URL` automatically. You do not set those yourself on Cloud.
4. Set the remaining environment variables (Cloud dashboard → project → Environment),
   matching [`.env.template`](../.env.template) and
   [`integration-contract.md`](integration-contract.md):
   - `JWT_SECRET`, `COOKIE_SECRET`
   - `STORE_CORS`, `ADMIN_CORS`, `AUTH_CORS` (storefront + admin origins)
   - `STRIPE_MUNDO_SECRET_KEY`, `STRIPE_MUNDO_WEBHOOK_SECRET`
   - `STRIPE_GEDELIMBO_SECRET_KEY`, `STRIPE_GEDELIMBO_WEBHOOK_SECRET` (when minutes ship)
   - `SHIPPO_API_KEY` (+ `SHIPPO_FROM_*`)
   - `RESEND_API_KEY`, `RESEND_FROM_EMAIL`
   - `WEB_PLATFORM_WEBHOOK_URL`, `WEB_PLATFORM_WEBHOOK_SECRET`
5. Cloud runs migrations on deploy. To seed the store baseline once, run
   `npm run seed` against the Cloud database (or via the Cloud CLI).
6. Configure Stripe webhooks (one endpoint per account), pointing at the deployed
   server URL:
   - Mundo Espiritual → `https://<server>/hooks/payment/stripe_mundo`
   - Gedelimbo → `https://<server>/hooks/payment/stripe_gedelimbo`
   Set each endpoint's signing secret as the matching `STRIPE_*_WEBHOOK_SECRET`.

`MEDUSA_WORKER_MODE` is managed by Cloud's server/worker split; it still applies
for local and self-hosted runs.

## Self-host fallback (Railway / Coolify)

No lock-in: Medusa is MIT-licensed and data is exportable.

- **Railway**: use the Medusa template or a Dockerfile deploy; add Postgres + Redis
  plugins; set the env vars above (`DATABASE_URL` / `REDIS_URL` from the plugins).
- **Coolify**: deploy via `docker-compose` (app + Postgres + Redis) or the
  included `Dockerfile`; set the same env vars.

The `Dockerfile` builds with `medusa build`, runs `medusa db:migrate` on start,
then `medusa start`. Expose port `9000`. Admin is served at `/app`.

## Local development

```bash
cp .env.template .env        # fill in secrets as needed
docker compose up -d          # Postgres + Redis
npx medusa db:migrate
npx medusa user -e admin@ninoprodigio.com -p <password>
npm run seed                  # USD region, US location, shipping options
npm run dev                   # API + Admin at http://localhost:9000/app
```
