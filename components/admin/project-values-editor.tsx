"use client";

/**
 * Project values editor.
 *
 * Four tabs (one per extensible enum). Each tab shows:
 *
 *   - System rows: read-only chip listing the built-in values.
 *   - Extension rows: editable label + per-enum metadata + archive
 *     toggle + delete button. New extensions are added through an
 *     inline form at the bottom.
 *
 * State is held locally and committed to the API on Save (single PUT
 * with the full enum_extensions object). "Discard" reverts to the
 * server's last known state without a re-fetch.
 *
 * Per-enum metadata UI:
 *
 *   - status:    is_open + is_terminal toggles
 *   - priority:  rank input (numeric; placed between Critical=0 and Low=3)
 *   - phase:     order input (numeric; lifecycle position)
 *   - application_product: no extra metadata
 *
 * IDs vs labels: when an admin types a new label we auto-derive the id
 * (slug-style) and let them override it. Once an id has been used in
 * production data, deleting the value would orphan those records — so
 * we surface that risk with an "archive instead" affordance and only
 * allow delete on values that have never been saved (i.e. were just
 * added in this editor session).
 */

import { useMemo, useState } from "react";
import type {
  EnumExtension,
  EnumExtensionsMap,
  ExtensibleEnumKey,
} from "@/lib/db";
import type { EnumOption } from "@/lib/projects/enum-options";

interface ProjectValuesEditorProps {
  initialOptions: Record<ExtensibleEnumKey, EnumOption[]>;
  initialExtensions: EnumExtensionsMap;
}

type TabKey = ExtensibleEnumKey;

const TABS: Array<{ key: TabKey; label: string; description: string }> = [
  {
    key: "status",
    label: "Status",
    description:
      "Project workflow states. The eight built-in values are locked because the application's filtering, health scoring, and reporting branch on them.",
  },
  {
    key: "phase",
    label: "Phase",
    description:
      "Lifecycle phases. Built-in phases follow Appendix C; admin-added phases pick an Order value to slot in.",
  },
  {
    key: "priority",
    label: "Priority",
    description:
      "Priority bands. Built-in values range from Critical (rank 0) to Low (rank 3); pick a fractional rank to insert between them.",
  },
  {
    key: "application_product",
    label: "Application / Product",
    description:
      "Tags identifying the product or application a project belongs to. Ships with one built-in (\"Admin\" for internal / operational work); all other values are admin-curated.",
  },
];

