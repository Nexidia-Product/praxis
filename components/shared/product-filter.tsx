"use client";

/**
 * "Product alignment" filter — a checkbox dropdown listing the NiCE
 * products (plus "No product"), shared by every list / insight view so the
 * filter looks and behaves the same everywhere.
 *
 * Filter state is a plain `string[]` of `NiceProduct.product_id`s (and the
 * `NO_PRODUCT` sentinel). Apply it with `matchesProductFilter(ids, selected)`
 * from `lib/products/logic`, where `ids` is the item's `nice_product_ids`
 * (for a task or anything else that hangs off a project, the project's).
 */

import { useEffect, useMemo, useRef, useState } from "react";

import type { NiceProduct } from "@/lib/db";
import { productFilterOptions } from "@/lib/products/logic";

interface ProductFilterProps {
  products: ReadonlyArray<Pick<NiceProduct, "product_id" | "name" | "deprecated">>;
  selected: string[];
  onChange: (next: string[]) => void;
  /** Visible label; defaults to "Product alignment". */
  label?: string;
}

export function ProductFilter({
  products,
  selected,
  onChange,
  label = "Product alignment",
}: ProductFilterProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const options = useMemo(() => productFilterOptions(products), [products]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((s) => s !== value)
        : [...selected, value],
    );
  }

  const labelOf = (value: string) =>
    options.find((o) => o.value === value)?.label ?? value;
  const summary =
    selected.length === 0
      ? "All"
      : selected.length === 1
        ? labelOf(selected[0])
        : `${selected.length} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 min-w-[10rem] items-center justify-between gap-2 rounded-md border border-gray-300 bg-white px-3 text-left text-sm text-gray-900 shadow-sm transition hover:border-gray-400"
      >
        <span className="flex flex-col leading-tight">
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
            {label}
          </span>
          <span className="truncate text-sm text-gray-900">{summary}</span>
        </span>
        <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 text-gray-500">
          <path
            d="M2 4l4 4 4-4"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div className="absolute z-20 mt-1 max-h-64 w-64 overflow-auto rounded-md border border-gray-200 bg-white p-1 shadow-lg">
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-gray-100"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
              />
              <span className="text-gray-800">{o.label}</span>
            </label>
          ))}
          {selected.length > 0 ? (
            <button
              type="button"
              onClick={() => onChange([])}
              className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-gray-600 hover:bg-gray-100"
            >
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
