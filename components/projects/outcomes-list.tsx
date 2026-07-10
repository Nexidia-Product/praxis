/**
 * Read-only outcomes list for compact project cards (Key Capabilities,
 * Work in Progress). Renders an "Outcome(s):" header with one outcome
 * per row; product / type tags follow the text muted on the same row.
 * Renders nothing when the project has no outcomes.
 */

import type { ProjectOutcome } from "@/lib/db";

export function OutcomesList({ outcomes }: { outcomes: ProjectOutcome[] }) {
  if (!outcomes || outcomes.length === 0) return null;
  return (
    <div className="text-[11px] leading-snug">
      <span className="font-semibold text-gray-500">Outcome(s):</span>
      <ul className="mt-0.5 space-y-0.5">
        {outcomes.map((o) => {
          const tags = [o.product, o.type].filter(Boolean).join(" · ");
          return (
            <li key={o.id} className="text-gray-600">
              {o.text}
              {tags ? <span className="text-gray-400"> ({tags})</span> : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
