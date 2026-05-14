/**
 * Legacy `/admin/resource-thresholds` URL — redirects to
 * `/admin/resources?tab=thresholds`. Resource thresholds is now a tab
 * on the consolidated Resource Management page.
 */

import { redirect } from "next/navigation";

export default function LegacyResourceThresholdsPage(): never {
  redirect("/admin/resources?tab=thresholds");
}
