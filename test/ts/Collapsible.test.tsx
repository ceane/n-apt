import * as React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { Collapsible } from "@n-apt/components/ui";

describe("Collapsible", () => {
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
