/**
 * Legacy `/admin/health-thresholds` URL — redirects to
 * `/admin/configuration?tab=health-thresholds`. Health thresholds is
 * now a tab on the consolidated Configuration page.
 */

import { redirect } from "next/navigation";

export default function LegacyHealthThresholdsPage(): never {
  redirect("/admin/configuration?tab=health-thresholds");
}
