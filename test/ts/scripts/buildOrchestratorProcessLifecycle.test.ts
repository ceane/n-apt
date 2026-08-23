import { describe, expect, it } from "@jest/globals";
import { removeActiveChild } from "../../../scripts/build/processLifecycle";

describe("build orchestrator process lifecycle", () => {
  it("removes completed background children so the registry cannot grow across hot reloads", () => {
    const children: object[] = [];

    for (let index = 0; index < 1000; index += 1) {
      const child = {};
      children.push(child);
      removeActiveChild(children, child);
    }

    expect(children).toHaveLength(0);
  });

  it("does not remove a different active child", () => {
    const first = {};
    const second = {};
    const children = [first, second];

    removeActiveChild(children, first);

    expect(children).toEqual([second]);
  });
});
