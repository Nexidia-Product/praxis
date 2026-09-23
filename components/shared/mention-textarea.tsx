"use client";

/**
 * `@`-mention-aware textarea.
 *
 * Drop-in replacement for a plain `<textarea>` on Task Comments and
 * Project status-summary fields. Storage stays plain text — this
 * component only helps the user type a literal `@Full Name` token; the
 * backend re-resolves those tokens against active users at save time
 * (`lib/notifications/mentions.ts`). No rich text, no HTML.
 *
 * Typing `@` opens a small dropdown of matching active users (filtered
 * as you keep typing), anchored under the textarea — anchoring to the
 * textarea's bounding box rather than to the caret's pixel position,
 * since computing per-character caret coordinates inside a `<textarea>`
 * is nontrivial and not worth it for a short field. Arrow keys move the
 * highlight, Enter/Tab or a click selects, Escape closes just the
 * popup (stops propagation so it doesn't also dismiss a parent modal).
 */

import { useEffect, useMemo, useRef, useState } from "react";

export interface MentionableUser {
  user_id: string;
  name: string;
}

interface MentionTriggerMatch {
  /** Index of the triggering `@` within the full text. */
  start: number;
  /** Text typed after `@`, up to the cursor. */
  query: string;
}

const MAX_SUGGESTIONS = 8;

/**
 * Find the `@query` the cursor is currently sitting inside of, if any.
 * The `@` must be at the start of the text or preceded by whitespace
 * (so emails / already-resolved mentions mid-word don't re-trigger), and
 * the query itself may contain single spaces (multi-word names) but not
 * a double space or a newline, either of which ends the mention.
 */
function findMentionTrigger(
  text: string,
  cursor: number,
): MentionTriggerMatch | null {
  const upToCursor = text.slice(0, cursor);
  const match = /@([^\n@]{0,40})$/.exec(upToCursor);
  if (!match) return null;
  const start = match.index;
  const prevChar = start > 0 ? upToCursor[start - 1] : "";
  if (prevChar && !/\s/.test(prevChar)) return null;
  const query = match[1];
  if (/\s{2,}/.test(query)) return null;
  return { start, query };
}

export function MentionTextarea({
  id,
  value,
  onChange,
  users,
  rows = 2,
  disabled,
  className,
  placeholder,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  users: MentionableUser[];
  rows?: number;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingCaretRef = useRef<number | null>(null);

  const [trigger, setTrigger] = useState<MentionTriggerMatch | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  const suggestions = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.trim().toLowerCase();
    const pool = q
      ? users.filter((u) => u.name.toLowerCase().includes(q))
      : users;
    return pool.slice(0, MAX_SUGGESTIONS);
  }, [trigger, users]);

  const open = trigger !== null && suggestions.length > 0;

  // Restore the caret after a programmatic value change (a selection).
  useEffect(() => {
    if (pendingCaretRef.current === null) return;
    const pos = pendingCaretRef.current;
    pendingCaretRef.current = null;
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(pos, pos);
  }, [value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [trigger?.query]);

  // Close the popup on an outside click (mirrors GlobalSearch / bell).
  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) setTrigger(null);
    }
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  function syncTriggerFromCursor(el: HTMLTextAreaElement) {
    const cursor = el.selectionStart ?? el.value.length;
    setTrigger(findMentionTrigger(el.value, cursor));
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    onChange(e.target.value);
    syncTriggerFromCursor(e.target);
  }

  function selectUser(user: MentionableUser) {
    if (!trigger || !textareaRef.current) return;
    const el = textareaRef.current;
    const cursor = el.selectionStart ?? value.length;
    const insertion = `@${user.name} `;
    const next = value.slice(0, trigger.start) + insertion + value.slice(cursor);
    pendingCaretRef.current = trigger.start + insertion.length;
    setTrigger(null);
    onChange(next);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % suggestions.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      selectUser(suggestions[activeIndex]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setTrigger(null);
    }
  }

  return (
    <div ref={wrapperRef} style={{ position: "relative" }}>
      <textarea
        id={id}
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => {
          // Arrow-key cursor movement doesn't fire onChange; re-check the
          // trigger so moving the caret out of a mention closes the popup.
          if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
            syncTriggerFromCursor(e.currentTarget);
          }
        }}
        onClick={(e) => syncTriggerFromCursor(e.currentTarget)}
        rows={rows}
        disabled={disabled}
        className={className}
        placeholder={placeholder}
      />
      {open ? (
        <ul
          role="listbox"
          aria-label="Mention a user"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 30,
            marginTop: 2,
            maxHeight: 200,
            overflowY: "auto",
            listStyle: "none",
            padding: "4px 0",
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--pol-radius)",
            boxShadow: "0 4px 16px rgba(0,0,0,.12)",
          }}
        >
          {suggestions.map((u, i) => (
            <li key={u.user_id} role="option" aria-selected={i === activeIndex}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => selectUser(u)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  padding: "6px 10px",
                  border: "none",
                  background: i === activeIndex ? "var(--hover)" : "transparent",
                  color: "var(--t1)",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {u.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
