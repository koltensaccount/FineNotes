import { MultiTouchDoubleTap } from "../input/multitouch-double-tap";

/** Observe pointers without capture/prevention; the existing controller still owns pan/pinch. */
export function bindMultiTouchInput(
  element: HTMLElement,
  callbacks: {
    undo: () => void;
    redo: () => void;
    blocked: () => boolean;
  },
): { dispose: () => void; reset: () => void } {
  const doc = element.ownerDocument;
  const win = doc.defaultView;
  const gesture = new MultiTouchDoubleTap((action) => {
    if (!callbacks.blocked()) callbacks[action]();
  });
  const down = (event: PointerEvent): void => {
    const target = event.target;
    const control =
      target instanceof Element &&
      !!target.closest(
        "button, input, textarea, select, [contenteditable], [role=menu], [role=toolbar], .goodobsidian-image-ui, .goodobsidian-crop-ui, .goodobsidian-selection-ui",
      );
    gesture.down(event, !control && element.contains(target as Node) && !callbacks.blocked());
  };
  const move = (event: PointerEvent): void => gesture.move(event);
  const up = (event: PointerEvent): void => gesture.up(event);
  const cancel = (event: PointerEvent): void => gesture.cancel(event);
  const reset = (): void => gesture.reset();
  const visibility = (): void => {
    if (doc.visibilityState === "hidden") reset();
  };
  // Down is captured so controls/outside contacts invalidate a pending chord.
  // Up runs after the page controller has finished the gesture, before history changes.
  doc.addEventListener("pointerdown", down, { capture: true });
  doc.addEventListener("pointermove", move);
  doc.addEventListener("pointerup", up);
  doc.addEventListener("pointercancel", cancel, { capture: true });
  doc.addEventListener("visibilitychange", visibility);
  win?.addEventListener("blur", reset);
  const dispose = (): void => {
    reset();
    doc.removeEventListener("pointerdown", down, { capture: true });
    doc.removeEventListener("pointermove", move);
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", cancel, { capture: true });
    doc.removeEventListener("visibilitychange", visibility);
    win?.removeEventListener("blur", reset);
  };
  return { dispose, reset };
}
