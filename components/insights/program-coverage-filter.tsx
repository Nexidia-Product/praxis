"use client";

/**
 * Product alignment filter for Program Coverage. The drill-down is
 * URL-driven and server-rendered, so the filter lives in the URL too
 * (`?products=a,b`) and changing it navigates, keeping the current
 * pillar / use case.
 */

import { useRouter } from "next/navigation";

import { ProductFilter } from "@/components/shared/product-filter";
import type { NiceProduct } from "@/lib/db";
import { coverageHref } from "@/lib/coverage/select";

export function ProgramCoverageFilter({
  niceProducts,
  products,
  pillar,
  useCase,
}: {
  niceProducts: NiceProduct[];
  products: string[];
  pillar?: string;
  useCase?: string;
}) {
  const router = useRouter();
  const go = (next: string[]) =>
    router.push(coverageHref(pillar, useCase, next));
  return (
    <div className="flex flex-wrap items-center gap-3">
      <ProductFilter products={niceProducts} selected={products} onChange={go} />
      {products.length > 0 ? (
        <button
          type="button"
          onClick={() => go([])}
          className="text-xs text-gray-600 underline hover:text-gray-900"
        >
          Clear filters
        </button>
      ) : null}
    </div>
  );
}
