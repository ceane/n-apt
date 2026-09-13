import * as React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import { TestWrapper } from "./testUtils";
import { WebUsbExperimentRoute } from "@n-apt/app/routes/pages/WebUsbExperimentRoute";

describe("WebUsbExperimentRoute", () => {
  const originalUsb = (navigator as Navigator & { usb?: unknown }).usb;

  afterEach(() => {
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: originalUsb,
    });
    jest.restoreAllMocks();
  });

  it("requests a frame and draws it after the user checks the device", async () => {
    const context = {
      clearRect: jest.fn(),
      fillRect: jest.fn(),
      beginPath: jest.fn(),
      lineTo: jest.fn(),
      moveTo: jest.fn(),
      stroke: jest.fn(),
    };
    jest
      .spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockReturnValue(context as unknown as GPUCanvasContext);

    const device = {
      vendorId: 0x0bda,
      productId: 0x2838,
      productName: "RTL2838",
      opened: false,
      configuration: null,
      open: jest.fn(async () => undefined),
      close: jest.fn(async () => undefined),
      selectConfiguration: jest.fn(async () => undefined),
      claimInterface: jest.fn(async () => undefined),
      releaseInterface: jest.fn(async () => undefined),
      controlTransferOut: jest.fn(async () => ({
        status: "ok",
        bytesWritten: 1,
      })),
      transferIn: jest.fn(async () => ({
        status: "ok",
        data: new DataView(
          Uint8Array.from([128, 128, 255, 128, 64, 128]).buffer,
        ),
      })),
    };

    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: {
        getDevices: jest.fn(async () => []),
        requestDevice: jest.fn(async () => device),
      },
    });

    render(
      <TestWrapper>
        <WebUsbExperimentRoute />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: /check for rtl-sdr/i }));

    expect(await screen.findByText(/frame received/i)).toBeInTheDocument();
    expect(device.open).toHaveBeenCalled();
    expect(device.claimInterface).toHaveBeenCalledWith(0);
    expect(device.controlTransferOut).toHaveBeenCalled();
    expect(
      (
        device.controlTransferOut.mock.calls as unknown as Array<
          [{ value: number }]
        >
      ).some(([setup]) => setup.value === 0x9f20),
    ).toBe(true);
    expect(device.transferIn).toHaveBeenCalledWith(1, expect.any(Number));
    expect(device.releaseInterface).toHaveBeenCalledWith(0);
    expect(device.close).toHaveBeenCalled();
    await waitFor(() => expect(context.stroke).toHaveBeenCalled());
  });

  it("explains when WebUSB is unavailable", async () => {
    Object.defineProperty(navigator, "usb", {
      configurable: true,
      value: undefined,
    });

    render(
      <TestWrapper>
        <WebUsbExperimentRoute />
      </TestWrapper>,
    );

    fireEvent.click(screen.getByRole("button", { name: /check for rtl-sdr/i }));

    expect(
      await screen.findByText(/webusb is unavailable/i),
    ).toBeInTheDocument();
  });
});
