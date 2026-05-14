"use client";

/**
 * Admin Custom Fields editor (Section 5.19).
 *
 * Lets an Admin add, remove, and edit custom field definitions. Saves the
 * full list back to the server in one PUT — see the rationale on
 * `/api/admin/custom-fields/route.ts`.
 *
 * Validation runs client-side as a courtesy (key format, duplicate keys,
 * select fields with no options) and the server re-validates regardless.
 *
 * The "key" of a field is meant to be stable — it's what every project
 * record stores as the property name in `custom_fields`. Renaming the
 * label is safe; renaming the key effectively creates a new field and
 * orphans the old data. The editor warns about this when an existing
 * field's key is changed.
 */

import { useState } from "react";

import type { CustomFieldDefinition, CustomFieldType } from "@/lib/db";

interface CustomFieldsAdminProps {
  initialDefinitions: CustomFieldDefinition[];
}

const FIELD_TYPES: { value: CustomFieldType; label: string }[] = [
  { value: "text", label: "Text" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "boolean", label: "Yes / no" },
  { value: "select", label: "Single-select" },
];

interface DefDraft {
  /** Stable identity for React keys — UUID is overkill; index-stable is enough. */
  id: string;
  /** Whether this draft was loaded from the server (vs. just added). */
  fromServer: boolean;
  /** The original key when loaded from the server, used to warn on rename. */
  originalKey: string;
  key: string;
  label: string;
  type: CustomFieldType;
  required: boolean;
  options: string;
}

const KEY_RE = /^[a-z][a-z0-9_]*$/;

function toDrafts(defs: CustomFieldDefinition[]): DefDraft[] {
  return defs.map((d, i) => ({
    id: `srv-${i}`,
    fromServer: true,
    originalKey: d.key,
    key: d.key,
    label: d.label,
    type: d.type,
    required: Boolean(d.required),
    options: (d.options ?? []).join(", "),
  }));
}

let draftCounter = 0;
function newDraft(): DefDraft {
  draftCounter++;
  return {
    id: `new-${draftCounter}`,
    fromServer: false,
    originalKey: "",
    key: "",
    label: "",
    type: "text",
    required: false,
    options: "",
  };
}

function draftsToPayload(drafts: DefDraft[]): {
  ok: true;
  defs: CustomFieldDefinition[];
} | { ok: false; error: string } {
  const defs: CustomFieldDefinition[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < drafts.length; i++) {
    const d = drafts[i];
    const key = d.key.trim().toLowerCase();
    const label = d.label.trim();
    if (!key) return { ok: false, error: `Row ${i + 1}: key is required.` };
    if (!KEY_RE.test(key)) {
      return {
        ok: false,
        error: `Row ${i + 1}: key must start with a letter and contain only lowercase letters, digits, and underscores.`,
      };
    }
    if (seen.has(key)) {
      return { ok: false, error: `Row ${i + 1}: duplicate key "${key}".` };
    }
    seen.add(key);
    if (!label) return { ok: false, error: `Row ${i + 1}: label is required.` };

    const def: CustomFieldDefinition = {
      key,
      label,
      type: d.type,
      required: d.required,
    };
    if (d.type === "select") {
      const opts = d.options
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (opts.length === 0) {
        return {
          ok: false,
          error: `Row ${i + 1}: select fields require at least one option.`,
        };
      }
      def.options = opts;
    }
    defs.push(def);
  }
  return { ok: true, defs };
}

