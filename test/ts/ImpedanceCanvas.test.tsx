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

    remarkTimeOfFlightBlocks()(tree);

    expect(tree.children[0]).toEqual({
      type: "html",
      value: "<impedance-canvas></impedance-canvas>",
    });
  });
});
