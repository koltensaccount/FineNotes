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
  let disposed = false;
  const down = (event: PointerEvent): void => {
    const target = event.target;
    const control =
      target instanceof Element &&
      !!target.closest(
        "button, input, textarea, select, [contenteditable], [role=menu], [role=toolbar], .goodobsidian-image-ui, .goodobsidian-crop-ui, .goodobsidian-selection-ui",
      );
    if (control || !element.contains(target as Node) || callbacks.blocked()) {
      gesture.reset(); // Sidebar/control contacts never enter canvas pointer tracking.
      return;
    }
    gesture.down(event);
  };
  const move = (event: PointerEvent): void => gesture.move(event);
  const handledUps = new WeakSet<Event>();
  const up = (event: PointerEvent): void => {
    handledUps.add(event);
    gesture.up(event);
  };
  const captureUp = (event: PointerEvent): void => {
    // Prefer normal bubbling after pan/pinch ends. A control may stop that bubble;
    // its captured terminal event still gets cleanup at the end of this dispatch.
    queueMicrotask(() => {
      if (!disposed && !handledUps.has(event)) up(event);
    });
  };
  const cancel = (event: PointerEvent): void => gesture.cancel(event);
  const reset = (): void => gesture.reset();
  const visibility = (): void => {
    if (doc.visibilityState === "hidden") reset();
  };
  // Down is captured so controls/outside contacts invalidate a pending chord.
  // Up runs after the page controller has finished the gesture, before history changes.
  doc.addEventListener("pointerdown", down, { capture: true });
  doc.addEventListener("pointermove", move, { capture: true });
  doc.addEventListener("pointerup", captureUp, { capture: true });
  doc.addEventListener("pointerup", up);
  doc.addEventListener("pointercancel", cancel, { capture: true });
  doc.addEventListener("visibilitychange", visibility);
  win?.addEventListener("blur", reset);
  const dispose = (): void => {
    disposed = true;
    reset();
    doc.removeEventListener("pointerdown", down, { capture: true });
    doc.removeEventListener("pointermove", move, { capture: true });
    doc.removeEventListener("pointerup", captureUp, { capture: true });
    doc.removeEventListener("pointerup", up);
    doc.removeEventListener("pointercancel", cancel, { capture: true });
    doc.removeEventListener("visibilitychange", visibility);
    win?.removeEventListener("blur", reset);
  };
  return { dispose, reset };
}
