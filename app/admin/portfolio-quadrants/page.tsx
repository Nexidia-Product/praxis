/**
 * Legacy `/admin/portfolio-quadrants` URL — redirects to
 * `/admin/configuration?tab=portfolio-quadrants`. Portfolio quadrants
 * is now a tab on the consolidated Configuration page.
 */

import { redirect } from "next/navigation";

export default function LegacyPortfolioQuadrantsPage(): never {
  redirect("/admin/configuration?tab=portfolio-quadrants");
}
