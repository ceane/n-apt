import React, { useCallback, useRef, useState } from "react";
import styled from "styled-components";
import {
  DEFAULT_SAMPLE_RATE_HZ,
  drawRtlSdrFrame,
  readRtlSdrFrame,
} from "./webUsbRtlSdr";

const Page = styled.main`
  min-height: 100vh;
  box-sizing: border-box;
  padding: 28px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
  font-family: "Outfit", "Inter", sans-serif;
`;

const Header = styled.header`
  max-width: 1080px;
  margin: 0 auto 20px;
`;

const Eyebrow = styled.div`
  color: ${(props) => props.theme.primary};
  font:
    600 11px "JetBrains Mono",
    monospace;
  letter-spacing: 0.12em;
  text-transform: uppercase;
`;

const Title = styled.h1`
  margin: 8px 0;
  font-size: clamp(28px, 5vw, 46px);
`;

const Description = styled.p`
  max-width: 720px;
  margin: 0;
  color: ${(props) => props.theme.textSecondary};
  line-height: 1.55;
`;

const Card = styled.section`
  max-width: 1080px;
  margin: 0 auto;
  padding: 20px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 16px;
  background: ${(props) => props.theme.surface};
`;

const Toolbar = styled.div`
  display: flex;
  flex-wrap: wrap;
  align-items: end;
  gap: 12px;
  margin-bottom: 16px;
`;

const Field = styled.label`
  display: grid;
  gap: 6px;
  color: ${(props) => props.theme.textSecondary};
  font:
    11px "JetBrains Mono",
    monospace;
  text-transform: uppercase;
`;

const Input = styled.input`
  width: 140px;
  box-sizing: border-box;
  padding: 10px 12px;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 8px;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
  font:
    13px "JetBrains Mono",
    monospace;
`;

const Button = styled.button`
  padding: 11px 16px;
  border: 0;
  border-radius: 8px;
  background: ${(props) => props.theme.primary};
  color: #fff;
  font-weight: 700;
  cursor: pointer;

  &:disabled {
    cursor: wait;
    opacity: 0.65;
  }
`;

const Status = styled.p<{ $error?: boolean }>`
  min-height: 22px;
  margin: 0 0 14px;
  color: ${(props) =>
    props.$error
      ? (props.theme.error ?? "#f87171")
      : props.theme.textSecondary};
  font:
    12px "JetBrains Mono",
    monospace;
`;

const CanvasFrame = styled.div`
  overflow: hidden;
  border: 1px solid ${(props) => props.theme.border};
  border-radius: 12px;
  background: #07111f;
`;

const Canvas = styled.canvas`
  display: block;
  width: 100%;
  height: min(52vw, 360px);
`;

const Meta = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 14px 24px;
  margin-top: 12px;
  color: ${(props) => props.theme.textMuted};
  font:
    11px "JetBrains Mono",
    monospace;
`;

export const WebUsbExperimentRoute: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [sampleRate, setSampleRate] = useState(String(DEFAULT_SAMPLE_RATE_HZ));
  const [status, setStatus] = useState(
    "Ready. Press the button to select an RTL-SDR.",
  );
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [meta, setMeta] = useState<{
    bytes: number;
    deviceLabel: string;
    endpoint: number;
  } | null>(null);

  const handleCheckDevice = useCallback(async () => {
    setBusy(true);
    setError(false);
    setMeta(null);
    setStatus("Opening WebUSB and initializing the RTL2832U sample path…");

    try {
      const frame = await readRtlSdrFrame({
        sampleRateHz: Math.max(1, Number(sampleRate) || DEFAULT_SAMPLE_RATE_HZ),
      });
      if (!canvasRef.current)
        throw new Error("The sample canvas is unavailable.");
      drawRtlSdrFrame(canvasRef.current, frame.data);
      setMeta({
        bytes: frame.data.byteLength,
        deviceLabel: frame.deviceLabel,
        endpoint: frame.endpointNumber,
      });
      setStatus(
        `Frame received at ${frame.sampleRateHz.toLocaleString()} samples/sec.`,
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      setError(true);
      setStatus(
        /NotFoundError|No device selected/i.test(message)
          ? "No RTL-SDR was selected."
          : message,
      );
    } finally {
      setBusy(false);
    }
  }, [sampleRate]);

  return (
    <Page>
      <Header>
        <Eyebrow>Experiments / WebUSB</Eyebrow>
        <Title>RTL-SDR browser probe</Title>
        <Description>
          A deliberately small, native-free path: request the USB device, write
          the RTL2832U demodulator settings, read one IQ frame, and draw its I
          samples directly on this canvas.
        </Description>
      </Header>

      <Card>
        <Toolbar>
          <Field>
            Sample rate (Hz)
            <Input
              aria-label="Sample rate in hertz"
              inputMode="numeric"
              type="number"
              min={1}
              step={1}
              value={sampleRate}
              onChange={(event) => setSampleRate(event.target.value)}
            />
          </Field>
          <Button type="button" onClick={handleCheckDevice} disabled={busy}>
            {busy ? "Reading frame…" : "Check for RTL-SDR"}
          </Button>
        </Toolbar>

        <Status role="status" aria-live="polite" $error={error}>
          {status}
        </Status>

        <CanvasFrame>
          <Canvas
            ref={canvasRef}
            width={1024}
            height={360}
            aria-label="RTL-SDR IQ frame"
          />
        </CanvasFrame>

        {meta ? (
          <Meta>
            <span>device: {meta.deviceLabel}</span>
            <span>bytes: {meta.bytes.toLocaleString()}</span>
            <span>bulk IN endpoint: {meta.endpoint}</span>
          </Meta>
        ) : null}
      </Card>
    </Page>
  );
};
