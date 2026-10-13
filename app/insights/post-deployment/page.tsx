/**
 * Post-deployment work (Insights): deployed projects that are still open.
 * See components/insights/wip-page.tsx.
 */

import { WipPage } from "@/components/insights/wip-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return <WipPage mode="post-deployment" />;
}
