import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { Collapsible } from "@n-apt/components/ui";

describe("Collapsible", () => {
  it("syncs an externally requested open state", () => {
    const { rerender } = render(
      <Collapsible title="Psychology" open={false}>
        <div>Brain model</div>
      </Collapsible>,
    );

    expect(screen.getByRole("button", { name: /psychology/i })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Brain model")).not.toBeInTheDocument();

    rerender(
      <Collapsible title="Psychology" open>
        <div>Brain model</div>
      </Collapsible>,
    );

    expect(screen.getByRole("button", { name: /psychology/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("Brain model")).toBeInTheDocument();
  });

  it("notifies when the open state changes", async () => {
    const user = userEvent.setup();
    const onOpenChange = jest.fn();

    render(
      <Collapsible
        title="Psychology"
        defaultOpen={false}
        onOpenChange={onOpenChange}
      >
        <div>Brain model</div>
      </Collapsible>,
    );

    await user.click(screen.getByRole("button", { name: /psychology/i }));
    expect(onOpenChange).toHaveBeenCalledWith(true);

    await user.click(screen.getByRole("button", { name: /psychology/i }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
