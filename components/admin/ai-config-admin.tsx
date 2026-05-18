"use client";

/**
 * Admin → Configuration → AI tab.
 *
 * Lets an admin pick which Bedrock model each AI feature uses. The
 * dropdowns are populated from the live model list pulled from
 * /api/admin/ai/models (which itself calls listAvailableModels —
 * merging ListFoundationModels and ListInferenceProfiles).
 *
 * If the model list fails to load (SSO expired, AI disabled, region
 * denied, etc.) the form still works in "free-text" mode so an
 * admin can paste a model ID by hand.
 */

import { useEffect, useState } from "react";

import type { AiConfig } from "@/lib/db";

interface AvailableModelDTO {
  modelId: string;
  name: string;
  provider: string;
  type: "on-demand" | "inference-profile";
  regionInfo: string;
  capabilities: string;
}

interface Props {
  initialConfig: AiConfig;
  defaults: AiConfig;
}

const FEATURES: Array<{ key: keyof AiConfig; label: string; help: string }> = [
  {
    key: "estimate_model_id",
    label: "Complexity / time estimate",
    help: "Runs on every project save that changes the description. Pick a cheap, fast model — task is well-bounded.",
  },
  {
    key: "prioritize_model_id",
    label: "Priority recommendation",
    help: "Reasons across the full open-project list when an admin clicks AI Priority Review. Pick a stronger model.",
  },
  {
    key: "overlap_model_id",
    label: "Idea overlap",
    help: "Compares one submitted idea against existing projects and ideas. Pick a stronger model; low volume.",
  },
];

export function AiConfigAdmin({ initialConfig, defaults }: Props) {
  const [config, setConfig] = useState<AiConfig>(initialConfig);
  const [models, setModels] = useState<AvailableModelDTO[] | null>(null);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [loadingModels, setLoadingModels] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/ai/models", { method: "GET" })
      .then(async (resp) => {
        if (cancelled) return;
        if (resp.ok) {
          const data = (await resp.json()) as { models: AvailableModelDTO[] };
          setModels(data.models);
        } else {
          const data = (await resp.json().catch(() => ({}))) as {
            error?: string;
          };
          setModelsError(
            data.error ??
              `Could not load model list (HTTP ${resp.status}). Use the text inputs below to set model IDs manually.`,
          );
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setModelsError(
          err instanceof Error ? err.message : "Failed to fetch model list.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setSaveMessage(null);
    setSaveError(null);
    try {
      const resp = await fetch("/api/admin/ai-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!resp.ok) {
        const data = (await resp.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `HTTP ${resp.status}`);
      }
      setSaveMessage("Saved.");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  function resetToDefaults() {
    setConfig(defaults);
    setSaveMessage(null);
    setSaveError(null);
  }

  return (
    <section className="pol-card" style={{ padding: 16 }}>
      <h2
        className="pol-card-title"
        style={{ marginTop: 0, marginBottom: 4 }}
      >
        AI model selection
      </h2>
      <p style={{ fontSize: "var(--fs-sm)", color: "var(--tm)", marginTop: 0 }}>
        Choose which Bedrock model each AI feature uses. The dropdown
        lists every model your AWS account can invoke in the
        configured Bedrock region. AI features are local-only — they
        will not run in production until a credential strategy is in
        place.
      </p>

      {loadingModels ? (
        <p style={{ fontSize: "var(--fs-sm)", color: "var(--tm)" }}>
          Loading model list…
        </p>
      ) : null}

      {modelsError ? (
        <p
          style={{
            fontSize: "var(--fs-sm)",
            color: "var(--err)",
            background: "var(--err-tint)",
            padding: "8px 12px",
            borderRadius: "var(--pol-radius)",
            margin: "8px 0",
          }}
        >
          {modelsError}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 16, marginTop: 12 }}>
        {FEATURES.map((f) => (
          <div key={f.key}>
            <label
              htmlFor={`ai-model-${f.key}`}
              style={{
                display: "block",
                fontSize: "var(--fs-sm)",
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              {f.label}
            </label>
            <p
              style={{
                fontSize: "var(--fs-xs)",
                color: "var(--tm)",
                margin: "0 0 6px 0",
              }}
            >
              {f.help}
            </p>
            {models && models.length > 0 ? (
              <select
                id={`ai-model-${f.key}`}
                className="pol-input"
                value={config[f.key]}
                onChange={(e) =>
                  setConfig({ ...config, [f.key]: e.target.value })
                }
                style={{ width: "100%", maxWidth: 600 }}
              >
                {!models.some((m) => m.modelId === config[f.key]) ? (
                  <option value={config[f.key]}>
                    {config[f.key]} (not in current list)
                  </option>
                ) : null}
                {models.map((m) => (
                  <option key={m.modelId} value={m.modelId}>
                    [{m.type === "inference-profile" ? "global" : "on-demand"}]{" "}
                    {m.provider} — {m.name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={`ai-model-${f.key}`}
                type="text"
                className="pol-input"
                value={config[f.key]}
                onChange={(e) =>
                  setConfig({ ...config, [f.key]: e.target.value })
                }
                style={{ width: "100%", maxWidth: 600, fontFamily: "monospace" }}
              />
            )}
          </div>
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          marginTop: 16,
        }}
      >
        <button
          type="button"
          className="pol-btn pol-btn-primary"
          onClick={save}
          disabled={saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          className="pol-btn"
          onClick={resetToDefaults}
          disabled={saving}
        >
          Reset to defaults
        </button>
        {saveMessage ? (
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--pos)" }}>
            {saveMessage}
          </span>
        ) : null}
        {saveError ? (
          <span style={{ fontSize: "var(--fs-sm)", color: "var(--err)" }}>
            {saveError}
          </span>
        ) : null}
      </div>
    </section>
  );
}
