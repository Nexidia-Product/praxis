/**
 * GET /api/admin/ai/models
 *
 * Returns the live merged list of Bedrock models the account can
 * invoke (on-demand foundation models + cross-region inference
 * profiles). Used by the Admin → Configuration → AI tab to
 * populate the per-feature model picker.
 *
 * Requires admin.ai.manage permission. Returns 503 if AI is
 * disabled, 502 if the Bedrock call fails (so the admin page
 * can surface the SSO-expired / region-denied / etc. error
 * without dropping the whole tab).
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { AiDisabledError, isAiEnabled } from "@/lib/ai/feature-flag";
import { listAvailableModels } from "@/lib/ai/models";

export const GET = withAuth(async () => {
  await requirePermission("admin.ai.manage");

  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: new AiDisabledError().message },
      { status: 503 },
    );
  }

  try {
    const models = await listAvailableModels();
    return NextResponse.json({ models });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    let hint = "";
    if (msg.includes("DenyAllOutsideWhitelistedRegion")) {
      hint =
        " The current region is blocked by the org's region-whitelist policy. " +
        "Set BEDROCK_REGION in .env.local to an allowed region and restart `npm run dev`.";
    } else if (msg.toLowerCase().includes("could not load credentials")) {
      hint =
        " Bedrock credentials could not be resolved. Run `aws sso login --profile bedrock` " +
        "and try again.";
    }
    console.error("[admin/ai/models] listAvailableModels failed:", err);
    return NextResponse.json({ error: msg + hint }, { status: 502 });
  }
});
