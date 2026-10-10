/** Command palettes can move focus; diagnostic reports follow actual drawing activity. */
export function diagnosticView<T extends { readonly lastDrawingAt: number }>(active: T | null, views: readonly T[]): T | null {
  let chosen = active ?? views[0] ?? null;
  for (const view of views) if (view.lastDrawingAt > (chosen?.lastDrawingAt ?? 0)) chosen = view;
  return chosen;
}
