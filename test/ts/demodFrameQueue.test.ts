import { createDemodFrameQueue } from "@n-apt/app/infrastructure/visualization/demodFrameQueue";

describe("demod frame queue", () => {
  it("retains ordered audio frames independently of the one-frame visualizer slot", () => {
    const queue = createDemodFrameQueue<{ sequence: number }>(3);
    queue.push([{ sequence: 1 }, { sequence: 2 }]);
    queue.push([{ sequence: 3 }, { sequence: 4 }]);
    expect(queue.drain()).toEqual([
      { sequence: 2 },
      { sequence: 3 },
      { sequence: 4 },
    ]);
  });

  it("can be cleared when the source or listen session changes", () => {
    const queue = createDemodFrameQueue<{ sequence: number }>(3);
    queue.push([{ sequence: 1 }]);
    queue.clear();
    expect(queue.drain()).toEqual([]);
  });
});
