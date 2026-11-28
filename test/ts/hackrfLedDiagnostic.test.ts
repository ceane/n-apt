import {
  getHackRfLedExpectation,
  gradeHackRfLedObservation,
  HACKRF_LED_LAYOUT,
} from "../../scripts/test/hackrfLedDiagnostic";

describe("HackRF manual LED diagnostic", () => {
  it("keeps the 3V3 indicator separate from the five-LED row", () => {
    expect(HACKRF_LED_LAYOUT.map(({ id }) => id)).toEqual([
      "3v3",
      "1v8",
      "rf",
      "usb",
      "rx",
      "tx",
    ]);
    expect(HACKRF_LED_LAYOUT.find(({ id }) => id === "3v3")?.placement).toBe(
      "between-reset-and-dfu",
    );
    expect(
      HACKRF_LED_LAYOUT.filter(({ placement }) => placement === "row").map(
        ({ id }) => id,
      ),
    ).toEqual(["1v8", "rf", "usb", "rx", "tx"]);
    expect(HACKRF_LED_LAYOUT.map(({ id, color }) => [id, color])).toEqual([
      ["3v3", "green"],
      ["1v8", "#ffb000"],
      ["rf", "red"],
      ["usb", "green"],
      ["rx", "yellow"],
      ["tx", "red"],
    ]);
  });

  it("expects the RX and TX indicators only in their matching radio mode", () => {
    expect(getHackRfLedExpectation("rx", "rx")).toBe(true);
    expect(getHackRfLedExpectation("tx", "rx")).toBe(false);
    expect(getHackRfLedExpectation("rx", "tx")).toBe(false);
    expect(getHackRfLedExpectation("tx", "tx")).toBe(true);
  });

  it("keeps uncertain RF LED behavior informational and supports skips/timeouts", () => {
    expect(getHackRfLedExpectation("rf", "idle")).toBeNull();
    expect(gradeHackRfLedObservation(null, "on")).toBe("INFO");
    expect(gradeHackRfLedObservation(true, "skip")).toBe("SKIP");
    expect(gradeHackRfLedObservation(true, "timeout")).toBe("TIMEOUT");
    expect(gradeHackRfLedObservation(true, "off")).toBe("FAIL");
    expect(gradeHackRfLedObservation(true, "on")).toBe("PASS");
    expect(gradeHackRfLedObservation(false, "off")).toBe("PASS");
    expect(gradeHackRfLedObservation(false, "on")).toBe("FAIL");
  });
});
