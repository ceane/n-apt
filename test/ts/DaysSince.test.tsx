import React from "react";
import fs from "node:fs";
import path from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DaysSince, renderImage } from "@n-apt/app-article/components/DaysSince";

describe("DaysSince copyable image", () => {
  it("uses compact mobile typography for stacked statistics", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../../src/app-article/components/DaysSince.tsx"),
      "utf8",
    );
    expect(source).toContain("@media (max-width: 768px)");
    expect(source).toContain("font-size: 0.65rem;");
    expect(source).toContain("font-size: 1.8rem;");
    expect(source).toContain("letter-spacing: 0.12em;");
  });
  it("keeps the copied cost sections in the same order as the DOM", async () => {
    const drawCalls: Array<{ text: string; x: number; y: number; font: string }> = [];
    const fillText = jest.fn(function (this: { font: string }, text: string, x: number, y: number) {
      drawCalls.push({ text, x, y, font: this.font });
    });
    const context = {
      fillRect: jest.fn(),
      fillText,
      measureText: jest.fn((text: string) => ({ width: text.length * 10 })),
      save: jest.fn(),
      restore: jest.fn(),
      scale: jest.fn(),
    } as any;
    const getContext = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context);
    const toBlob = jest
      .spyOn(HTMLCanvasElement.prototype, "toBlob")
      .mockImplementation((callback) => {
        callback(new Blob(["png"], { type: "image/png" }));
      });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: jest.fn().mockResolvedValue(undefined) },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: class ClipboardItem {
        constructor(public readonly items: Record<string, Blob>) {}
      },
    });

    try {
      render(<DaysSince />);
      fireEvent.click(screen.getByRole("button", { name: /copy stats as image/i }));

      await waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Copied Table (.png)"));
      expect(context.fillRect).toHaveBeenCalledWith(0, 0, 800, 500);

      const labels = fillText.mock.calls.map(([text]) => text);
      const dataSectionLabels = fillText.mock.calls.filter(
        ([text]) => text === "DATA INTERCEPTED TOTAL" || text === "DATA INTERCEPTED IN 24HRS",
      );
      const totalCostLabel = labels.indexOf("DATA TOTAL COST (TO PRESENT)*");
      const totalMinLabel = labels.indexOf("MIN†", totalCostLabel);
      const totalMaxLabel = labels.indexOf("MAX‡", totalMinLabel);
      const totalMinValue = labels.findIndex(
        (text: string, index: number) => index > totalMaxLabel && text.includes("$"),
      );
      const dailyCostLabel = labels.indexOf("DATA COST PER DAY*");
      const dailyMinLabel = labels.indexOf("MIN†", dailyCostLabel);
      const dailyMaxLabel = labels.indexOf("MAX‡", dailyMinLabel);
      const dailyMinValue = labels.findIndex(
        (text: string, index: number) => index > dailyMaxLabel && text.includes("$"),
      );

      expect(totalCostLabel).toBeGreaterThanOrEqual(0);
      expect(dataSectionLabels).toHaveLength(2);
      expect(dataSectionLabels[1][1]).toBeGreaterThan(dataSectionLabels[0][1]);
      expect(drawCalls.find(({ text }) => text === "HOURS TOTAL")?.y).toBe(34);
      expect(drawCalls.find(({ text }) => text === "DAYS TOTAL")?.x).toBe(538);
      expect(
        drawCalls.filter(({ y, font }) => y === 100 && font.startsWith("400") && font.includes("48px")),
      ).toHaveLength(3);
      expect(
        drawCalls
          .filter(({ y, font }) => y === 210 && font.startsWith("400"))
          .map(({ font }) => font),
      ).toEqual([
        expect.stringContaining("40px"),
        expect.stringContaining("40px"),
        expect.stringContaining("40px"),
        expect.stringContaining("40px"),
      ]);
      expect(drawCalls.find(({ text }) => text === "DATA INTERCEPTED TOTAL")?.x).toBe(24);
      expect(drawCalls.find(({ text }) => text === "DATA INTERCEPTED IN 24HRS")?.x).toBe(408);
      expect(
        drawCalls.some(({ text, y }) => text === "DATA TOTAL COST (TO PRESENT)*" && y === 300),
      ).toBe(true);
      expect(drawCalls.some(({ text, y }) => text === "MIN†" && y === 328)).toBe(true);
      expect(totalMinLabel).toBeGreaterThan(totalCostLabel);
      expect(totalMaxLabel).toBeGreaterThan(totalMinLabel);
      expect(totalMinValue).toBeGreaterThan(totalMaxLabel);
      expect(dailyCostLabel).toBeGreaterThan(totalMinValue);
      expect(dailyMinLabel).toBeGreaterThan(dailyCostLabel);
      expect(dailyMaxLabel).toBeGreaterThan(dailyMinLabel);
      expect(dailyMinValue).toBeGreaterThan(dailyMaxLabel);

      const costValueBaselines = fillText.mock.calls
        .filter(([text]) => typeof text === "string" && text.startsWith("$"))
        .map(([, , baselineY]) => baselineY);
      expect(costValueBaselines).toHaveLength(4);
      expect(new Set(costValueBaselines).size).toBe(1);

      const injectedStyles = Array.from(document.querySelectorAll("style"))
        .map((style) => style.textContent ?? "")
        .join("\n");
      expect(injectedStyles).toContain("min-height:2.6em");
    } finally {
      getContext.mockRestore();
      toBlob.mockRestore();
    }
  });

  it("wraps long comparison text and renders a device-pixel-scaled canvas", () => {
    const drawCalls: Array<{ text: string; x: number; y: number }> = [];
    const context = {
      fillRect: jest.fn(),
      fillText: jest.fn((text: string, x: number, y: number) => {
        drawCalls.push({ text, x, y });
      }),
      measureText: jest.fn((text: string) => ({ width: text.length * 6 })),
      save: jest.fn(),
      restore: jest.fn(),
      scale: jest.fn(),
    } as any;
    const canvas = document.createElement("canvas");
    Object.defineProperty(canvas, "width", { configurable: true, writable: true, value: 0 });
    Object.defineProperty(canvas, "height", { configurable: true, writable: true, value: 0 });
    const getContext = jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context);
    const previousDevicePixelRatio = window.devicePixelRatio;
    Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 2 });

    const longComparison = "or 4.8 billion iPhone-shot photos in the intercepted stream";
    try {
      renderImage(
        canvas,
        { totalHours: 69355, escalationHours: 32059, totalDays: 2890 },
        {
          totalMin: "$1.01M – $1.73M",
          totalMax: "$2.02M – $3.46M",
          dailyMin: "$349 – $599",
          dailyMax: "$699 – $1,198",
        },
        { val: "14.427", unit: "PB" },
        { val: "28.855", unit: "PB" },
        { val: "4.99", unit: "TB" },
        { val: "9.99", unit: "TB" },
        longComparison,
        longComparison,
        longComparison,
        longComparison,
      );

      const comparisonLines = drawCalls.filter(({ y }) => y >= 271 && y < 374);
      expect(comparisonLines.length).toBeGreaterThan(4);
      expect(new Set(comparisonLines.map(({ y }) => y)).size).toBeGreaterThan(1);
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(1000);
      expect(context.scale).toHaveBeenCalledWith(2, 2);
    } finally {
      getContext.mockRestore();
      Object.defineProperty(window, "devicePixelRatio", {
        configurable: true,
        value: previousDevicePixelRatio,
      });
    }
  });
});
