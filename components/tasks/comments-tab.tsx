"use client";

/**
 * Read-only rendering of a task's Comments field and its edit history.
 * Extracted out of `form-modal.tsx` so the new `TaskQuickView`
 * (`components/tasks/quick-view.tsx`) can reuse it without duplicating
 * the history-rendering logic.
 *
 * New comments are added via the mention-aware textarea on the form
 * modal's Details tab; this component is the audit-trail view of past
 * edits, mirroring the project panel's Status tab pattern.
 *
 * The current `comments` value is shown as the "current" entry at
 * the top so users can see the latest text without scrolling through
 * history. Synthetic, not stored.
 */

import type { Task, TaskCommentEntry } from "@/lib/db";

export function CommentsTab({ task }: { task: Task }) {
  const historyNewestFirst = [...task.comment_history].reverse();

  return (
    <>
      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Current comment
        </p>
        <div className="mt-2 whitespace-pre-wrap rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
          {task.comments || (
            <span className="text-gray-400">— no comment —</span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-gray-500">
          Edit the comment field on the Details tab. Saving appends an
          entry to the history below.
        </p>
      </section>

      <section>
        <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
          History
        </h3>
        {historyNewestFirst.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">
            No comment edits recorded yet. Saving a change to the
            Comments field will create the first entry.
          </p>
        ) : (
          <ol className="mt-2 divide-y divide-gray-100 border-y border-gray-100">
            {historyNewestFirst.map((entry, i) => (
              <CommentHistoryRow key={i} entry={entry} />
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function CommentHistoryRow({ entry }: { entry: TaskCommentEntry }) {
  const when = new Date(entry.changed_at);
  const display = Number.isNaN(when.getTime())
    ? entry.changed_at
    : when.toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
  return (
    <li className="py-2.5 text-sm">
      <div className="text-xs text-gray-500">
        {entry.changed_by_name ? (
          <>
            by{" "}
            <span className="font-medium text-gray-700">
              {entry.changed_by_name}
            </span>
            {" · "}
          </>
        ) : entry.changed_by ? (
          <>
            by{" "}
            <span className="font-mono text-gray-600">{entry.changed_by}</span>
            {" · "}
          </>
        ) : (
          <>by system · </>
        )}
        <time dateTime={entry.changed_at} title={entry.changed_at}>
          {display}
        </time>
      </div>
      <p className="mt-1 whitespace-pre-wrap rounded-md border border-gray-100 bg-gray-50 px-2.5 py-1.5 text-sm text-gray-700">
        {entry.text || (
          <span className="text-gray-400">— cleared —</span>
        )}
      </p>
      {/* Show "previously" only when it's meaningful — first entry
          has previous_text === null and a redundant "previously: —"
          row would just be noise. */}
      {entry.previous_text !== null && entry.previous_text !== "" ? (
        <p className="mt-1 whitespace-pre-wrap text-xs text-gray-500">
          <span className="uppercase tracking-wider">Previously:</span>{" "}
          <span className="text-gray-600">{entry.previous_text}</span>
        </p>
      ) : null}
    </li>
  );
}
