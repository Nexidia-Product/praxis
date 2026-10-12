"use client";

/**
 * NiCE products admin — add, rename / re-describe, and (un)deprecate.
 * There is no delete: deprecating hides a product from new selections
 * while existing use case / project alignments keep it. The API enforces
 * `products.manage`; this page is only reachable with it.
 */

import { useMemo, useState } from "react";

import type { NiceProduct } from "@/lib/db";

interface Props {
  initialProducts: NiceProduct[];
  /** product_id → number of use cases aligned to it. */
  useCaseCounts: Record<string, number>;
}

interface ProductPayload {
  name?: string;
  description?: string;
  deprecated?: boolean;
}

const LABEL_STYLE = {
  display: "block",
  fontSize: "var(--fs-sm)",
  fontWeight: 600,
  marginBottom: 4,
} as const;

function byName(a: NiceProduct, b: NiceProduct) {
  return a.name.localeCompare(b.name);
}

export function ProductsAdmin({ initialProducts, useCaseCounts }: Props) {
  const [products, setProducts] = useState<NiceProduct[]>(initialProducts);
  const [editing, setEditing] = useState<NiceProduct | null>(null);
  const [creating, setCreating] = useState(false);
  const [showDeprecated, setShowDeprecated] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeCount = products.filter((p) => !p.deprecated).length;
  const visible = useMemo(
    () =>
      products
        .filter((p) => showDeprecated || !p.deprecated)
        .sort(
          (a, b) => Number(a.deprecated) - Number(b.deprecated) || byName(a, b),
        ),
    [products, showDeprecated],
  );

  async function save(
    url: string,
    method: "POST" | "PUT",
    payload: ProductPayload,
  ): Promise<NiceProduct> {
    const resp = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await resp.json().catch(() => ({}))) as {
      product?: NiceProduct;
      error?: string;
    };
    if (!resp.ok || !data.product) {
      throw new Error(data.error ?? `HTTP ${resp.status}`);
    }
    return data.product;
  }

  async function handleCreate(payload: ProductPayload) {
    const created = await save("/api/admin/products", "POST", payload);
    setProducts((prev) => [...prev, created]);
    setCreating(false);
  }

  async function handleUpdate(id: string, payload: ProductPayload) {
    const updated = await save(`/api/admin/products/${id}`, "PUT", payload);
    setProducts((prev) => prev.map((p) => (p.product_id === id ? updated : p)));
    setEditing(null);
  }

  async function toggleDeprecated(p: NiceProduct) {
    const uses = useCaseCounts[p.product_id] ?? 0;
    if (
      !p.deprecated &&
      uses > 0 &&
      !window.confirm(
        `Deprecate "${p.name}"? ${uses} use case${uses === 1 ? "" : "s"} already align${uses === 1 ? "s" : ""} to it and will keep the alignment, but it can't be newly selected.`,
      )
    ) {
      return;
    }
    setBusyId(p.product_id);
    setError(null);
    try {
      await handleUpdate(p.product_id, { deprecated: !p.deprecated });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="toolbar">
        <div style={{ fontSize: "var(--fs-sm)", color: "var(--tm)" }}>
          {products.length} product{products.length === 1 ? "" : "s"} ({activeCount}{" "}
          active, {products.length - activeCount} deprecated).
        </div>
        <label
          style={{
            display: "inline-flex",
            gap: 6,
            alignItems: "center",
            fontSize: "var(--fs-sm)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={showDeprecated}
            onChange={(e) => setShowDeprecated(e.target.checked)}
          />
          Show deprecated
        </label>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="pol-btn pol-btn-primary"
        >
          + New product
        </button>
      </div>

      {error ? (
        <div role="alert" style={{ fontSize: "var(--fs-sm)", color: "var(--err)" }}>
          {error}
        </div>
      ) : null}

      <div className="pol-card" style={{ padding: 0 }}>
        {visible.length === 0 ? (
          <div
            style={{
              padding: "24px 12px",
              fontSize: "var(--fs-sm)",
              color: "var(--tm)",
              textAlign: "center",
            }}
          >
            No products to show.
          </div>
        ) : null}
        {visible.map((p) => {
          const uses = useCaseCounts[p.product_id] ?? 0;
          return (
            <div
              key={p.product_id}
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 110px 200px",
                gap: 8,
                padding: "10px 12px",
                alignItems: "center",
                borderBottom: "1px solid var(--border)",
                opacity: p.deprecated ? 0.65 : 1,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: "var(--t1)" }}>
                  {p.name}
                  {p.deprecated ? (
                    <span
                      style={{
                        marginLeft: 8,
                        border: "1px solid var(--border)",
                        borderRadius: 999,
                        padding: "1px 8px",
                        fontSize: "var(--fs-xs)",
                        fontWeight: 700,
                        color: "var(--t2)",
                      }}
                    >
                      Deprecated
                    </span>
                  ) : null}
                </div>
                <div
                  style={{
                    fontSize: "var(--fs-sm)",
                    color: p.description ? "var(--t2)" : "var(--tm)",
                    fontStyle: p.description ? "normal" : "italic",
                  }}
                >
                  {p.description || "No description."}
                </div>
              </div>
              <span style={{ fontSize: "var(--fs-sm)", color: "var(--t2)" }}>
                {uses} use case{uses === 1 ? "" : "s"}
              </span>
              <span style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                <button
                  type="button"
                  className="pol-btn pol-btn-secondary"
                  onClick={() => setEditing(p)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="pol-btn pol-btn-secondary"
                  disabled={busyId === p.product_id}
                  onClick={() => toggleDeprecated(p)}
                >
                  {p.deprecated ? "Restore" : "Deprecate"}
                </button>
              </span>
            </div>
          );
        })}
      </div>

      {creating ? (
        <ProductFormModal
          product={null}
          onClose={() => setCreating(false)}
          onSubmit={handleCreate}
        />
      ) : null}
      {editing ? (
        <ProductFormModal
          product={editing}
          onClose={() => setEditing(null)}
          onSubmit={(payload) => handleUpdate(editing.product_id, payload)}
        />
      ) : null}
    </div>
  );
}

function ProductFormModal({
  product,
  onClose,
  onSubmit,
}: {
  product: NiceProduct | null;
  onClose: () => void;
  onSubmit: (payload: ProductPayload) => Promise<void>;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [deprecated, setDeprecated] = useState(product?.deprecated ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim(),
        deprecated,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={product ? "Edit product" : "New product"}
      className="pol-modal-overlay"
      onClick={onClose}
    >
      <div
        className="pol-modal"
        style={{ maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pol-modal-header">
          <h2 className="pol-modal-title">
            {product ? "Edit product" : "New product"}
          </h2>
          <button
            type="button"
            className="pol-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="pol-modal-body">
          <div>
            <label htmlFor="prod-name" style={LABEL_STYLE}>
              Name <span style={{ color: "var(--err)" }}>*</span>
            </label>
            <input
              id="prod-name"
              type="text"
              className="pol-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={busy}
              maxLength={200}
              style={{ width: "100%" }}
            />
          </div>
          <div>
            <label htmlFor="prod-desc" style={LABEL_STYLE}>
              Description
            </label>
            <textarea
              id="prod-desc"
              className="pol-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={busy}
              rows={4}
              maxLength={2000}
              style={{ width: "100%" }}
            />
          </div>
          <label
            style={{
              display: "inline-flex",
              gap: 6,
              alignItems: "center",
              fontSize: "var(--fs-sm)",
              cursor: "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={deprecated}
              onChange={(e) => setDeprecated(e.target.checked)}
              disabled={busy}
            />
            Deprecated (can&apos;t be newly selected; existing alignments are kept)
          </label>

          {error ? (
            <div
              role="alert"
              style={{
                fontSize: "var(--fs-sm)",
                color: "var(--err)",
                background: "var(--err-tint, rgba(220, 38, 38, 0.08))",
                padding: "8px 12px",
                borderRadius: "var(--pol-radius)",
              }}
            >
              {error}
            </div>
          ) : null}
        </div>

        <footer className="pol-modal-footer" style={{ gap: 8 }}>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pol-btn pol-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={busy || name.trim() === ""}
            className="pol-btn pol-btn-primary"
          >
            {busy ? "Saving…" : product ? "Save changes" : "Add product"}
          </button>
        </footer>
      </div>
    </div>
  );
}
