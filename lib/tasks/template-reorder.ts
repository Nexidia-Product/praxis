/**
 * Reordering helpers for the task-template editor (pure, client-safe).
 * Items are identified by `local_id`, which is stable across reorders, so
 * the editor can key rows (and track expanded state) on it.
 */

export type DropPosition = "before" | "after";

/**
 * Move the item `fromId` next to `overId` (before/after it). With
 * `overId === null`, or when it's the item itself / not found, the item
 * goes to the end. Returns the same array when nothing changes.
 */
export function moveItem<T extends { local_id: string }>(
  items: T[],
  fromId: string,
  overId: string | null,
  position: DropPosition,
): T[] {
  const from = items.findIndex((i) => i.local_id === fromId);
  if (from === -1) return items;
  const moving = items[from];
  const without = items.filter((i) => i.local_id !== fromId);

  let at = without.length;
  if (overId !== null && overId !== fromId) {
    const idx = without.findIndex((i) => i.local_id === overId);
    if (idx !== -1) at = position === "after" ? idx + 1 : idx;
  }

  const next = [...without];
  next.splice(at, 0, moving);
  return next.every((item, i) => item === items[i]) ? items : next;
}

/** Move one item up (-1) or down (+1); no-op at the ends. */
export function moveItemBy<T extends { local_id: string }>(
  items: T[],
  id: string,
  delta: -1 | 1,
): T[] {
  const i = items.findIndex((x) => x.local_id === id);
  const j = i + delta;
  if (i === -1 || j < 0 || j >= items.length) return items;
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
