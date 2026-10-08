/** Sidebar-owned hold/drag. Never captures or mutates canvas input state. */
export function bindPageSidebarDrag(
  frame: HTMLElement,
  panel: HTMLElement,
  options: {
    id: () => string | undefined;
    selected: () => ReadonlySet<string>;
    rows: () => { id: string; el: HTMLElement; index: number }[];
    total: () => number;
    enabled: () => boolean;
    move: (ids: string[], gap: number) => void;
  },
): { dispose: () => void; cancel: () => void; suppressClick: () => boolean } {
  const doc = frame.ownerDocument,
    win = doc.defaultView!;
  let pointer: { id: number; type: string; x: number; y: number; lastY: number } | null = null;
  let timer = 0,
    raf = 0,
    active = false,
    suppressed = false,
    gap = 0,
    y = 0,
    x = 0;
  let ids: string[] = [],
    ghost: HTMLElement | null = null,
    line: HTMLElement | null = null;
  const finish = (): void => {
    win.clearTimeout(timer);
    win.cancelAnimationFrame(raf);
    timer = raf = 0;
    if (pointer && frame.hasPointerCapture(pointer.id)) frame.releasePointerCapture(pointer.id);
    pointer = null;
    active = false;
    ghost?.remove();
    line?.remove();
    ghost = line = null;
    frame.removeClass("is-page-dragging");
    doc.removeEventListener("pointermove", move, true);
    doc.removeEventListener("pointerup", up, true);
    doc.removeEventListener("pointercancel", pointerCanceled, true);
    doc.removeEventListener("pointerdown", foreignDown, true);
  };
  const indicator = (): void => {
    const rows = options.rows().filter((row) => !row.el.hasClass("is-hidden"));
    let target = rows.find((row) => y < row.el.getBoundingClientRect().bottom);
    if (target) {
      const box = target.el.getBoundingClientRect();
      const sameRow = rows.filter(
        (row) => Math.abs(row.el.getBoundingClientRect().top - box.top) < 5,
      );
      target =
        sameRow.find((row) => x < row.el.getBoundingClientRect().right) ??
        sameRow[sameRow.length - 1];
    }
    const box = target?.el.getBoundingClientRect();
    const after = !box || y >= box.top + box.height / 2;
    gap = target ? target.index + (after ? 1 : 0) : options.total();
    const panelBox = panel.getBoundingClientRect();
    line?.setCssStyles({
      top: `${(box ? (after ? box.bottom : box.top) : panelBox.bottom) - panelBox.top + panel.scrollTop}px`,
      left: `${box ? box.left - panelBox.left : 12}px`,
      width: `${box?.width ?? panelBox.width - 24}px`,
    });
    ghost?.setCssStyles({ left: `${x + 12}px`, top: `${y - 24}px` });
  };
  const scroll = (): void => {
    if (!active) return;
    const box = panel.getBoundingClientRect();
    const delta = y < box.top + 44 ? -7 : y > box.bottom - 44 ? 7 : 0;
    if (delta) {
      panel.scrollTop += delta;
      indicator();
    }
    raf = win.requestAnimationFrame(scroll);
  };
  const move = (event: PointerEvent): void => {
    if (!pointer || event.pointerId !== pointer.id) return;
    x = event.clientX;
    y = event.clientY;
    if (active) {
      event.preventDefault();
      indicator();
    } else if (Math.hypot(x - pointer.x, y - pointer.y) > 8) {
      suppressed = true;
      win.clearTimeout(timer);
      if (pointer.type === "touch") {
        event.preventDefault();
        panel.scrollTop += pointer.lastY - y;
      }
    }
    pointer.lastY = y;
  };
  const up = (event: PointerEvent): void => {
    if (!pointer || event.pointerId !== pointer.id) return;
    const drop = active,
      selected = ids,
      destination = gap;
    finish();
    if (drop) options.move(selected, destination);
  };
  const cancel = (): void => {
    suppressed = true;
    finish();
  };
  const pointerCanceled = (event: PointerEvent): void => {
    if (pointer?.id === event.pointerId) cancel();
  };
  const foreignDown = (event: PointerEvent): void => {
    if (pointer && event.pointerId !== pointer.id) cancel();
  };
  const visibility = (): void => {
    if (doc.visibilityState === "hidden") cancel();
  };
  const down = (event: PointerEvent): void => {
    if (
      !options.enabled() ||
      event.button !== 0 ||
      event.pointerType === "pen" ||
      (event.target as Element)?.closest(".goodobsidian-thumb-ribbon")
    )
      return;
    finish();
    suppressed = false;
    pointer = {
      id: event.pointerId,
      type: event.pointerType,
      x: event.clientX,
      y: event.clientY,
      lastY: event.clientY,
    };
    x = event.clientX;
    y = event.clientY;
    doc.addEventListener("pointermove", move, { capture: true, passive: false });
    doc.addEventListener("pointerdown", foreignDown, true);
    doc.addEventListener("pointerup", up, true);
    doc.addEventListener("pointercancel", pointerCanceled, true);
    timer = win.setTimeout(() => {
      const id = options.id();
      if (!pointer || !id) return;
      ids = options.selected().has(id) ? [...options.selected()] : [id];
      active = suppressed = true;
      try {
        frame.setPointerCapture(pointer.id);
      } catch {
        cancel();
        return;
      }
      frame.addClass("is-page-dragging");
      ghost = doc.body.createDiv({
        cls: "goodobsidian-page-drag-ghost",
        text: ids.length > 1 ? `${ids.length} pages` : "Move page",
      });
      line = panel.createDiv({ cls: "goodobsidian-page-insertion-line" });
      indicator();
      scroll();
    }, 350);
  };
  const click = (event: MouseEvent): void => {
    if (options.enabled() && suppressed && event.detail !== 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };
  frame.addEventListener("lostpointercapture", pointerCanceled);
  frame.addEventListener("pointerdown", down);
  frame.addEventListener("click", click, true);
  win.addEventListener("blur", cancel);
  doc.addEventListener("visibilitychange", visibility);
  return {
    cancel,
    suppressClick: () => suppressed,
    dispose: () => {
      finish();
      frame.removeEventListener("lostpointercapture", pointerCanceled);
      frame.removeEventListener("pointerdown", down);
      frame.removeEventListener("click", click, true);
      win.removeEventListener("blur", cancel);
      doc.removeEventListener("visibilitychange", visibility);
    },
  };
}
