import { ExecArgs } from "@medusajs/framework/types"
import { seedStore } from "../lib/seed/seed-store"

/**
 * Local CLI entrypoint for the store baseline seed (`npm run seed`).
 *
 * The actual logic lives in `seedStore` so it can be shared with the admin seed
 * route (`POST /admin/seed`), which is how seeding runs on Medusa Cloud where
 * there is no CLI exec. The routine is idempotent (no-op if a USD region exists).
 */
export default async function seed({ container }: ExecArgs) {
  await seedStore(container)
}
