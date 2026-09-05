import { selectArrayOrEmpty } from "@n-apt/redux/selectors/stableSelectorDefaults";

describe("selectArrayOrEmpty", () => {
  it("returns the same empty array reference for missing values", () => {
    expect(selectArrayOrEmpty(undefined)).toBe(selectArrayOrEmpty(null));
  });
});
