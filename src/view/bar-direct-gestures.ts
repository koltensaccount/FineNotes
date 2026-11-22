/**
 * Direct press-and-hold gestures on the main toolbar (ported from fork):
 *
 * 1. **Hold any toolbar icon (400 ms) + drag** → reorder it live to any
 *    position in the bar (including across start / middle / end zones),
 *    then persist via `onCommitLayout`.
 * 2. **Hold blank space on the toolbar (400 ms) + drag** → show a live
 *    edge dock preview (top / right / bottom / left) and dock the main
 *    toolbar on release via `onCommitDock`.
 *
 * Includes full iPad Safari / WebKit pointer + touch capture error handling:
 * single-pointer guard, 8 px pre-hold slop cancel, capture-phase touchmove
 * preventDefault once held, safe pointer capture release, contextmenu
 * suppression, and post-drop ghost-click swallowing.
 */

import type { BarDock } from "./bar-dock-model";
import { isBarUpright } from "./bar-dock-model";
import type { BarItemId, ToolbarLayout, Zone } from "./toolbar-layout";

export interface RectBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

/**
 * Determine which edge (`top` / `bottom` / `left` / `right`) the user is
 * dragging the toolbar toward, using the fork's directional intent + edge
 * proximity heuristic. PURE — testable without DOM.
 */
export function computeDockCandidate(
  clientX: number,
  clientY: number,
  hostBox: RectBox,
  currentDock: BarDock,
  startX: number,
  startY: number,
): BarDock {
  const topThreshold = Math.max(100, Math.min(220, hostBox.height * 0.25));
  const bottomThreshold = topThreshold;
  const leftThreshold = Math.max(100, Math.min(220, hostBox.width * 0.25));
  const rightThreshold = leftThreshold;

  const distTop = clientY - hostBox.top;
  const distBottom = hostBox.bottom - clientY;
  const distLeft = clientX - hostBox.left;
  const distRight = hostBox.right - clientX;

  const dx = clientX - startX;
  const dy = clientY - startY;

  if (currentDock === "left") {
    if (dy < -24 || (dy <= 0 && distTop < topThreshold)) return "top";
    if (dy > 24 || (dy >= 0 && distBottom < bottomThreshold)) return "bottom";
    if (dx > 40 && distRight < rightThreshold * 1.5) return "right";
  } else if (currentDock === "right") {
    if (dy < -24 || (dy <= 0 && distTop < topThreshold)) return "top";
    if (dy > 24 || (dy >= 0 && distBottom < bottomThreshold)) return "bottom";
    if (dx < -40 && distLeft < leftThreshold * 1.5) return "left";
  } else if (currentDock === "top") {
    if (dx < -24 || (dx <= 0 && distLeft < leftThreshold)) return "left";
    if (dx > 24 || (dx >= 0 && distRight < rightThreshold)) return "right";
    if (dy > 40 && distBottom < bottomThreshold * 1.5) return "bottom";
  } else if (currentDock === "bottom") {
    if (dx < -24 || (dx <= 0 && distLeft < leftThreshold)) return "left";
    if (dx > 24 || (dx >= 0 && distRight < rightThreshold)) return "right";
    if (dy < -40 && distTop < topThreshold * 1.5) return "top";
  }

  const normTop = distTop / Math.max(1, hostBox.height);
  const normBottom = distBottom / Math.max(1, hostBox.height);
  const normLeft = distLeft / Math.max(1, hostBox.width);
  const normRight = distRight / Math.max(1, hostBox.width);
  const min = Math.min(normTop, normBottom, normLeft, normRight);
  if (min === normTop) return "top";
  if (min === normBottom) return "bottom";
  if (min === normLeft) return "left";
  return "right";
}

export interface DirectBarGesturesHost {
  host: HTMLElement;
  barEl: HTMLElement;
  zones: () => Record<Zone, HTMLElement>;
  barDock: () => BarDock;
  layout: () => ToolbarLayout;
  isEditing: () => boolean;
  onCommitLayout?: (layout: ToolbarLayout) => void;
  onCommitDock?: (dock: BarDock) => void;
}

const HOLD_MS = 400;
const PRE_HOLD_SLOP_PX = 8;
const DRAG_START_PX = 6;
const SWALLOW_CLICK_MS = 450;

function vibrate(): void {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(25);
    } catch {}
  }
}

/**
 * Bind direct press-and-hold icon reordering and blank-space bar docking onto
 * `barEl`. Returns a cleanup disposer.
 */
