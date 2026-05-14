/**
 * Manually run the daily notification sweep — bypasses the API
 * route entirely so it works offline and against a local Supabase
 * dev stack.
 *
 * Production cron runs via Vercel Cron POSTing to
 * `/api/admin/notifications/sweep` with the CRON_SECRET; this
 * script is for ad-hoc debugging.
 *
 * Usage:
 *   tsx --env-file=.env.local scripts/run-notifications-sweep.ts
 *
 * Exits non-zero on uncaught error so cron mailing-on-failure works.
 */

import { runDailySweep } from "../lib/notifications/sweep";

async function main() {
  const result = await runDailySweep();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("[run-notifications-sweep] failed:", err);
  process.exit(1);
});
