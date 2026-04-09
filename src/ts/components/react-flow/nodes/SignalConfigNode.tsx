import React, { useEffect, useState } from "react";
import styled from "styled-components";
import {
  Blend,
  Columns3Cog,
  GalleryHorizontal,
  Gauge,
  Image as ImageIcon,
  Zap,
  ArrowBigUp,
  Pipette,
  FileBox,
} from "lucide-react";
import { useAppSelector, useAppDispatch, setTemporalResolution, setPowerScale, sendSettings, sendPowerScaleCommand } from "@n-apt/redux";
import { useSdrSettings } from "@n-apt/hooks/useSdrSettings";
import { useSpectrumStore } from "@n-apt/hooks/useSpectrumStore";
import { fileRegistry } from "@n-apt/utils/fileRegistry";
import { formatFrequencyHz } from "@n-apt/utils/frequency";
import FileMetadata from "@n-apt/components/sidebar/FileMetadata";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import type { NaptMetadata } from "@n-apt/components/sidebar/FileMetadata";

const NodeContainer = styled.div`
  background: ${({ theme }) => theme.colors.surface};
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 12px;
  padding: ${({ theme }) => theme.spacing.lg};
  min-width: 320px;
  max-width: 400px;
`;

const NodeTitle = styled.div`
  font-size: ${({ theme }) => theme.typography.bodySize};
  font-weight: bold;
  color: ${({ theme }) => theme.colors.textPrimary};
  margin-bottom: ${({ theme }) => theme.spacing.md};
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.sm};
`;

const NodeSubtitle = styled.div`
  font-size: 10px;
  color: ${({ theme }) => theme.colors.textSecondary};
  margin-bottom: ${({ theme }) => theme.spacing.lg};
`;

const SettingsGrid = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: ${({ theme }) => theme.spacing.md} ${({ theme }) => theme.spacing.lg};
`;

const SettingRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const SettingLabel = styled.div`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textPrimary};
  display: flex;
  align-items: center;
  gap: 6px;
  
  svg {
    width: 12px;
    height: 12px;
    opacity: 0.6;
  }
`;

const SettingInput = styled.input`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 11px;
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  width: 70px;
  text-align: right;
  
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
  
  &::-webkit-outer-spin-button,
  &::-webkit-inner-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }
  
  &[type="number"] {
    -moz-appearance: textfield;
  }
`;

const SettingSelect = styled.select`
  background: transparent;
  border: 1px solid ${({ theme }) => theme.colors.border};
  border-radius: 4px;
  color: ${({ theme }) => theme.colors.textPrimary};
  font-family: ${({ theme }) => theme.typography.mono};
  font-size: 11px;
  padding: ${({ theme }) => theme.spacing.xs} ${({ theme }) => theme.spacing.sm};
  min-width: 100px;
  cursor: pointer;
  
  &:focus {
    outline: none;
    border-color: ${({ theme }) => theme.colors.primary};
  }
  
  option {
    background: ${({ theme }) => theme.colors.surface};
    color: ${({ theme }) => theme.colors.textPrimary};
  }
`;

const InputGroup = styled.div`
  display: flex;
  align-items: center;
  gap: ${({ theme }) => theme.spacing.xs};
`;

const UnitLabel = styled.span`
  font-size: 11px;
  color: ${({ theme }) => theme.colors.textPrimary};
