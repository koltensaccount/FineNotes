/** Native horizontal pan stays native; a moved/cancelled touch never selects a swatch. */
export function bindColorStripInput(
  button: HTMLElement,
  strip: HTMLElement,
  select: () => void,
  context: () => void,
): () => void {
  let pointer: number | null = null;
  let x = 0,
    y = 0,
    suppressed = false;
  let timer: number | undefined;
  const win = button.ownerDocument.defaultView;
  const clear = (): void => {
    win?.clearTimeout(timer);
    timer = undefined;
  };
  const cancel = (): void => {
    clear();
    pointer = null;
    suppressed = true;
  };
  const down = (e: PointerEvent): void => {
    clear();
    pointer = e.pointerId;
    x = e.clientX;
    y = e.clientY;
    suppressed = false;
    if (e.pointerType === "touch" && e.button === 0)
      timer = win?.setTimeout(() => {
        suppressed = true;
        pointer = null;
        context();
      }, 450);
  };
  const move = (e: PointerEvent): void => {
    if (e.pointerId === pointer && Math.hypot(e.clientX - x, e.clientY - y) > 8) cancel();
  };
  const up = (e: PointerEvent): void => {
    if (e.pointerId === pointer) {
      clear();
      pointer = null;
    }
  };
  const click = (e: MouseEvent): void => {
    if (suppressed && e.detail !== 0) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    select();
  };
  const menu = (e: MouseEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    cancel();
    if ((e as PointerEvent).pointerType !== "pen") context();
  };
  const hidden = (): void => {
    if (button.ownerDocument.visibilityState === "hidden") cancel();
  };
  button.addEventListener("pointerdown", down);
  button.addEventListener("pointermove", move);
  button.addEventListener("pointerup", up);
  button.addEventListener("pointercancel", cancel);
  button.addEventListener("contextmenu", menu);
  button.addEventListener("click", click, true);
  strip.addEventListener("scroll", cancel);
  button.ownerDocument.addEventListener("visibilitychange", hidden);
  win?.addEventListener("blur", cancel);
  return () => {
    clear();
    button.removeEventListener("pointerdown", down);
    button.removeEventListener("pointermove", move);
    button.removeEventListener("pointerup", up);
    button.removeEventListener("pointercancel", cancel);
    button.removeEventListener("contextmenu", menu);
    button.removeEventListener("click", click, true);
    strip.removeEventListener("scroll", cancel);
    button.ownerDocument.removeEventListener("visibilitychange", hidden);
    win?.removeEventListener("blur", cancel);
  };
}
