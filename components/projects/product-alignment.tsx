"use client";

/**
 * "Product alignment" body for the project quick view.
 *
 * Works like the use case outcomes picker: the choices are the NiCE products
 * of the use case the project belongs to. Editors tick products and the
 * selection saves immediately; everyone else sees the aligned products.
 * Use case → product assignment is managed on Admin → Use cases, the product
 * catalogue on Admin → NiCE products.
 */

import { useState } from "react";

import type { NiceProduct, Project, UseCase } from "@/lib/db";

interface Props {
  project: Project;
  /** The project's use case, or null when it belongs to none. */
  useCase: UseCase | null;
  products: NiceProduct[];
  canEdit: boolean;
  /** Called with the saved project so the parent can refresh its copy. */
  onUpdated?: (project: Project) => void;
}

export function ProductAlignment({ project, useCase, products, canEdit, onUpdated }: Props) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = new Map(products.map((p) => [p.product_id, p]));
  const offered = (useCase?.nice_product_ids ?? [])
    .map((id) => byId.get(id))
    .filter((p): p is NiceProduct => !!p)
    .sort((a, b) => Number(a.deprecated) - Number(b.deprecated) || a.name.localeCompare(b.name));
  const selected = new Set(project.nice_product_ids ?? []);

  async function toggle(id: string, checked: boolean) {
    const next = checked
      ? [...(project.nice_product_ids ?? []), id]
      : (project.nice_product_ids ?? []).filter((v) => v !== id);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${project.project_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nice_product_ids: next }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        project?: Project;
        error?: string;
      };
      if (!res.ok || !data.project) {
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      onUpdated?.(data.project);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save product alignment.");
    } finally {
      setSaving(false);
    }
  }

  if (!useCase) {
    return (
      <p className="text-sm italic text-gray-400">
        This project isn&apos;t in a use case, so there are no products to select.
      </p>
    );
  }
  if (offered.length === 0) {
    return (
      <p className="text-sm italic text-gray-400">
        The use case “{useCase.name}” isn&apos;t aligned to any NiCE products yet.
      </p>
    );
  }

  // Read-only view: just the aligned products.
  if (!canEdit) {
    const aligned = offered.filter((p) => selected.has(p.product_id));
    return aligned.length === 0 ? (
      <p className="text-sm italic text-gray-400">No products selected yet.</p>
    ) : (
      <ul className="space-y-1">
        {aligned.map((p) => (
          <li key={p.product_id} className="text-sm text-gray-800">
            <span className="font-medium">{p.name}</span>
            {p.deprecated ? <span className="ml-1 text-gray-500">(deprecated)</span> : null}
            {p.description ? (
              <span className="block text-xs text-gray-500">{p.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <fieldset disabled={saving} className="space-y-2">
      <legend className="sr-only">Product alignment</legend>
      <p className="text-xs text-gray-500">
        Which NiCE products of “{useCase.name}” does this project align to?
      </p>
      <ul className="space-y-1">
        {offered.map((p) => {
          const checked = selected.has(p.product_id);
          // A deprecated product can be kept or removed, not newly picked.
          const locked = p.deprecated && !checked;
          return (
            <li key={p.product_id}>
              <label
                className={`flex items-start gap-2 text-sm text-gray-800 ${locked ? "opacity-60" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked}
                  onChange={(e) => toggle(p.product_id, e.target.checked)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0"
                />
                <span>
                  {p.name}
                  {p.deprecated ? <span className="ml-1 text-gray-500">(deprecated)</span> : null}
                  {p.description ? (
                    <span className="block text-xs text-gray-500">{p.description}</span>
                  ) : null}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}
