/** Pointer capture keeps a reorder entirely in the popover, including over paper. */
export function bindPresetDrag(
  handle: HTMLElement,
  row: HTMLElement,
  index: number,
  onDrop: (from: number, to: number) => void,
  onDragging: (active: boolean) => void,
): () => void {
  let pointer: number | null = null;
  let timer: number | undefined;
  let active = false;
  let target = index;
  let x = 0;
  let y = 0;
  const finish = (commit: boolean): void => {
    row.ownerDocument.defaultView?.clearTimeout(timer);
    const shouldDrop = active && commit;
    active = false;
    const captured = pointer;
    pointer = null;
    if (captured !== null && handle.hasPointerCapture(captured))
      handle.releasePointerCapture(captured);
    if (shouldDrop) onDrop(index, target);
    row.removeClass("is-dragging");
    row.parentElement
      ?.querySelectorAll(".is-drop-target")
      .forEach((el) => el.classList.remove("is-drop-target"));
    onDragging(false);
  };
  const down = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (pointer !== null || event.button !== 0) return;
    pointer = event.pointerId;
    x = event.clientX;
    y = event.clientY;
    handle.setPointerCapture(pointer);
    const begin = (): void => {
      active = true;
      row.addClass("is-dragging");
      onDragging(true);
    };
    if (event.pointerType === "touch")
      timer = row.ownerDocument.defaultView?.setTimeout(begin, 350);
    else begin();
  };
  const move = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerId !== pointer) return;
    if (!active) {
      if (Math.hypot(event.clientX - x, event.clientY - y) > 10) finish(false);
      return;
    }
    const hit = row.ownerDocument
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest<HTMLElement>("[data-preset-index]");
    if (hit && hit.parentElement === row.parentElement) {
      target = Number(hit.dataset.presetIndex);
      row.parentElement
        ?.querySelectorAll(".is-drop-target")
        .forEach((el) => el.classList.remove("is-drop-target"));
      hit.addClass("is-drop-target");
    }
    const parent = row.parentElement;
    if (parent) {
      const box = parent.getBoundingClientRect();
      if (event.clientY < box.top + 44) parent.scrollTop -= 12;
      if (event.clientY > box.bottom - 44) parent.scrollTop += 12;
    }
  };
  const up = (event: PointerEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    if (event.pointerId === pointer) finish(true);
  };
  const cancel = (): void => finish(false);
  const visibility = (): void => {
    if (row.ownerDocument.visibilityState === "hidden") finish(false);
  };
  row.ownerDocument.addEventListener("visibilitychange", visibility);
  row.ownerDocument.defaultView?.addEventListener("blur", cancel);
  const click = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
  };
  const key = (event: KeyboardEvent): void => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onDrop(index, index + (event.key === "ArrowUp" ? -1 : 1));
  };
  handle.addEventListener("pointerdown", down);
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", cancel);
  handle.addEventListener("lostpointercapture", cancel);
  handle.addEventListener("click", click);
  handle.addEventListener("keydown", key);
  return () => {
    row.ownerDocument.removeEventListener("visibilitychange", visibility);
    row.ownerDocument.defaultView?.removeEventListener("blur", cancel);
    handle.removeEventListener("lostpointercapture", cancel);
    finish(false);
    handle.removeEventListener("pointerdown", down);
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", cancel);
    handle.removeEventListener("click", click);
    handle.removeEventListener("keydown", key);
  };
}
