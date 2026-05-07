import remarkTimeOfFlightBlocks from "@n-apt/md-preview/utils/remarkTimeOfFlightBlocks";

describe("remarkTimeOfFlightBlocks", () => {
  it("replaces impedance code fences with the impedance canvas tag", () => {
    const tree: any = {
      type: "root",
      children: [
        {
          type: "code",
          lang: "canvas::impedance",
          value: "",
        },
      ],
    };

    // @ts-ignore - remark plugin type signature is complex for tests
    const plugin = remarkTimeOfFlightBlocks();
    plugin?.(tree, undefined as any, undefined as any);

    expect(tree.children[0]).toEqual({
      type: "html",
      value: "<impedance-canvas></impedance-canvas>",
    });
  });
});
