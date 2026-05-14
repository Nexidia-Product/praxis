"use client";

/**
 * Document & Repository Links editor (Section 5.14).
 *
 * Used by the project form modal (and reusable from any task editor that
 * grows the same need). Renders the current set of links as deletable
 * chips and a single "add link" row that auto-detects the link type when
 * the user pastes a URL.
 *
 * State management:
 *   - The parent owns the canonical `value: DocumentLink[]` array; this
 *     component is fully controlled. The parent calls `onChange` with the
 *     full new array — no granular events. That keeps the surface area
 *     thin and means the parent can re-render cheaply on every keystroke.
 *
 * On `added_by` and `added_at`:
 *   - Server-side validation owns provenance. New rows get the current
 *     user + timestamp; existing rows preserve theirs (matched by URL).
 *     We send sentinel values from here (`""` and the current ISO time)
 *     so the request body is well-formed even on a fresh row; the server
 *     overwrites both regardless.
 */

import { useState } from "react";

import {
  DOCUMENT_LINK_TYPES,
  detectLinkType,
} from "@/lib/projects/links";
import type { DocumentLink, DocumentLinkType } from "@/lib/db";

interface DocumentLinksEditorProps {
  value: DocumentLink[];
  onChange: (next: DocumentLink[]) => void;
  disabled?: boolean;
  /** Optional label override; defaults to "Document Links". */
  title?: string;
}

const LINK_TYPE_ICON: Record<DocumentLinkType, string> = {
  "GitHub Repo": "🐙",
  "GitHub PR": "🔀",
  Confluence: "📘",
  "Network Drive": "🗄",
  SharePoint: "📂",
  Figma: "🎨",
  Miro: "🟧",
  "Jira Issue": "🎫",
  External: "🔗",
  Other: "📎",
};