export function CustomFieldsAdmin({
  initialDefinitions,
}: CustomFieldsAdminProps) {
  const [drafts, setDrafts] = useState<DefDraft[]>(() =>
    toDrafts(initialDefinitions),
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<
    | { kind: "success"; text: string }
    | { kind: "error"; text: string }
    | null
  >(null);

  function update(id: string, patch: Partial<DefDraft>) {
    setDrafts((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    );
  }
  function remove(id: string) {
    setDrafts((prev) => prev.filter((d) => d.id !== id));
  }
  function add() {
    setDrafts((prev) => [...prev, newDraft()]);
  }

  async function save() {
    const result = draftsToPayload(drafts);
    if (!result.ok) {
      setMessage({ kind: "error", text: result.error });
      return;
    }
    setSaving(true);
    setMessage(null);
    const res = await fetch("/api/admin/custom-fields", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_field_definitions: result.defs }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      custom_field_definitions?: CustomFieldDefinition[];
      error?: string;
    };
    setSaving(false);
    if (!res.ok || !data.custom_field_definitions) {
      setMessage({
        kind: "error",
        text: data.error ?? "Could not save custom fields.",
      });
      return;
    }
    setDrafts(toDrafts(data.custom_field_definitions));
    setMessage({ kind: "success", text: "Custom fields saved." });
  }

  return (
    <div className="space-y-4">
      {message ? (
        <div
          role="alert"
          className={
            message.kind === "success"
              ? "rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
              : "rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
          }
        >
          {message.text}
        </div>
      ) : null}

      <div className="space-y-3">
        {drafts.map((d, i) => {
          const keyChanged =
            d.fromServer && d.originalKey !== d.key.trim().toLowerCase();
          return (
            <div
              key={d.id}
              className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between">
                <p className="text-xs font-medium uppercase tracking-wider text-gray-500">
                  Field {i + 1}
                </p>
                <button
                  type="button"
                  onClick={() => remove(d.id)}
                  disabled={saving}
                  className="text-xs text-gray-500 hover:text-red-700 disabled:opacity-50"
                >
                  Remove
                </button>
              </div>
              <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`cf-label-${d.id}`}
                    className="block text-xs font-medium text-gray-700"
                  >
                    Label
                  </label>
                  <input
                    id={`cf-label-${d.id}`}
                    type="text"
                    value={d.label}
                    onChange={(e) => update(d.id, { label: e.target.value })}
                    disabled={saving}
                    placeholder="e.g. Business Unit"
                    className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`cf-key-${d.id}`}
                    className="block text-xs font-medium text-gray-700"
                  >
                    Key
                  </label>
                  <input
                    id={`cf-key-${d.id}`}
                    type="text"
                    value={d.key}
                    onChange={(e) =>
                      update(d.id, { key: e.target.value.toLowerCase() })
                    }
                    disabled={saving}
                    placeholder="e.g. business_unit"
                    className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 font-mono text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  />
                  {keyChanged ? (
                    <p className="mt-1 text-xs text-amber-700">
                      Changing the key orphans existing data on this field.
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-gray-500">
                      Lowercase letters, digits, and underscores. Stays the
                      same once data is recorded.
                    </p>
                  )}
                </div>
                <div>
                  <label
                    htmlFor={`cf-type-${d.id}`}
                    className="block text-xs font-medium text-gray-700"
                  >
                    Type
                  </label>
                  <select
                    id={`cf-type-${d.id}`}
                    value={d.type}
                    onChange={(e) =>
                      update(d.id, { type: e.target.value as CustomFieldType })
                    }
                    disabled={saving}
                    className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                    <input
                      type="checkbox"
                      checked={d.required}
                      onChange={(e) =>
                        update(d.id, { required: e.target.checked })
                      }
                      disabled={saving}
                      className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
                    />
                    Required
                  </label>
                </div>
                {d.type === "select" ? (
                  <div className="sm:col-span-2">
                    <label
                      htmlFor={`cf-opts-${d.id}`}
                      className="block text-xs font-medium text-gray-700"
                    >
                      Options
                    </label>
                    <input
                      id={`cf-opts-${d.id}`}
                      type="text"
                      value={d.options}
                      onChange={(e) =>
                        update(d.id, { options: e.target.value })
                      }
                      disabled={saving}
                      placeholder="Comma-separated, e.g. Retail, Wholesale, Direct"
                      className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900"
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}

        {drafts.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-300 bg-white py-8 text-center text-sm text-gray-500">
            No custom fields defined. Click "Add field" to create one.
          </p>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={add}
          disabled={saving}
          className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          + Add field
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-gray-900 px-4 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}
