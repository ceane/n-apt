import { createVisionTrainingRepository } from "@n-apt/demodulation/vision/visionTrainingStorage";

describe("vision training checkpoint storage", () => {
  test("fails clearly when IndexedDB is unavailable", async () => {
    const indexedDbDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      "indexedDB",
    );
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      value: undefined,
    });

    try {
      await expect(
        createVisionTrainingRepository("vision-training-storage-test").load(
          "job-1",
        ),
      ).rejects.toThrow("Vision training checkpoint storage requires IndexedDB");
    } finally {
      if (indexedDbDescriptor) {
        Object.defineProperty(globalThis, "indexedDB", indexedDbDescriptor);
      } else {
        Reflect.deleteProperty(globalThis, "indexedDB");
      }
    }
  });
});