export function bindDirectBarGestures(ctx: DirectBarGesturesHost): () => void {
  const { barEl, host } = ctx;
  const doc = barEl.ownerDocument;
  const win = doc.defaultView ?? window;

  let activePointerId: number | null = null;
  let activeTouchId: number | null = null;
  let mode: "icon" | "dock" | null = null;
  let holdTimer: number | null = null;
  let holdTriggered = false;
  let hasDragged = false;
  let startX = 0;
  let startY = 0;
  let draggedButton: HTMLButtonElement | null = null;
  let dockPreview: HTMLElement | null = null;
  let candidateDock: BarDock = ctx.barDock();
  let swallowClickUntil = 0;

  const updateDockPreview = (el: HTMLElement, dock: BarDock): void => {
    el.removeClass("is-dock-top", "is-dock-bottom", "is-dock-left", "is-dock-right");
    el.addClass(`is-dock-${dock}`);
  };

  const cleanupActive = (): void => {
    if (holdTimer !== null) {
      win.clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (dockPreview) {
      dockPreview.remove();
      dockPreview = null;
    }
    if (draggedButton) {
      draggedButton.removeClass("is-drag-held", "is-dragging");
    }
    barEl.removeClass("is-bar-held", "is-reordering");
    barEl.style.overflow = "";
    barEl.style.touchAction = "";
    if (activePointerId !== null) {
      try {
        if (barEl.hasPointerCapture(activePointerId)) barEl.releasePointerCapture(activePointerId);
      } catch {}
      if (draggedButton) {
        try {
          if (draggedButton.hasPointerCapture(activePointerId)) {
            draggedButton.releasePointerCapture(activePointerId);
          }
        } catch {}
      }
    }
    doc.removeEventListener("pointermove", onDocMove);
    doc.removeEventListener("pointerup", onDocUp);
    doc.removeEventListener("pointercancel", onDocCancel);
    doc.removeEventListener("touchstart", onTouchStart, true);
    doc.removeEventListener("touchmove", onTouchMove, true);
    activePointerId = null;
    activeTouchId = null;
    mode = null;
    holdTriggered = false;
    hasDragged = false;
    draggedButton = null;
  };

  const reorderIconAt = (clientX: number, clientY: number, btn: HTMLButtonElement): void => {
    const zones = ctx.zones();
    const vertical = isBarUpright(ctx.barDock());
    const coord = vertical ? clientY : clientX;

    // Pick the zone closest to the pointer along the bar's main axis.
    let targetZone: HTMLElement = btn.parentElement ?? zones.middle;
    let bestDist = Infinity;
    for (const z of [zones.start, zones.middle, zones.end]) {
      const r = z.getBoundingClientRect();
      const lo = vertical ? r.top : r.left;
      const hi = vertical ? r.bottom : r.right;
      const d = coord < lo ? lo - coord : coord > hi ? coord - hi : 0;
      if (d < bestDist) {
        bestDist = d;
        targetZone = z;
      }
    }

    const siblings = (Array.from(targetZone.children) as HTMLElement[]).filter(
      (el) => el !== btn && el.tagName === "BUTTON" && el.hasAttribute("data-item") && !el.hasClass("is-overflowed"),
    );

    let before: HTMLElement | null = null;
    for (const sib of siblings) {
      const rect = sib.getBoundingClientRect();
      const mid = vertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
      if (coord < mid) {
        before = sib;
        break;
      }
    }

    if (before) {
      if (btn.parentElement !== targetZone || btn.nextElementSibling !== before) {
        targetZone.insertBefore(btn, before);
      }
    } else if (btn.parentElement !== targetZone || targetZone.lastElementChild !== btn) {
      targetZone.appendChild(btn);
    }
  };

  const commitLayoutFromDom = (): void => {
    if (!ctx.onCommitLayout) return;
    const prev = ctx.layout();
    const zones = ctx.zones();
    const readZone = (el: HTMLElement): BarItemId[] => {
      const out: BarItemId[] = [];
      for (const child of Array.from(el.children)) {
        const id = (child as HTMLElement).getAttribute("data-item") as BarItemId | null;
        if (id && !out.includes(id)) out.push(id);
      }
      return out;
    };
    const next: ToolbarLayout = {
      start: readZone(zones.start),
      middle: readZone(zones.middle),
      end: readZone(zones.end),
      off: [...prev.off],
    };
    ctx.onCommitLayout(next);
  };

  const onTouchStart = (e: TouchEvent): void => {
    if (activePointerId === null || activeTouchId !== null) return;
    const touch = Array.from(e.changedTouches).find(
      (t) => Math.abs(t.clientX - startX) < 16 && Math.abs(t.clientY - startY) < 16,
    );
    if (touch) activeTouchId = touch.identifier;
  };

  const onTouchMove = (e: TouchEvent): void => {
    if (
      holdTriggered &&
      activePointerId !== null &&
      activeTouchId !== null &&
      Array.from(e.changedTouches).some((t) => t.identifier === activeTouchId) &&
      e.cancelable
    ) {
      e.preventDefault();
    }
  };

  const onDocMove = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (!holdTriggered) {
      if (dist > PRE_HOLD_SLOP_PX && holdTimer !== null) {
        win.clearTimeout(holdTimer);
        holdTimer = null;
      }
      return;
    }
    if (e.cancelable) e.preventDefault();

    if (mode === "dock") {
      candidateDock = computeDockCandidate(
        e.clientX,
        e.clientY,
        host.getBoundingClientRect(),
        ctx.barDock(),
        startX,
        startY,
      );
      if (dockPreview) updateDockPreview(dockPreview, candidateDock);
    } else if (mode === "icon" && draggedButton) {
      if (dist > DRAG_START_PX) hasDragged = true;
      if (hasDragged) {
        draggedButton.addClass("is-dragging");
        reorderIconAt(e.clientX, e.clientY, draggedButton);
      }
    }
  };

  const onDocUp = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    const wasHeld = holdTriggered;
    const wasMode = mode;
    const didDrag = hasDragged;
    const nextDock = candidateDock;
    cleanupActive();

    if (!wasHeld) return;
    swallowClickUntil = Date.now() + SWALLOW_CLICK_MS;

    if (wasMode === "dock") {
      if (nextDock !== ctx.barDock()) ctx.onCommitDock?.(nextDock);
    } else if (wasMode === "icon" && didDrag) {
      commitLayoutFromDom();
    }
  };

  const onDocCancel = (e: PointerEvent): void => {
    if (e.pointerId !== activePointerId) return;
    const wasHeld = holdTriggered;
    const wasMode = mode;
    const didDrag = hasDragged;
    cleanupActive();
    if (wasHeld) swallowClickUntil = Date.now() + SWALLOW_CLICK_MS;
    if (wasHeld && wasMode === "icon" && didDrag) commitLayoutFromDom();
  };

  const onPointerDown = (e: PointerEvent): void => {
    if (e.button !== 0 || e.isPrimary === false) return;
    if (activePointerId !== null || ctx.isEditing()) return;

    const target = e.target as Element | null;
    const button = target?.closest<HTMLButtonElement>("button[data-item]") ?? null;
    const interactive = target?.closest("button, input, select, textarea, [role='button']");

    if (button && barEl.contains(button) && ctx.onCommitLayout) {
      mode = "icon";
      draggedButton = button;
    } else if (!interactive && ctx.onCommitDock) {
      mode = "dock";
      candidateDock = ctx.barDock();
    } else {
      return;
    }

    activePointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    holdTriggered = false;
    hasDragged = false;

    holdTimer = win.setTimeout(() => {
      holdTimer = null;
      holdTriggered = true;
      vibrate();
      barEl.style.touchAction = "none";
      if (mode === "dock") {
        barEl.addClass("is-bar-held");
        barEl.style.overflow = "hidden";
        if (activePointerId !== null) {
          try {
            barEl.setPointerCapture(activePointerId);
          } catch {}
        }
        dockPreview = host.createDiv({ cls: "goodobsidian-dock-preview" });
        updateDockPreview(dockPreview, candidateDock);
      } else if (mode === "icon" && draggedButton) {
        barEl.addClass("is-reordering");
        draggedButton.addClass("is-drag-held");
        if (activePointerId !== null) {
          try {
            draggedButton.setPointerCapture(activePointerId);
          } catch {}
        }
      }
    }, HOLD_MS);

    doc.addEventListener("pointermove", onDocMove);
    doc.addEventListener("pointerup", onDocUp);
    doc.addEventListener("pointercancel", onDocCancel);
    doc.addEventListener("touchstart", onTouchStart, true);
    doc.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
  };

  const onContextMenu = (e: MouseEvent): void => {
    if (holdTriggered || holdTimer !== null) e.preventDefault();
  };

  const onClickCapture = (e: MouseEvent): void => {
    if (Date.now() < swallowClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  barEl.addEventListener("pointerdown", onPointerDown);
  barEl.addEventListener("contextmenu", onContextMenu);
  barEl.addEventListener("click", onClickCapture, true);

  return () => {
    cleanupActive();
    barEl.removeEventListener("pointerdown", onPointerDown);
    barEl.removeEventListener("contextmenu", onContextMenu);
    barEl.removeEventListener("click", onClickCapture, true);
  };
}