export function ProjectValuesEditor({
  initialOptions,
  initialExtensions,
}: ProjectValuesEditorProps) {
  // Working copy of extensions per enum. The "saved" copy is what we
  // diff against to decide whether the Save button is dirty.
  const [extensions, setExtensions] = useState<EnumExtensionsMap>(
    () => clone(initialExtensions),
  );
  const [savedExtensions, setSavedExtensions] = useState<EnumExtensionsMap>(
    () => clone(initialExtensions),
  );
  // Track which extension IDs are new (added in this session) — those
  // can be deleted; saved ones can only be archived.
  const [unsavedIds, setUnsavedIds] = useState<Record<TabKey, Set<string>>>(
    () => ({
      status: new Set(),
      phase: new Set(),
      priority: new Set(),
      application_product: new Set(),
    }),
  );

  const [activeTab, setActiveTab] = useState<TabKey>("status");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Track the system rows for each enum (these never change).
  const systemRows = useMemo(() => {
    const out: Record<TabKey, EnumOption[]> = {
      status: [],
      phase: [],
      priority: [],
      application_product: [],
    };
    for (const k of Object.keys(initialOptions) as TabKey[]) {
      out[k] = initialOptions[k].filter((o) => o.source === "system");
    }
    return out;
  }, [initialOptions]);

  const dirty = useMemo(
    () => !deepEqualExtensions(extensions, savedExtensions),
    [extensions, savedExtensions],
  );

  // ----- Mutators -----

  function addExtension(enumKey: TabKey, draft: NewExtensionDraft) {
    const id = draft.id.trim();
    const label = draft.label.trim();
    if (!id || !label) {
      setError("Both id and label are required.");
      return;
    }
    // Block duplicates against system + existing extensions.
    const taken =
      systemRows[enumKey].some((o) => o.id === id) ||
      extensions[enumKey].some((e) => e.id === id);
    if (taken) {
      setError(`"${id}" already exists. Pick a different id.`);
      return;
    }

    const ext: EnumExtension = {
      id,
      label,
      archived: false,
      created_by: null, // server fills in the acting user
      created_at: new Date().toISOString(),
    };
    if (enumKey === "status") {
      ext.is_open = draft.is_open ?? true;
      ext.is_terminal = draft.is_terminal ?? false;
    }
    if (enumKey === "priority" && draft.rank !== undefined) {
      ext.rank = draft.rank;
    }
    if (enumKey === "phase" && draft.order !== undefined) {
      ext.order = draft.order;
    }
    if (draft.description) ext.description = draft.description;

    setExtensions((prev) => ({
      ...prev,
      [enumKey]: [...prev[enumKey], ext],
    }));
    setUnsavedIds((prev) => ({
      ...prev,
      [enumKey]: new Set([...prev[enumKey], id]),
    }));
    setError(null);
    setSavedAt(null);
  }

  function patchExtension(
    enumKey: TabKey,
    id: string,
    patch: Partial<EnumExtension>,
  ) {
    setExtensions((prev) => ({
      ...prev,
      [enumKey]: prev[enumKey].map((e) =>
        e.id === id ? { ...e, ...patch } : e,
      ),
    }));
    setError(null);
    setSavedAt(null);
  }

  function deleteExtension(enumKey: TabKey, id: string) {
    setExtensions((prev) => ({
      ...prev,
      [enumKey]: prev[enumKey].filter((e) => e.id !== id),
    }));
    setUnsavedIds((prev) => {
      const next = new Set(prev[enumKey]);
      next.delete(id);
      return { ...prev, [enumKey]: next };
    });
    setError(null);
    setSavedAt(null);
  }

  function discard() {
    setExtensions(clone(savedExtensions));
    setUnsavedIds({
      status: new Set(),
      phase: new Set(),
      priority: new Set(),
      application_product: new Set(),
    });
    setError(null);
    setSavedAt(null);
  }

  async function save() {
    if (!dirty || submitting) return;
    setSubmitting(true);
    setError(null);

    const res = await fetch("/api/admin/project-values", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enum_extensions: extensions }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
      };
      setError(data.error ?? "Could not save changes.");
      return;
    }
    const data = (await res.json()) as {
      extensions: EnumExtensionsMap;
    };
    setExtensions(clone(data.extensions));
    setSavedExtensions(clone(data.extensions));
    setUnsavedIds({
      status: new Set(),
      phase: new Set(),
      priority: new Set(),
      application_product: new Set(),
    });
    setSavedAt(Date.now());
  }

  // ----- Render -----

  const activeTabMeta = TABS.find((t) => t.key === activeTab)!;
  const activeSystem = systemRows[activeTab];
  const activeExtensions = extensions[activeTab];
  const activeUnsaved = unsavedIds[activeTab];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Tab strip */}
      <div
        style={{
          display: "flex",
          gap: 0,
          borderBottom: "1px solid var(--border)",
        }}
      >
        {TABS.map((t) => {
          const active = t.key === activeTab;
          const tabDirty = !deepEqualOne(
            extensions[t.key],
            savedExtensions[t.key],
          );
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setActiveTab(t.key)}
              className="pol-btn pol-btn-ghost"
              style={{
                borderRadius: 0,
                borderBottom: active
                  ? "2px solid var(--brand)"
                  : "2px solid transparent",
                color: active ? "var(--brand)" : "var(--t2)",
                fontWeight: active ? 600 : 500,
                padding: "8px 14px",
                height: "auto",
              }}
            >
              {t.label}
              {tabDirty ? (
                <span
                  aria-label="unsaved changes"
                  style={{
                    marginLeft: 6,
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--warn)",
                    display: "inline-block",
                  }}
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <p style={{ color: "var(--tm)", fontSize: 12, lineHeight: 1.55 }}>
        {activeTabMeta.description}
      </p>

      {/* Banners */}
      {error ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      ) : null}
      {savedAt ? (
        <div role="status" className="pol-notice pol-notice-ok">
          <span aria-hidden="true">✓</span>
          <span>Project values saved.</span>
        </div>
      ) : null}

      {/* System rows */}
      {activeSystem.length > 0 ? (
        <div className="pol-card pol-card-pad">
          <div className="section-label" style={{ marginBottom: 10 }}>
            System values (locked)
          </div>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
            }}
          >
            {activeSystem.map((o) => (
              <span key={o.id} className="pol-tag pol-tag-gray" title={o.id}>
                {o.label}
                {activeTab === "status" && o.is_terminal ? " · terminal" : null}
                {activeTab === "status" && o.is_open === false && !o.is_terminal
                  ? " · closed"
                  : null}
                {activeTab === "phase" && typeof o.order === "number"
                  ? ` · #${o.order + 1}`
                  : null}
                {activeTab === "priority" && typeof o.rank === "number"
                  ? ` · rank ${o.rank}`
                  : null}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="pol-notice pol-notice-info">
          <span aria-hidden="true">ℹ</span>
          <span>
            This dimension has no system values — every entry below is
            admin-curated.
          </span>
        </div>
      )}

      {/* Extensions table */}
      <ExtensionsTable
        enumKey={activeTab}
        extensions={activeExtensions}
        unsavedIds={activeUnsaved}
        onPatch={(id, patch) => patchExtension(activeTab, id, patch)}
        onDelete={(id) => deleteExtension(activeTab, id)}
      />

      {/* Add form */}
      <AddExtensionForm
        enumKey={activeTab}
        existingIds={[
          ...activeSystem.map((o) => o.id),
          ...activeExtensions.map((e) => e.id),
        ]}
        onAdd={(draft) => addExtension(activeTab, draft)}
      />

      {/* Footer */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 8,
          paddingTop: 4,
        }}
      >
        <button
          type="button"
          onClick={discard}
          className="pol-btn pol-btn-secondary"
          disabled={!dirty || submitting}
        >
          Discard changes
        </button>
        <button
          type="button"
          onClick={save}
          className="pol-btn pol-btn-primary"
          disabled={!dirty || submitting}
        >
          {submitting ? "Saving…" : "Save changes"}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extensions table
// ---------------------------------------------------------------------------

interface ExtensionsTableProps {
  enumKey: TabKey;
  extensions: EnumExtension[];
  unsavedIds: Set<string>;
  onPatch: (id: string, patch: Partial<EnumExtension>) => void;
  onDelete: (id: string) => void;
}

function ExtensionsTable({
  enumKey,
  extensions,
  unsavedIds,
  onPatch,
  onDelete,
}: ExtensionsTableProps) {
  if (extensions.length === 0) {
    return (
      <div
        className="pol-card"
        style={{
          padding: "24px 14px",
          textAlign: "center",
          color: "var(--tm)",
          fontSize: 12,
        }}
      >
        No admin-added values yet. Add one below.
      </div>
    );
  }

  // Column layout depends on per-enum metadata.
  const cols = columnTemplate(enumKey);

  return (
    <div className="pol-card" style={{ padding: 0 }}>
      <div
        className="col-header"
        style={{
          display: "grid",
          gridTemplateColumns: cols,
          gap: 10,
          padding: "8px 14px",
        }}
      >
        <div>Label</div>
        <div>ID</div>
        {enumKey === "status" ? (
          <>
            <div style={{ textAlign: "center" }}>Open?</div>
            <div style={{ textAlign: "center" }}>Terminal?</div>
          </>
        ) : null}
        {enumKey === "priority" ? <div>Rank</div> : null}
        {enumKey === "phase" ? <div>Order</div> : null}
        <div style={{ textAlign: "center" }}>Status</div>
        <div style={{ textAlign: "right" }}>Actions</div>
      </div>

      {extensions.map((e) => {
        const isNew = unsavedIds.has(e.id);
        return (
          <div
            key={e.id}
            className="grid-row"
            style={{
              display: "grid",
              gridTemplateColumns: cols,
              gap: 10,
              padding: "10px 14px",
              alignItems: "center",
              opacity: e.archived ? 0.7 : 1,
            }}
          >
            <input
              value={e.label}
              onChange={(ev) => onPatch(e.id, { label: ev.target.value })}
              className="pol-input"
            />
            <div
              title={e.id}
              style={{
                fontSize: 11,
                color: "var(--tm)",
                fontFamily:
                  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {e.id}
            </div>

            {enumKey === "status" ? (
              <>
                <div style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={e.is_open ?? true}
                    onChange={(ev) =>
                      onPatch(e.id, { is_open: ev.target.checked })
                    }
                    aria-label="Counts as open"
                  />
                </div>
                <div style={{ textAlign: "center" }}>
                  <input
                    type="checkbox"
                    checked={e.is_terminal ?? false}
                    onChange={(ev) =>
                      onPatch(e.id, { is_terminal: ev.target.checked })
                    }
                    aria-label="Closes the project"
                  />
                </div>
              </>
            ) : null}
            {enumKey === "priority" ? (
              <input
                type="number"
                step="0.1"
                value={e.rank ?? ""}
                onChange={(ev) =>
                  onPatch(e.id, {
                    rank:
                      ev.target.value === ""
                        ? undefined
                        : Number(ev.target.value),
                  })
                }
                className="pol-input"
                placeholder="e.g. 0.5"
              />
            ) : null}
            {enumKey === "phase" ? (
              <input
                type="number"
                step="0.5"
                value={e.order ?? ""}
                onChange={(ev) =>
                  onPatch(e.id, {
                    order:
                      ev.target.value === ""
                        ? undefined
                        : Number(ev.target.value),
                  })
                }
                className="pol-input"
                placeholder="e.g. 4.5"
              />
            ) : null}

            <div style={{ textAlign: "center" }}>
              {e.archived ? (
                <span className="pol-tag pol-tag-gray">Archived</span>
              ) : isNew ? (
                <span className="pol-tag pol-tag-yellow">New</span>
              ) : (
                <span className="pol-tag pol-tag-green">Active</span>
              )}
            </div>

            <div
              style={{
                display: "flex",
                gap: 6,
                justifyContent: "flex-end",
                flexWrap: "wrap",
              }}
            >
              <button
                type="button"
                onClick={() => onPatch(e.id, { archived: !e.archived })}
                className="pol-btn pol-btn-ghost pol-btn-sm"
                title={
                  e.archived
                    ? "Show this value in dropdowns again"
                    : "Hide from new dropdowns; existing records keep the value"
                }
              >
                {e.archived ? "Unarchive" : "Archive"}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (
                    !isNew &&
                    !confirm(
                      `Permanently delete "${e.label}"? Any project record still using this value will keep the raw id but lose its label and metadata. Use Archive if you're not sure.`,
                    )
                  ) {
                    return;
                  }
                  onDelete(e.id);
                }}
                className="pol-btn pol-btn-ghost pol-btn-sm"
                style={{ color: "var(--err)" }}
              >
                Delete
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function columnTemplate(enumKey: TabKey): string {
  // Common: Label | ID | (per-enum cols) | Status | Actions
  switch (enumKey) {
    case "status":
      return "1.4fr 1fr 80px 90px 90px 170px";
    case "priority":
      return "1.4fr 1fr 100px 90px 170px";
    case "phase":
      return "1.4fr 1fr 100px 90px 170px";
    case "application_product":
      return "1.4fr 1fr 90px 170px";
  }
}

// ---------------------------------------------------------------------------
// Add form
// ---------------------------------------------------------------------------

interface NewExtensionDraft {
  id: string;
  label: string;
  description?: string;
  is_open?: boolean;
  is_terminal?: boolean;
  rank?: number;
  order?: number;
}

interface AddExtensionFormProps {
  enumKey: TabKey;
  existingIds: string[];
  onAdd: (draft: NewExtensionDraft) => void;
}

function AddExtensionForm({
  enumKey,
  existingIds,
  onAdd,
}: AddExtensionFormProps) {
  const [label, setLabel] = useState("");
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);
  const [isOpen, setIsOpen] = useState(true);
  const [isTerminal, setIsTerminal] = useState(false);
  const [rank, setRank] = useState<string>("");
  const [order, setOrder] = useState<string>("");

  // Auto-derive id from label until the user types in the id field.
  const derivedId = idTouched ? id : slugify(label);

  function reset() {
    setLabel("");
    setId("");
    setIdTouched(false);
    setIsOpen(true);
    setIsTerminal(false);
    setRank("");
    setOrder("");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const draft: NewExtensionDraft = {
      id: derivedId,
      label: label.trim(),
    };
    if (enumKey === "status") {
      draft.is_open = isOpen;
      draft.is_terminal = isTerminal;
    }
    if (enumKey === "priority" && rank !== "") {
      const n = Number(rank);
      if (Number.isFinite(n)) draft.rank = n;
    }
    if (enumKey === "phase" && order !== "") {
      const n = Number(order);
      if (Number.isFinite(n)) draft.order = n;
    }
    onAdd(draft);
    reset();
  }

  const conflict = derivedId && existingIds.includes(derivedId);

  return (
    <form
      onSubmit={submit}
      className="pol-card pol-card-pad"
      style={{ background: "var(--bg)" }}
    >
      <div className="section-label" style={{ marginBottom: 10 }}>
        Add new value
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: addFormColumns(enumKey),
          gap: 10,
          alignItems: "end",
        }}
      >
        <div className="form-field">
          <label className="form-label" htmlFor="ext-label">
            Label
          </label>
          <input
            id="ext-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            required
            className="pol-input"
          />
        </div>
        <div className="form-field">
          <label className="form-label" htmlFor="ext-id">
            ID
          </label>
          <input
            id="ext-id"
            value={derivedId}
            onChange={(e) => {
              setIdTouched(true);
              setId(e.target.value);
            }}
            placeholder="auto from label"
            className="pol-input"
          />
        </div>

        {enumKey === "status" ? (
          <>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--t2)",
              }}
            >
              <input
                type="checkbox"
                checked={isOpen}
                onChange={(e) => setIsOpen(e.target.checked)}
              />
              Open
            </label>
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontSize: 12,
                color: "var(--t2)",
              }}
            >
              <input
                type="checkbox"
                checked={isTerminal}
                onChange={(e) => setIsTerminal(e.target.checked)}
              />
              Terminal
            </label>
          </>
        ) : null}
        {enumKey === "priority" ? (
          <div className="form-field">
            <label className="form-label" htmlFor="ext-rank">
              Rank
            </label>
            <input
              id="ext-rank"
              type="number"
              step="0.1"
              value={rank}
              onChange={(e) => setRank(e.target.value)}
              placeholder="0.5"
              className="pol-input"
            />
          </div>
        ) : null}
        {enumKey === "phase" ? (
          <div className="form-field">
            <label className="form-label" htmlFor="ext-order">
              Order
            </label>
            <input
              id="ext-order"
              type="number"
              step="0.5"
              value={order}
              onChange={(e) => setOrder(e.target.value)}
              placeholder="4.5"
              className="pol-input"
            />
          </div>
        ) : null}

        <button
          type="submit"
          disabled={!label || !derivedId || !!conflict}
          className="pol-btn pol-btn-primary"
        >
          Add
        </button>
      </div>
      {conflict ? (
        <p className="form-help" style={{ color: "var(--err)", marginTop: 6 }}>
          That id is already in use.
        </p>
      ) : null}
      <p className="form-help" style={{ marginTop: 8, color: "var(--tm)" }}>
        The <strong>id</strong> is what gets stored on every project record
        and shouldn&apos;t be changed once the value has been used. The{" "}
        <strong>label</strong> is what appears in the UI and can be renamed
        freely.
      </p>
    </form>
  );
}

function addFormColumns(enumKey: TabKey): string {
  switch (enumKey) {
    case "status":
      return "1fr 1fr 80px 90px auto";
    case "priority":
      return "1fr 1fr 100px auto";
    case "phase":
      return "1fr 1fr 100px auto";
    case "application_product":
      return "1fr 1fr auto";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(s: string): string {
  // Light-touch: trim, collapse internal whitespace to single spaces.
  // We keep mixed case and punctuation because the existing IDs in the
  // codebase ARE labels ("In Progress", "On Hold"), and admins
  // overriding the id field is supported if they want a slug-style ID.
  return s.trim().replace(/\s+/g, " ");
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function deepEqualOne(a: EnumExtension[], b: EnumExtension[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

function deepEqualExtensions(
  a: EnumExtensionsMap,
  b: EnumExtensionsMap,
): boolean {
  return (
    deepEqualOne(a.status, b.status) &&
    deepEqualOne(a.phase, b.phase) &&
    deepEqualOne(a.priority, b.priority) &&
    deepEqualOne(a.application_product, b.application_product)
  );
}
