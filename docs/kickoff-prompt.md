# Kickoff prompt (paste into a fresh agent in this repo)

Use this when starting the first build agent in `ninoprodigio-medusa`. It assumes
the repo is already seeded with `README.md`, `docs/`, and `.cursor/rules/`.

> Keep this file updated if the architecture changes. The canonical decision
> record lives in the platform repo (`docs/adr/024-commerce-medusa.md`).

---

```text
You are working in the ninoprodigio-medusa repo (Medusa v2 headless commerce backend).

FIRST read these (already in the repo) and follow them:
- README.md  (role, stack, AI tooling)
- docs/architecture.md  (ownership boundaries, fulfillment pipeline, deferrals)
- docs/integration-contract.md  (cross-repo events, customer mapping by email,
  env, order.placed payload, "Stripe accounts")
- .cursor/rules/*  (medusa.mdc official rules, project-context, medusa-conventions,
  stripe, typescript, git-conventions)

Then:
1. Install the official Medusa agent skills: `npx skills add medusajs/medusa-agent-skills`
   (select the `medusa-dev` plugin skills).
2. Scaffold a Medusa v2 app with create-medusa-app in this repo (Postgres + Redis,
   admin at /app, .env.template).
3. Configure providers per docs/integration-contract.md:
   - Stripe with TWO providers — Mundo Espiritual (physical/digital products) and
     Gedelimbo (minutes packages) — each with its own TEST keys + webhook secret
     (STRIPE_MUNDO_* / STRIPE_GEDELIMBO_*). Select the provider per cart. Never
     charge products on Gedelimbo or minutes on Mundo Espiritual.
   - GoShippo (fulfillment) — shipping rates + labels; digital products use a
     no-shipping profile.
   - Resend (notifications) — order emails are sent from HERE.
   Set up a USD region, a stock location, and shipping options.
4. Add a Dockerfile + docker-compose (local + Coolify) and Railway deploy notes.
5. STOP and confirm the architecture with me before importing the real ~250-product
   catalog.

Constraints (from the rules): NO subscriptions/membership here, NO identity
mastering, NO direct Supabase/CRM writes — on order.placed, notify the platform
per docs/integration-contract.md. Keep secrets in env. Commit with Conventional
Commits on a feature branch.
```
