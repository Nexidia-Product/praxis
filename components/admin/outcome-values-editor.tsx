"use client";

/**
 * Outcome values admin editor (Admin → Configuration → Outcomes).
 *
 * Manages the two vocabularies that back the product / type dropdowns on
 * project outcomes. Each is a simple label list with add / remove; the
 * editor batches edits locally and saves both lists in one PUT.
 */

import { useMemo, useState } from "react";

interface OutcomeValuesEditorProps {
  initialProducts: string[];
  initialTypes: string[];
}

export function OutcomeValuesEditor({
  initialProducts,
  initialTypes,
}: OutcomeValuesEditorProps) {
  const [products, setProducts] = useState<string[]>(initialProducts);
  const [types, setTypes] = useState<string[]>(initialTypes);
  const [savedProducts, setSavedProducts] = useState<string[]>(initialProducts);
  const [savedTypes, setSavedTypes] = useState<string[]>(initialTypes);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const dirty = useMemo(
    () =>
      !sameList(products, savedProducts) || !sameList(types, savedTypes),
    [products, types, savedProducts, savedTypes],
  );

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/outcome-values", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outcome_products: products,
          outcome_types: types,
        }),
      });
      const data = (await res.json()) as {
        outcome_products?: string[];
        outcome_types?: string[];
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Save failed.");
      setProducts(data.outcome_products ?? []);
      setTypes(data.outcome_types ?? []);
      setSavedProducts(data.outcome_products ?? []);
      setSavedTypes(data.outcome_types ?? []);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setProducts(savedProducts);
    setTypes(savedTypes);
    setError(null);
    setSaved(false);
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-600">
        Values here populate the <strong>product</strong> and{" "}
        <strong>type</strong> dropdowns when adding outcomes to a project.
      </p>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <ListEditor
          title="Products"
          placeholder="e.g. Cognigy"
          values={products}
          onChange={(next) => {
            setProducts(next);
            setSaved(false);
          }}
        />
        <ListEditor
          title="Types"
          placeholder="e.g. automation"
          values={types}
          onChange={(next) => {
            setTypes(next);
            setSaved(false);
          }}
        />
      </div>

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
        >
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {dirty ? (
          <button
            type="button"
            onClick={discard}
            disabled={saving}
            className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Discard
          </button>
        ) : null}
        {saved && !dirty ? (
          <span className="text-xs text-green-700">Saved.</span>
        ) : null}
      </div>
    </div>
  );
}

function ListEditor({
  title,
  placeholder,
  values,
  onChange,
}: {
  title: string;
  placeholder: string;
  values: string[];
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  function add() {
    const v = draft.trim();
    if (!v) return;
    if (values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      setLocalError("That value is already in the list.");
      return;
    }
    setLocalError(null);
    onChange([...values, v]);
    setDraft("");
  }

  function remove(value: string) {
    onChange(values.filter((x) => x !== value));
  }

  return (
    <section className="rounded-md border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
        {title}
      </h3>
      {values.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {values.map((v) => (
            <li
              key={v}
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-800"
            >
              {v}
              <button
                type="button"
                onClick={() => remove(v)}
                aria-label={`Remove ${v}`}
                className="rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-700"
              >
                <svg viewBox="0 0 20 20" className="h-3 w-3" aria-hidden="true">
                  <path
                    d="M5 5l10 10M15 5L5 15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-xs italic text-gray-500">No values yet.</p>
      )}
      {localError ? (
        <p role="alert" className="mt-2 text-xs text-red-700">
          {localError}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => {
            setDraft(e.target.value);
            setLocalError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          className="block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-sm text-gray-900 placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
        />
        <button
          type="button"
          onClick={add}
          className="shrink-0 rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800"
        >
          Add
        </button>
      </div>
    </section>
  );
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}
