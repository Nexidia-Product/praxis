"use client";

/**
 * "Use case outcomes supported" picker for the project form.
 *
 * Lists the outcomes of the use case the project belongs to as checkboxes.
 * Disabled (with a note) when the project isn't in a use case — membership
 * is managed from Admin → Use cases, not here. The picks are stored on the
 * project as outcome ids (`Project.use_case_outcome_ids`).
 */

import type { UseCase } from "@/lib/db";

interface Props {
  /** The project's use case, or null when it belongs to none. */
  useCase: UseCase | null;
  /** Selected outcome ids. */
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}

export function UseCaseOutcomesPicker({ useCase, value, onChange, disabled }: Props) {
  const outcomes = useCase?.outcomes ?? [];
  const selected = new Set(value);

  function toggle(id: string, checked: boolean) {
    onChange(checked ? [...value, id] : value.filter((v) => v !== id));
  }

  return (
    <fieldset
      disabled={disabled || !useCase}
      className="space-y-2 rounded-md border border-gray-200 bg-gray-50 p-4"
    >
      {/* The legend names the group for assistive tech; the visible title
          is a heading inside the box, matching the neighbouring sections
          (a visible <legend> would straddle the border). */}
      <legend className="sr-only">Use case outcomes supported</legend>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
        Use case outcomes supported
        {useCase && outcomes.length > 0 ? (
          <span className="ml-1 font-normal normal-case tracking-normal text-gray-500">
            ({value.filter((id) => outcomes.some((o) => o.id === id)).length} of{" "}
            {outcomes.length})
          </span>
        ) : null}
      </h3>

      {!useCase ? (
        <p className="text-xs italic text-gray-500">
          This project isn&apos;t in a use case, so there are no outcomes to select.
          Add it to a use case under Admin → Use cases first.
        </p>
      ) : outcomes.length === 0 ? (
        <p className="text-xs italic text-gray-500">
          The use case “{useCase.name}” has no outcomes yet. Define them under
          Admin → Use cases.
        </p>
      ) : (
        <>
          <p className="text-xs text-gray-500">
            Which outcomes of “{useCase.name}” does this project support?
          </p>
          <ul className="space-y-1">
            {outcomes.map((o) => (
              <li key={o.id}>
                <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={selected.has(o.id)}
                    onChange={(e) => toggle(o.id, e.target.checked)}
                    className="mt-0.5 h-3.5 w-3.5 shrink-0"
                  />
                  <span>{o.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </>
      )}
    </fieldset>
  );
}
