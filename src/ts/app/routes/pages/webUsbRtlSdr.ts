import {
  RtlSdrWebUsbSession,
  type WebUsbLike,
} from "../../../webusb/rtlSdrWebUsb";

export { RTL_SDR_FILTERS } from "../../../webusb/rtlSdrWebUsb";
export type {
  WebUsbDeviceLike,
  WebUsbEndpointLike,
  WebUsbLike,
} from "../../../webusb/rtlSdrWebUsb";

export const DEFAULT_SAMPLE_RATE_HZ = 1_024_000;
export const FRAME_SAMPLE_COUNT = 16_384;

export type RtlSdrFrame = {
  data: Uint8Array;
  deviceLabel: string;
  endpointNumber: number;
  sampleRateHz: number;
};

export async function readRtlSdrFrame({
  sampleRateHz = DEFAULT_SAMPLE_RATE_HZ,
  usb,
}: {
  sampleRateHz?: number;
  usb?: WebUsbLike;
} = {}): Promise<RtlSdrFrame> {
  const session = new RtlSdrWebUsbSession(usb, "experiment-demod-only");
  try {
    const connection = await session.connect({
      sampleRateHz,
      fftSize: FRAME_SAMPLE_COUNT,
    });
    return {
      data: await session.readFrame(),
      deviceLabel: connection.deviceLabel,
      endpointNumber: connection.endpointNumber,
      sampleRateHz: connection.sampleRateHz,
    };
  } finally {
    await session.disconnect();
  }
}

export function drawRtlSdrFrame(
  canvas: HTMLCanvasElement,
  data: Uint8Array,
): void {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D rendering is unavailable.");

  const width = canvas.width;
  const height = canvas.height;
  context.fillStyle = "#07111f";
  context.fillRect(0, 0, width, height);
  context.strokeStyle = "#60a5fa";
  context.lineWidth = 1;
  context.beginPath();

  const samples = Math.floor(data.byteLength / 2);
  for (let x = 0; x < width; x += 1) {
    const sampleIndex = Math.min(
      samples - 1,
      Math.floor((x / width) * samples),
    );
    const inPhase = (data[sampleIndex * 2] ?? 128) - 128;
    const y = height / 2 - (inPhase / 128) * (height * 0.42);
    if (x === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}
