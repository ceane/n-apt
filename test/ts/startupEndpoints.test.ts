import { describe, expect, it } from "@jest/globals";

import { BACKEND_HTTP_URL, WS_URL } from "@n-apt/consts/env";

describe("development backend endpoints", () => {
  it("uses the IPv4 handoff endpoint when no backend URL is configured", () => {
    expect(BACKEND_HTTP_URL).toBe("http://127.0.0.1:8765");
    expect(WS_URL).toBe("ws://127.0.0.1:8765");
  });
});