`;

interface SignalConfigNodeProps {
  data: {
    signalOptions: boolean;
    label: string;
  };
}

export const SignalConfigNode: React.FC<SignalConfigNodeProps> = ({ data }) => {
  const dispatch = useAppDispatch();
  const spectrum = useAppSelector(state => state.spectrum);
  const { wsConnection, sampleRateMHz, state: liveState } = useSpectrumStore();
  const { sessionToken, aesKey } = useAuthentication();

  const {
    sdrSettings: liveSdrSettingsConfig,
    backend: liveBackend,
    deviceProfile: liveDeviceProfileToUse,
    autoFftOptions: liveAutoFftOptions
  } = wsConnection;

  const {
    fftSizeOptions,
    setFftSize,
    setFftWindow: handleFftWindow,
    setGain,
    setPpm,
    scheduleCoupledAdjustment
  } = useSdrSettings({
    maxSampleRate: (sampleRateMHz || 3.2) * 1_000_000,
    sdrSettings: liveSdrSettingsConfig,
    onSettingsChange: (settings) => dispatch(sendSettings(settings))
  });

  const showsApproxDbmToggle = liveDeviceProfileToUse?.supports_approx_dbm ||
    (liveBackend === "rtl_sdr" || liveBackend === "rtl-sdr" || liveBackend === "rtlsdr" ||
      liveBackend === "rtl-tcp" || liveBackend === "rtltcp");

  const sourceMode = liveState?.sourceMode ?? "live";
  const selectedFiles = liveState?.selectedFiles ?? [];

  const manualFftOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          (fftSizeOptions.length ? fftSizeOptions : [spectrum.fftSize]).filter((size) =>
            Number.isFinite(size) && size > 0,
          ),
        ),
      ).sort((a: any, b: any) => a - b),
    [spectrum.fftSize, fftSizeOptions],
  );

  const autoFftSizeOptions = React.useMemo(
    () =>
      Array.from(
        new Set(
          (liveAutoFftOptions?.autoSizes ?? []).filter((size) =>
            Number.isFinite(size) && size > 0,
          ),
        ),
      ).sort((a: any, b: any) => a - b),
    [liveAutoFftOptions],
  );

  const clampGain = (val: number) => {
    if (Number.isNaN(val)) return 0;
    return Math.max(0, Math.min(49.6, val));
  };

  const handlePpmChange = (raw: string) => {
    const val = raw === "" ? 0 : parseInt(raw, 10) || 0;
    setPpm(val);
  };

  const handleGainChange = (raw: number) => {
    const val = clampGain(Number.isFinite(raw) ? raw : 0);
    setGain(val);
  };

  const selectedPrimaryFile = (selectedFiles && selectedFiles.length > 0) ? selectedFiles[0] : null;

  const [naptMetadata, setNaptMetadata] = useState<NaptMetadata | null>(null);
  const [naptMetadataError, setNaptMetadataError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!selectedPrimaryFile || sourceMode !== "file") {
      setNaptMetadata(null);
      return;
    }

    const isNapt = selectedPrimaryFile.name.toLowerCase().endsWith(".napt");
    const isWav = selectedPrimaryFile.name.toLowerCase().endsWith(".wav");

    if (isNapt && !aesKey) {
      setNaptMetadata(null);
      setNaptMetadataError("Locked (no session key)");
      return;
    }

    const run = async () => {
      try {
        const fileObj = fileRegistry.get(selectedPrimaryFile.id);
        if (!fileObj) throw new Error("File not found in registry");

        const buf = await fileObj.arrayBuffer();

        if (isNapt && aesKey) {
          const headerSize = Math.min(2048, buf.byteLength);
          const headerBytes = new Uint8Array(buf, 0, headerSize);
          const newlineIdx = headerBytes.indexOf(10);
          if (newlineIdx <= 0) throw new Error("Invalid NAPT header");

          const jsonStr = new TextDecoder().decode(headerBytes.slice(0, newlineIdx));
          const metaObj = JSON.parse(jsonStr);

          if (!cancelled) {
            const metadata = metaObj.metadata || metaObj;
            setNaptMetadata(metadata);
            setNaptMetadataError(null);
          }
        } else if (isWav) {
          const view = new DataView(buf);
          const text = (off: number, len: number) =>
            String.fromCharCode(...Array.from(new Uint8Array(buf, off, len)));

          if (text(0, 4) === "RIFF" && text(8, 4) === "WAVE") {
            let offset = 12;
            let meta: any = null;
            while (offset + 8 <= buf.byteLength) {
              const chunkId = text(offset, 4);
              const chunkSize = view.getUint32(offset + 4, true);
              if (chunkId === "nAPT") {
                const metaBytes = new Uint8Array(buf, offset + 8, chunkSize);
                const nullIdx = metaBytes.indexOf(0);
                const jsonStr = new TextDecoder().decode(
                  nullIdx !== -1 ? metaBytes.slice(0, nullIdx) : metaBytes,
                );
                try {
                  meta = JSON.parse(jsonStr);
                  break;
                } catch {
                  // ignore
                }
              }
              offset += 8 + chunkSize + (chunkSize % 2); // pad byte
            }
            if (!cancelled && meta) {
              setNaptMetadata(meta.metadata || meta);
              setNaptMetadataError(null);
            }
          }
        }
      } catch (err: any) {
        if (!cancelled) {
          setNaptMetadata(null);
          setNaptMetadataError(err.message || "Failed to load");
        }
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, [selectedPrimaryFile, aesKey, sourceMode]);

  return (
    <NodeContainer>
      <NodeTitle>
        {sourceMode === "file" ? <FileBox size={16} /> : <Columns3Cog size={16} />}
        {sourceMode === "file" ? "Metadata" : data.label}
      </NodeTitle>
      <NodeSubtitle>{sourceMode === "file" ? "Recorded Data Properties" : "Hardware sampling and FFT settings"}</NodeSubtitle>

      {sourceMode === "file" ? (
        <>
          <FileMetadata
            selectedNaptFile={selectedPrimaryFile}
            naptMetadata={naptMetadata}
            naptMetadataError={naptMetadataError}
            sessionToken={sessionToken}
            showTitle={false}
          />
        </>
      ) : (
        <SettingsGrid>
          <SettingRow>
            <SettingLabel>
              <GalleryHorizontal size={12} />
              Sample Size
            </SettingLabel>
            <InputGroup>
              <SettingInput
                type="text"
                readOnly
                value={formatFrequencyHz(spectrum.sampleRateHz)}
              />
              <UnitLabel>Hz</UnitLabel>
            </InputGroup>
          </SettingRow>

          <SettingRow>
            <SettingLabel>
              <ImageIcon size={12} />
              FFT Size
            </SettingLabel>
            <SettingSelect
              value={spectrum.fftSize}
              onChange={(e) => {
                const val = Number(e.target.value);
                setFftSize(val);
                scheduleCoupledAdjustment("fftSize", val, spectrum.fftFrameRate);
              }}
            >
              {autoFftSizeOptions.length > 0 ? (
                <>
                  {autoFftSizeOptions.map((size: any) => (
                    <option key={`auto-${size}`} value={size}>
                      {size} (Auto)
                    </option>
                  ))}
                  {manualFftOptions.length > 0 && <option disabled>---</option>}
                  {manualFftOptions.map((size: any) => (
                    <option key={`manual-${size}`} value={size}>
                      {size}
                    </option>
                  ))}
                </>
              ) : (
                <>
                  {manualFftOptions.map((size: any) => (
                    <option key={`manual-${size}`} value={size}>
                      {size}
                    </option>
                  ))}
                </>
              )}
            </SettingSelect>
          </SettingRow>

          <SettingRow>
            <SettingLabel>
              <Blend size={12} />
              FFT Window
            </SettingLabel>
            <SettingSelect
              value={spectrum.fftWindow || "Rectangular"}
              onChange={(e) => {
                handleFftWindow(e.target.value);
              }}
            >
              <option value="Rectangular">Rectangular</option>
              <option value="Nuttall">Nuttall</option>
              <option value="Hamming">Hamming</option>
              <option value="Hanning">Hanning</option>
              <option value="Blackman">Blackman</option>
            </SettingSelect>
          </SettingRow>

          <SettingRow>
            <SettingLabel>
              <Gauge size={12} />
              Temporal Resolution
            </SettingLabel>
            <SettingSelect
              value={spectrum.displayTemporalResolution}
              onChange={(e) => {
                dispatch(setTemporalResolution(e.target.value as "low" | "medium" | "high"));
              }}
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </SettingSelect>
          </SettingRow>

          {showsApproxDbmToggle && (
            <SettingRow>
              <SettingLabel>
                <Zap size={12} />
                Power Scale
              </SettingLabel>
              <SettingSelect
                value={spectrum.powerScale}
                onChange={(e) => {
                  const ps = e.target.value as "dB" | "dBm";
                  dispatch(setPowerScale(ps));
                  dispatch(sendPowerScaleCommand(ps));
                }}
              >
                <option value="dB">dB (relative)</option>
                <option value="dBm">dBm (approximate)</option>
              </SettingSelect>
            </SettingRow>
          )}

          <SettingRow>
            <SettingLabel>
              <Pipette size={12} />
              PPM
            </SettingLabel>
            <SettingInput
              type="number"
              value={spectrum.ppm}
              onChange={(e) => handlePpmChange(e.target.value)}
              step="1"
            />
          </SettingRow>

          <SettingRow>
            <SettingLabel>
              <ArrowBigUp size={12} />
              Gain
            </SettingLabel>
            <InputGroup>
              <SettingInput
                type="number"
                step="1"
                value={spectrum.gain}
                onChange={(e) => handleGainChange(Math.round(Number(e.target.value)))}
                min="0"
                max="49.6"
              />
              <UnitLabel>dB</UnitLabel>
            </InputGroup>
          </SettingRow>
        </SettingsGrid>
      )}
    </NodeContainer>
  );
};