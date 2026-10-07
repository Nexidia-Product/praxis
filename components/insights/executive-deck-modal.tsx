"use client";

/**
 * Download-deck dialog for the Executive view.
 *
 * Pick a preset (Monthly update / Quarterly business review), which seeds
 * the sections and detail level, then adjust the quarter, pillars,
 * sections, detail and title as needed. Posts to
 * /api/export/executive-deck and saves the returned .pptx.
 */

import { useState } from "react";

import {
  DECK_PRESETS,
  DECK_SECTIONS,
  type DeckDetail,
  type DeckPreset,
  type DeckSection,
} from "@/lib/executive/deck";
import { EXEC_PILLARS, type ScopeOption } from "@/lib/executive/portfolio";

interface Props {
  options: ScopeOption[];
  initialScope: string;
  onClose: () => void;
}

export function ExecutiveDeckModal({ options, initialScope, onClose }: Props) {
  const [preset, setPreset] = useState<DeckPreset>("monthly");
  const [scope, setScope] = useState(initialScope);
  const [pillars, setPillars] = useState<string[]>([...EXEC_PILLARS]);
  const [sections, setSections] = useState<DeckSection[]>(
    DECK_PRESETS.monthly.sections,
  );
  const [detail, setDetail] = useState<DeckDetail>(DECK_PRESETS.monthly.detail);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function choosePreset(next: DeckPreset) {
    setPreset(next);
    setSections(DECK_PRESETS[next].sections);
    setDetail(DECK_PRESETS[next].detail);
  }

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  async function download() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/export/executive-deck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preset, scope, pillars, sections, detail, title }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? `Export failed (HTTP ${res.status}).`);
        return;
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const name = /filename="([^"]+)"/.exec(disposition)?.[1] ?? "Praxis_Executive.pptx";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const canDownload = pillars.length > 0 && sections.length > 0 && !busy;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Download executive deck"
      className="pol-modal-overlay"
      onClick={onClose}
    >
      <div
        className="pol-modal"
        style={{ maxWidth: 620 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pol-modal-header">
          <h2 className="pol-modal-title">Download executive deck</h2>
          <button
            type="button"
            className="pol-modal-close"
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="pol-modal-body space-y-4">
          <fieldset className="space-y-1">
            <legend className="mb-1 text-sm font-semibold">Preset</legend>
            {(Object.keys(DECK_PRESETS) as DeckPreset[]).map((k) => (
              <label key={k} className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="deck-preset"
                  checked={preset === k}
                  onChange={() => choosePreset(k)}
                  disabled={busy}
                  className="mt-1"
                />
                <span>
                  <span className="font-medium">{DECK_PRESETS[k].label}</span>
                  <span className="block text-xs text-gray-500">
                    {DECK_PRESETS[k].description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>

          <div>
            <label htmlFor="deck-scope" className="mb-1 block text-sm font-semibold">
              Quarter
            </label>
            <select
              id="deck-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              disabled={busy}
              className="pol-select"
              style={{ width: "100%" }}
            >
              {options.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                  {o.isCurrent ? " (current)" : ""} — {o.count} project
                  {o.count === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-semibold">Pillars</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {EXEC_PILLARS.map((p) => (
                <label key={p} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    checked={pillars.includes(p)}
                    onChange={() => setPillars((prev) => toggle(prev, p))}
                    disabled={busy}
                  />
                  {p}
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-sm font-semibold">Slides</legend>
            <div className="space-y-1">
              {DECK_SECTIONS.map((s) => (
                <label key={s.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sections.includes(s.key)}
                    onChange={() => setSections((prev) => toggle(prev, s.key))}
                    disabled={busy}
                    className="mt-1"
                  />
                  <span>
                    {s.label}
                    <span className="block text-xs text-gray-500">{s.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-1 text-sm font-semibold">Project detail</legend>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="deck-detail"
                  checked={detail === "summary"}
                  onChange={() => setDetail("summary")}
                  disabled={busy}
                />
                Summary (stage, status, release, risk)
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="deck-detail"
                  checked={detail === "detailed"}
                  onChange={() => setDetail("detailed")}
                  disabled={busy}
                />
                Detailed (adds Supports and Benefits)
              </label>
            </div>
          </fieldset>

          <div>
            <label htmlFor="deck-title" className="mb-1 block text-sm font-semibold">
              Deck title <span className="font-normal text-gray-500">(optional)</span>
            </label>
            <input
              id="deck-title"
              type="text"
              className="pol-input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={busy}
              maxLength={200}
              placeholder={
                preset === "qbr"
                  ? "Innovation Quarterly Business Review"
                  : "Innovation Monthly Update"
              }
              style={{ width: "100%" }}
            />
          </div>

          {error ? (
            <div role="alert" className="pol-notice pol-notice-err">
              <span aria-hidden="true">!</span>
              <span>{error}</span>
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
            onClick={download}
            disabled={!canDownload}
            className="pol-btn pol-btn-primary"
          >
            {busy ? "Building deck…" : "Download .pptx"}
          </button>
        </footer>
      </div>
    </div>
  );
}
