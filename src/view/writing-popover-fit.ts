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

export interface PopoverRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** All coordinates are viewport coordinates; callers convert only at the DOM boundary. */
export function fitPopover(
  visible: PopoverRect,
  anchor: PopoverRect,
  size: { width: number; height: number },
  dock: "top" | "bottom" | "left" | "right" = "top",
): { left: number; top: number; maxWidth: number; maxHeight: number } {
  const gap = 8;
  const fullWidth = Math.max(0, visible.right - visible.left);
  const fullHeight = Math.max(0, visible.bottom - visible.top);
  let left = visible.left, right = visible.right, top = visible.top, bottom = visible.bottom;
  if (dock === "left" || dock === "right") {
    const available = dock === "left" ? visible.right - anchor.right - gap : anchor.left - gap - visible.left;
    // A side-docked toolbar must not squeeze its menu to an unusable sliver.
    if (available >= Math.min(240, fullWidth)) {
      if (dock === "left") left = Math.max(left, anchor.right + gap);
      else right = Math.min(right, anchor.left - gap);
    }
  } else {
    const below = Math.max(0, visible.bottom - Math.max(visible.top, anchor.bottom + gap));
    const above = Math.max(0, Math.min(visible.bottom, anchor.top - gap) - visible.top);
    const useAbove = dock === "bottom" ? above >= Math.min(size.height, below) : size.height > below && above > below;
    // When the keyboard covers the anchor or both sides are too short, use the
    // visible area instead of placing content outside it or making a zero-height menu.
    if (Math.max(above, below) >= Math.min(160, fullHeight)) {
      if (useAbove) bottom = Math.min(bottom, anchor.top - gap);
      else top = Math.max(top, anchor.bottom + gap);
    }
  }
  const maxWidth = Math.max(0, right - left), maxHeight = Math.max(0, bottom - top);
  const width = Math.min(size.width, maxWidth), height = Math.min(size.height, maxHeight);
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  return {
    left: dock === "left" ? left : dock === "right" ? right - width : clamp((anchor.left + anchor.right - width) / 2, left, right - width),
    top: dock === "left" || dock === "right" ? clamp(anchor.top, top, bottom - height) :
      bottom < visible.bottom ? bottom - height : top,
    maxWidth, maxHeight,
  };
}
