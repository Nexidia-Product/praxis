"use client";

/**
 * Project outcomes editor.
 *
 * Renders the project's outcomes as editable rows: a free-form text
 * field plus a product and a type dropdown (both optional), drawn from
 * the admin-managed vocabularies. Fully controlled — the parent owns the
 * `value: ProjectOutcome[]` array and receives the full new array on any
 * change, matching the DocumentLinksEditor pattern.
 */

import type { OutcomeDelivery, Project, ProjectId, ProjectOutcome } from "@/lib/db";

interface OutcomesEditorProps {
  value: ProjectOutcome[];
  onChange: (next: ProjectOutcome[]) => void;
  /** Admin-managed product vocabulary. */
  products: string[];
  /** Admin-managed type vocabulary. */
  types: string[];
  /**
   * Projects an outcome can be delivered by (the "Delivered by" picker).
   * Omit to hide the picker (callers without a project list).
   */
  allProjects?: Project[];
  /** The project being edited (null while creating); excluded from the picker. */
  selfId?: ProjectId | null;
  disabled?: boolean;
}

/** Select value for a delivery: "" = not yet planned, "self", or "p:<id>". */
function deliveryToValue(d: OutcomeDelivery | null | undefined): string {
  if (!d) return "";
  return d.kind === "self" ? "self" : `p:${d.project_id}`;
}

function valueToDelivery(v: string): OutcomeDelivery | null {
  if (v === "self") return { kind: "self" };
  if (v.startsWith("p:")) return { kind: "project", project_id: v.slice(2) };
  return null;
}

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `tmp-${Math.random().toString(36).slice(2)}`;
}

/** Keep a currently-set value selectable even if it's been removed from the vocab. */
function withCurrent(list: string[], current: string | null): string[] {
  if (current && !list.includes(current)) return [current, ...list];
  return list;
}

export function OutcomesEditor({
  value,
  onChange,
  products,
  types,
  allProjects,
  selfId = null,
  disabled,
}: OutcomesEditorProps) {
  const otherProjects = (allProjects ?? [])
    .filter((p) => p.project_id !== selfId)
    .sort((a, b) => a.name.localeCompare(b.name));

  /** Linked project ID that isn't in the list (e.g. since deleted), else null. */
  function missingTarget(o: ProjectOutcome): string | null {
    const d = o.delivery;
    if (!d || d.kind !== "project") return null;
    return otherProjects.some((p) => p.project_id === d.project_id)
      ? null
      : d.project_id;
  }

  function addRow() {
    onChange([
      ...value,
      { id: newId(), text: "", product: null, type: null, delivery: null },
    ]);
  }
  function patch(id: string, next: Partial<ProjectOutcome>) {
    onChange(value.map((o) => (o.id === id ? { ...o, ...next } : o)));
  }
  function remove(id: string) {
    onChange(value.filter((o) => o.id !== id));
  }

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
        Outcomes
      </h3>

      {value.length === 0 ? (
        <p className="text-xs italic text-gray-500">No outcomes yet.</p>
      ) : (
        <ul className="space-y-2">
          {value.map((o) => (
            <li
              key={o.id}
              className="grid grid-cols-1 gap-2 rounded-md border border-gray-200 bg-white p-2 sm:grid-cols-[1fr_150px_150px_auto]"
            >
              <input
                type="text"
                value={o.text}
                onChange={(e) => patch(o.id, { text: e.target.value })}
                disabled={disabled}
                placeholder="e.g. auto create outbound marketing campaign via Cognigy"
                className={inputCls}
              />
              <select
                value={o.product ?? ""}
                onChange={(e) =>
                  patch(o.id, { product: e.target.value || null })
                }
                disabled={disabled}
                className={inputCls}
                aria-label="Product"
              >
                <option value="">— product —</option>
                {withCurrent(products, o.product).map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
              <select
                value={o.type ?? ""}
                onChange={(e) => patch(o.id, { type: e.target.value || null })}
                disabled={disabled}
                className={inputCls}
                aria-label="Type"
              >
                <option value="">— type —</option>
                {withCurrent(types, o.type).map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => remove(o.id)}
                  aria-label="Remove outcome"
                  title="Remove"
                  className="justify-self-end rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-700 sm:justify-self-center"
                >
                  <svg viewBox="0 0 20 20" className="h-3.5 w-3.5" aria-hidden="true">
                    <path
                      d="M5 5l10 10M15 5L5 15"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    />
                  </svg>
                </button>
              ) : null}
              {allProjects ? (
                <label className="flex items-center gap-2 text-[11px] text-gray-600 sm:col-span-4">
                  <span className="shrink-0 font-medium">Delivered by</span>
                  <select
                    value={deliveryToValue(o.delivery)}
                    onChange={(e) =>
                      patch(o.id, { delivery: valueToDelivery(e.target.value) })
                    }
                    disabled={disabled}
                    className={inputCls}
                    aria-label="Delivered by"
                  >
                    <option value="">Not yet planned</option>
                    <option value="self">This project</option>
                    {missingTarget(o) ? (
                      <option value={`p:${missingTarget(o)}`}>
                        {missingTarget(o)} (not found)
                      </option>
                    ) : null}
                    {otherProjects.map((p) => (
                      <option key={p.project_id} value={`p:${p.project_id}`}>
                        {p.name} ({p.project_id})
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {!disabled ? (
        <button
          type="button"
          onClick={addRow}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-gray-800"
        >
          Add outcome
        </button>
      ) : null}

      {products.length === 0 && types.length === 0 ? (
        <p className="text-[11px] text-gray-500">
          Tip: add product and type values under Admin → Configuration →
          Outcomes to tag outcomes.
        </p>
      ) : null}
    </div>
  );
}
