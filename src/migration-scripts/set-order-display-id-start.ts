import type { ExecArgs } from "@medusajs/framework/types"
import { ContainerRegistrationKeys } from "@medusajs/framework/utils"
import { Client } from "pg"

/**
 * One-time data migration: bump the Postgres sequence behind
 * `order.display_id` so the next human-facing order number is at least
 * 100000 (6 digits) instead of continuing from 1, 2, 3...
 *
 * Runs automatically via `npx medusa db:migrate` (and on Medusa Cloud deploy).
 * Tracked in `script_migrations` so it only executes once. Safe to re-run
 * conceptually: GREATEST(99999, max(display_id)) never lowers the sequence.
 */
export default async function setOrderDisplayIdStart({ container }: ExecArgs) {
  const logger = container.resolve(ContainerRegistrationKeys.LOGGER)
  const databaseUrl = process.env.DATABASE_URL

  if (!databaseUrl) {
    logger.warn(
      "DATABASE_URL not set; skipping order_display_id_seq bump."
    )
    return
  }

  const client = new Client({ connectionString: databaseUrl })
  await client.connect()

  try {
    const { rows } = await client.query<{ next_value: string }>(`
      SELECT setval(
        'order_display_id_seq',
        GREATEST(99999, (SELECT COALESCE(MAX(display_id), 0) FROM "order")),
        true
      ) AS next_value
    `)
    const nextValue = rows[0]?.next_value
    logger.info(
      `order_display_id_seq set so the next order.display_id will be ${
        nextValue ? Number(nextValue) + 1 : ">= 100000"
      }.`
    )
  } finally {
    await client.end()
  }
}
