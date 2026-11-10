import { afterEach, describe, expect, it, vi } from "vitest";
import { ReadingPngQueue } from "../../src/view/reading-png";

afterEach(() => vi.useRealTimers());

describe("reading PNG queue", () => {
  it("discards cancelled work and rechecks the view before rendering", async () => {
    vi.useFakeTimers();
    const cancelled = {} as Element;
    const editing = {} as Element;
    const reading = {} as Element;
    const render = vi.fn(async () => {});
    const queue = new ReadingPngQueue(element => element !== editing);
    queue.add(cancelled, render);
    queue.add(editing, render);
    queue.add(reading, render);
    queue.cancel(cancelled);
    await vi.advanceTimersByTimeAsync(199);
    expect(render).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(render).toHaveBeenCalledTimes(1);
    queue.destroy();
  });

  it("waits for the previous image before starting the next", async () => {
    vi.useFakeTimers();
    let finish!: () => void;
    const first = new Promise<void>(resolve => { finish = resolve; });
    const next = vi.fn(async () => {});
    const queue = new ReadingPngQueue(() => true);
    queue.add({} as Element, () => first);
    queue.add({} as Element, next);
    await vi.advanceTimersByTimeAsync(1000);
    expect(next).not.toHaveBeenCalled();
    finish();
    await vi.advanceTimersByTimeAsync(200);
    expect(next).toHaveBeenCalledTimes(1);
    queue.destroy();
  });
});
