"use client";

/**
 * Per-user program access control for the Users admin panel.
 *
 * More involved than the plain `<select>` used for Role/Active, so it's
 * split into its own component: a summary button opens a popover with an
 * "All programs" master toggle, a checklist of specific programs (used
 * when unrestricted is unchecked), and — only when more than one program
 * is checked — a Primary selector. Edits are local to the popover and
 * committed via an explicit "Apply" button (rather than PATCHing on every
 * checkbox click, since a single click rarely represents the admin's
 * final intent here the way a single Role change does).
 */

import { useEffect, useRef, useState } from "react";
import type { EnumOption } from "@/lib/projects/enum-options";

interface ProgramAccessCellProps {
  allowedPrograms: string[] | null;
  primaryProgram: string | null;
  programOptions: EnumOption[];
  /** True for Admin-role rows — program restriction is bypassed for
   *  Admins regardless of any stored value, so the control is moot. */
  disabled?: boolean;
  onApply: (
    allowedPrograms: string[] | null,
    primaryProgram: string | null,
  ) => Promise<void>;
}

function summarize(allowed: string[] | null): string {
  if (allowed === null) return "All programs";
  if (allowed.length === 1) return allowed[0];
  return `${allowed.length} programs`;
}

export function ProgramAccessCell({
  allowedPrograms,
  primaryProgram,
  programOptions,
  disabled,
  onApply,
}: ProgramAccessCellProps) {
  const [open, setOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [draftAll, setDraftAll] = useState(allowedPrograms === null);
  const [draftSelected, setDraftSelected] = useState<Set<string>>(
    () => new Set(allowedPrograms ?? programOptions.map((o) => o.id)),
  );
  const [draftPrimary, setDraftPrimary] = useState(primaryProgram ?? "");
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  function openPopover() {
    // Reset the draft from the current committed values each time it
    // opens, so a cancelled edit never leaks into the next open.
    setDraftAll(allowedPrograms === null);
    setDraftSelected(new Set(allowedPrograms ?? programOptions.map((o) => o.id)));
    setDraftPrimary(primaryProgram ?? "");
    setOpen(true);
  }

  function toggleProgram(id: string) {
    setDraftSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function apply() {
    if (applying) return;
    const selected = Array.from(draftSelected);
    if (!draftAll && selected.length === 0) return; // guarded by disabled button too
    const nextAllowed = draftAll ? null : selected;
    const nextPrimary =
      nextAllowed === null
        ? draftPrimary || null
        : nextAllowed.length > 1 && nextAllowed.includes(draftPrimary)
          ? draftPrimary
          : null;
    setApplying(true);
    await onApply(nextAllowed, nextPrimary);
    setApplying(false);
    setOpen(false);
  }

  if (disabled) {
    return <span style={{ fontSize: 12, color: "var(--t2)" }}>All programs</span>;
  }

  const primaryChoices = draftAll ? programOptions.map((o) => o.id) : Array.from(draftSelected);

  return (
    <div ref={ref} className="relative" style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPopover())}
        className="pol-btn pol-btn-secondary pol-btn-sm"
        style={{ width: "100%", justifyContent: "flex-start" }}
      >
        {summarize(allowedPrograms)}
      </button>
      {open ? (
        <div
          style={{
            position: "absolute",
            zIndex: 20,
            marginTop: 4,
            width: 240,
            borderRadius: "var(--pol-radius)",
            border: "1px solid var(--border)",
            background: "var(--card)",
            padding: 10,
            boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
          }}
        >
          <label
            style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
          >
            <input
              type="checkbox"
              checked={draftAll}
              onChange={(e) => setDraftAll(e.target.checked)}
            />
            All programs
          </label>

          {!draftAll ? (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {programOptions.map((o) => (
                <label
                  key={o.id}
                  style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}
                >
                  <input
                    type="checkbox"
                    checked={draftSelected.has(o.id)}
                    onChange={() => toggleProgram(o.id)}
                  />
                  {o.label}
                </label>
              ))}
              {draftSelected.size === 0 ? (
                <p style={{ fontSize: 11, color: "var(--danger, #b91c1c)" }}>
                  Select at least one program.
                </p>
              ) : null}
            </div>
          ) : null}

          {(draftAll ? primaryChoices.length : draftSelected.size) > 1 ? (
            <div style={{ marginTop: 8 }}>
              <label style={{ fontSize: 11, color: "var(--t2)" }}>Primary</label>
              <select
                value={draftPrimary}
                onChange={(e) => setDraftPrimary(e.target.value)}
                className="pol-select"
                style={{ width: "100%", marginTop: 2 }}
              >
                <option value="">— Default —</option>
                {primaryChoices.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 6, marginTop: 10 }}>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="pol-btn pol-btn-ghost pol-btn-sm"
              disabled={applying}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={apply}
              className="pol-btn pol-btn-primary pol-btn-sm"
              disabled={applying || (!draftAll && draftSelected.size === 0)}
            >
              {applying ? "Applying…" : "Apply"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
