/**
 * Work in Progress dashboard (Insights).
 * See components/insights/wip-page.tsx.
 */

import { WipPage } from "@/components/insights/wip-page";

export const dynamic = "force-dynamic";

export default function Page() {
  return <WipPage mode="wip" />;
}
