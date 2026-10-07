/** Touch-only context hold; never captures or prevents a pan/pinch or Pencil stroke. */
export function bindContextInput(
  element: HTMLElement,
  callbacks: {
    blocked: () => boolean;
    remember: (x: number, y: number) => void;
    open: (x: number, y: number) => void;
  },
): () => void {
  const doc = element.ownerDocument;
  const win = doc.defaultView ?? window;
  let timer: number | undefined;
  let pending: { id: number; x: number; y: number } | null = null;
  const touches = new Set<number>();
  let lastType = "";
  const cancel = (): void => {
    win.clearTimeout(timer);
    timer = undefined;
    pending = null;
  };
  const controls = (target: EventTarget | null): boolean =>
    target instanceof Element &&
    !!target.closest(
      "button, input, textarea, [contenteditable], [role=menu], [role=toolbar], .goodobsidian-image-ui, .goodobsidian-selection-ui, .goodobsidian-crop-ui",
    );
  const down = (event: PointerEvent): void => {
    lastType = event.pointerType;
    cancel();
    if (event.pointerType === "touch") touches.add(event.pointerId);
    if (!element.contains(event.target as Node) || controls(event.target)) return;
    callbacks.remember(event.clientX, event.clientY);
    if (event.pointerType !== "touch" || touches.size !== 1 || callbacks.blocked()) return;
    pending = { id: event.pointerId, x: event.clientX, y: event.clientY };
    timer = win.setTimeout(() => {
      const hold = pending;
      cancel();
      if (hold && touches.size === 1 && !callbacks.blocked()) callbacks.open(hold.x, hold.y);
    }, 500);
  };
  const move = (event: PointerEvent): void => {
    if (
      pending?.id === event.pointerId &&
      Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > 8
    )
      cancel();
  };
  const up = (event: PointerEvent): void => {
    touches.delete(event.pointerId);
    if (pending?.id === event.pointerId) cancel();
  };
  const reset = (): void => {
    cancel();
    touches.clear();
  };
  const visibility = (): void => {
    if (doc.visibilityState === "hidden") reset();
  };
  const context = (event: MouseEvent): void => {
    const type = (event as PointerEvent).pointerType || lastType;
    if (type === "pen" || type === "touch" || controls(event.target) || callbacks.blocked()) return;
    event.preventDefault();
    cancel();
    callbacks.open(event.clientX, event.clientY);
  };
  doc.addEventListener("pointerdown", down, { capture: true });
  doc.addEventListener("pointermove", move, { capture: true });
  doc.addEventListener("pointerup", up, { capture: true });
  doc.addEventListener("pointercancel", up, { capture: true });
  doc.addEventListener("visibilitychange", visibility);
  win?.addEventListener("blur", reset);
  element.addEventListener("contextmenu", context);
  return () => {
    reset();
    doc.removeEventListener("pointerdown", down, { capture: true });
    doc.removeEventListener("pointermove", move, { capture: true });
    doc.removeEventListener("pointerup", up, { capture: true });
    doc.removeEventListener("pointercancel", up, { capture: true });
    doc.removeEventListener("visibilitychange", visibility);
    win?.removeEventListener("blur", reset);
    element.removeEventListener("contextmenu", context);
  };
}

/** Dismiss only the transient press UI; leave the outside pointer action untouched. */
export function bindPressDismissal(
  menu: HTMLElement,
  isOpen: () => boolean,
  dismiss: () => void,
): () => void {
  const doc = menu.ownerDocument;
  const outside = (event: Event): void => {
    if (
      isOpen() &&
      !event
        .composedPath()
        .some((node) => node === menu || (node instanceof Node && menu.contains(node)))
    )
      dismiss();
  };
  const click = (event: MouseEvent): void => {
    if (event.detail === 0) outside(event); // Keyboard popup activation; never the held finger's release click.
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key === "Escape" && isOpen()) dismiss();
  };
  doc.addEventListener("pointerdown", outside, { capture: true });
  doc.addEventListener("click", click, { capture: true });
  doc.addEventListener("keydown", key, { capture: true });
  return () => {
    doc.removeEventListener("pointerdown", outside, { capture: true });
    doc.removeEventListener("click", click, { capture: true });
    doc.removeEventListener("keydown", key, { capture: true });
  };
}
