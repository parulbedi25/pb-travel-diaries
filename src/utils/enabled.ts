/**
 * True unless an item has been explicitly switched off.
 * Older saved content has no `enabled` flag on its items, so it stays visible.
 */
export function isOn<T>(item: T): boolean {
  return (item as unknown as { enabled?: boolean } | null)?.enabled !== false;
}
