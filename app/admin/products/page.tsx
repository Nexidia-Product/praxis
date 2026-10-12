/**
 * Admin → NiCE products.
 *
 * The configurable catalogue of NiCE products that use cases and projects
 * align to. Gated by `products.manage` (Admin-only by default).
 */

import {
  getCurrentUserPermissions,
  requirePagePermission,
} from "@/lib/auth/permissions";
import { NiceProductRepository, UseCaseRepository } from "@/lib/db";
import { ProductsAdmin } from "@/components/admin/products-admin";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function ProductsAdminPage() {
  const session = await requirePagePermission("products.manage");
  const { permissions } = await getCurrentUserPermissions();

  const [products, useCases] = await Promise.all([
    NiceProductRepository.getAll(),
    UseCaseRepository.getAll(),
  ]);

  // How many use cases align to each product, for the list.
  const useCaseCounts: Record<string, number> = {};
  for (const uc of useCases) {
    for (const id of uc.nice_product_ids ?? []) {
      useCaseCounts[id] = (useCaseCounts[id] ?? 0) + 1;
    }
  }

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="admin-products"
      breadcrumbs={[{ label: "Admin" }, { label: "NiCE products" }]}
    >
      <PolarisPageHeader
        eyebrow="Administration"
        title="NiCE products"
        subtitle="The NiCE products use cases and projects can align to. Rename or re-describe a product at any time; mark a product deprecated to stop it being newly selected while keeping existing alignments."
      />
      <ProductsAdmin initialProducts={products} useCaseCounts={useCaseCounts} />
    </PolarisShell>
  );
}
