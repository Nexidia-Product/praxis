/**
 * Legacy `/admin/project-values` URL — redirects to
 * `/admin/configuration?tab=project-values`. Project values is now a
 * tab on the consolidated Configuration page.
 */

import { redirect } from "next/navigation";

export default function LegacyProjectValuesPage(): never {
  redirect("/admin/configuration?tab=project-values");
}
