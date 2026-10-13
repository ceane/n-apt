import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RetryableMlFeature } from "@n-apt/shared/ui/RetryableMlFeature";

describe("RetryableMlFeature", () => {
  it("shows a retryable fallback after a module load failure and mounts on retry", async () => {
    let attempts = 0;
    const loadFeature = jest.fn(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("fixture module load failure");
      return { default: () => <div>ML feature ready</div> };
    });

    render(
      <RetryableMlFeature
        label="Vision decoder"
        loader={loadFeature}
        componentProps={{}}
      />,
    );

    const fallback = await screen.findByRole("alert", {
      name: "Vision decoder unavailable",
    });
    expect(fallback).toHaveTextContent(
      "The encrypted ML feature bundle could not be loaded",
    );
    expect(fallback).toHaveStyle({ borderStyle: "dashed" });
    expect(screen.queryByRole("button", { name: "Re-auth" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry Vision decoder" }));

    await waitFor(() => expect(screen.getByText("ML feature ready")).toBeInTheDocument());
    expect(loadFeature).toHaveBeenCalledTimes(2);
  });
});