export function DocumentLinksEditor({
  value,
  onChange,
  disabled,
  title = "Document & repository links",
}: DocumentLinksEditorProps) {
  const [draftUrl, setDraftUrl] = useState("");
  const [draftLabel, setDraftLabel] = useState("");
  const [draftType, setDraftType] = useState<DocumentLinkType>("External");
  // Track whether the user has manually overridden the type — once they
  // pick one explicitly, we stop auto-detecting on every URL keystroke.
  const [userPickedType, setUserPickedType] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Inline-edit state (LINK-03). The chip with `editingUrl === link.url`
  // renders as a small form rather than the read-only chip; the rest
  // of the list stays displayed.
  const [editingUrl, setEditingUrl] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editType, setEditType] = useState<DocumentLinkType>("External");
  const [editError, setEditError] = useState<string | null>(null);

  function urlChange(url: string) {
    setDraftUrl(url);
    if (!userPickedType && url.trim()) {
      setDraftType(detectLinkType(url.trim()));
    }
  }

  function addLink() {
    const url = draftUrl.trim();
    if (!url) {
      setError("Enter a URL.");
      return;
    }
    if (value.some((l) => l.url === url)) {
      setError("That URL is already in the list.");
      return;
    }
    setError(null);
    const label = draftLabel.trim() || url;
    onChange([
      ...value,
      {
        label,
        url,
        link_type: draftType,
        // Server overwrites both. These are sentinel values that pass the
        // shape check so the wire payload validates.
        added_by: "",
        added_at: new Date().toISOString(),
      },
    ]);
    setDraftUrl("");
    setDraftLabel("");
    setDraftType("External");
    setUserPickedType(false);
  }

  function removeLink(url: string) {
    if (editingUrl === url) {
      setEditingUrl(null);
    }
    onChange(value.filter((l) => l.url !== url));
  }

  function startEdit(link: DocumentLink) {
    setEditingUrl(link.url);
    setEditUrl(link.url);
    setEditLabel(link.label);
    setEditType(link.link_type);
    setEditError(null);
  }

  function cancelEdit() {
    setEditingUrl(null);
    setEditError(null);
  }

  function saveEdit() {
    const trimmedUrl = editUrl.trim();
    if (!trimmedUrl) {
      setEditError("Enter a URL.");
      return;
    }
    // Allow keeping the same URL on edit; only flag a collision with a
    // *different* link's URL.
    if (
      value.some((l) => l.url === trimmedUrl && l.url !== editingUrl)
    ) {
      setEditError("That URL is already in the list.");
      return;
    }
    setEditError(null);
    const label = editLabel.trim() || trimmedUrl;
    onChange(
      value.map((l) =>
        l.url === editingUrl
          ? { ...l, url: trimmedUrl, label, link_type: editType }
          : l,
      ),
    );
    setEditingUrl(null);
  }

  return (
    <div className="space-y-3 rounded-md border border-gray-200 bg-gray-50 p-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
        {title}
      </h3>

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((link) => {
            const isEditing = editingUrl === link.url;
            if (isEditing) {
              return (
                <li
                  key={link.url}
                  className="flex w-full flex-col gap-1.5 rounded-md border border-gray-300 bg-white p-2 text-xs"
                >
                  {editError ? (
                    <p
                      role="alert"
                      className="rounded border border-red-200 bg-red-50 px-2 py-1 text-[11px] text-red-700"
                    >
                      {editError}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_140px]">
                    <input
                      type="url"
                      value={editUrl}
                      onChange={(e) => setEditUrl(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      placeholder="https://..."
                      className={inputCls}
                    />
                    <input
                      type="text"
                      value={editLabel}
                      onChange={(e) => setEditLabel(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveEdit();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      placeholder="Label (optional)"
                      className={inputCls}
                    />
                    <select
                      value={editType}
                      onChange={(e) =>
                        setEditType(e.target.value as DocumentLinkType)
                      }
                      className={inputCls}
                    >
                      {DOCUMENT_LINK_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="rounded-md border border-gray-300 bg-white px-2 py-1 text-[11px] font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={saveEdit}
                      className="rounded-md bg-gray-900 px-2 py-1 text-[11px] font-medium text-white hover:bg-gray-800"
                    >
                      Save
                    </button>
                  </div>
                </li>
              );
            }
            return (
              <li
                key={link.url}
                className="group inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
              >
                <span aria-hidden>{LINK_TYPE_ICON[link.link_type]}</span>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="font-medium text-gray-900 underline-offset-2 hover:underline"
                  title={link.url}
                >
                  {link.label}
                </a>
                <span className="text-[10px] uppercase tracking-wider text-gray-500">
                  {link.link_type}
                </span>
                {!disabled ? (
                  <>
                    <button
                      type="button"
                      onClick={() => startEdit(link)}
                      className="-mr-0.5 ml-0.5 rounded p-0.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                      aria-label={`Edit ${link.label}`}
                      title="Edit"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        className="h-3 w-3"
                        aria-hidden="true"
                      >
                        <path
                          d="M14.5 2.5l3 3-9 9H5.5v-3l9-9z"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => removeLink(link.url)}
                      className="-mr-0.5 rounded p-0.5 text-gray-400 hover:bg-red-50 hover:text-red-700"
                      aria-label={`Remove ${link.label}`}
                      title="Remove"
                    >
                      <svg
                        viewBox="0 0 20 20"
                        className="h-3 w-3"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 5l10 10M15 5L5 15"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        />
                      </svg>
                    </button>
                  </>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs italic text-gray-500">No links yet.</p>
      )}

      {!disabled ? (
        <div className="space-y-2">
          {error ? (
            <p
              role="alert"
              className="text-xs text-red-700"
            >
              {error}
            </p>
          ) : null}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_140px_auto]">
            <input
              type="url"
              placeholder="https://..."
              value={draftUrl}
              onChange={(e) => urlChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
              className={inputCls}
            />
            <input
              type="text"
              placeholder="Label (optional)"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addLink();
                }
              }}
              className={inputCls}
            />
            <select
              value={draftType}
              onChange={(e) => {
                setDraftType(e.target.value as DocumentLinkType);
                setUserPickedType(true);
              }}
              className={inputCls}
            >
              {DOCUMENT_LINK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addLink}
              className="rounded-md bg-gray-900 px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-gray-800"
            >
              Add link
            </button>
          </div>
          <p className="text-[11px] text-gray-500">
            Type is auto-detected from the URL — adjust manually if needed.
          </p>
        </div>
      ) : null}
    </div>
  );
}

const inputCls =
  "block w-full rounded-md border border-gray-300 bg-white px-2 py-1 text-xs text-gray-900 shadow-sm placeholder:text-gray-400 focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900";
