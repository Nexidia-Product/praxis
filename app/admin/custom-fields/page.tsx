/**
 * Legacy `/admin/custom-fields` URL — redirects to
 * `/admin/configuration?tab=custom-fields`. Custom fields is now a tab
 * on the consolidated Configuration page alongside Project values,
 * Portfolio quadrants, and Health thresholds.
 */

import { redirect } from "next/navigation";

export default function LegacyCustomFieldsPage(): never {
  redirect("/admin/configuration?tab=custom-fields");
}
