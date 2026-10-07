/** Bounded writing popovers; above the anchor when the lower space is too short. */
export function writingPopoverFit(
  host: { top: number; bottom: number; width: number },
  anchor: { top: number; bottom: number },
): { top: number; maxHeight: number; maxWidth: number; above: boolean } {
  const below = Math.max(0, host.bottom - anchor.bottom - 16);
  const upper = Math.max(0, anchor.top - host.top - 16);
  const above = below < 240 && upper > below;
  return {
    top: above ? anchor.top - host.top - 8 : anchor.bottom - host.top + 8,
    maxHeight: above ? upper : below,
    maxWidth: Math.max(0, host.width - 16),
    above,
  };
}
