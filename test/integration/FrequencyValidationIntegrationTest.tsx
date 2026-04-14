import React from "react";
import { useWebSocket } from "../../src/ts/hooks/useWebSocket";
import type { CaptureFileType } from "../../src/ts/consts/schemas/websocket";

export const FrequencyValidationIntegrationTest: React.FC = () => {
  const {
    isConnected,
    deviceState: _deviceState,
    captureStatus,
    maxSampleRateHz,
    dataRef,
    sendCaptureCommand,
  } = useWebSocket("ws://test", null, false);

  // Mock state for frequency testing
  const [frequencyRanges, setFrequencyRanges] = React.useState<Array<{
    minFreq: number;
    maxFreq: number;
    unit: 'MHz' | 'kHz' | 'Hz';
  }>>([
    { minFreq: 100, maxFreq: 103.2, unit: 'MHz' }
  ]);

  const [captureDurationS, setCaptureDurationS] = React.useState(5);
  const [captureFileType, setCaptureFileType] = React.useState<CaptureFileType>(".napt");
  const [acquisitionMode, setAcquisitionMode] = React.useState<"stepwise" | "interleaved">("stepwise");
  const [captureEncrypted, setCaptureEncrypted] = React.useState(false);

  // Validation functions
  const validateFrequencyRange = (minFreq: number, maxFreq: number, unit: 'MHz' | 'kHz' | 'Hz'): string[] => {
    const errors: string[] = [];

    // Convert to Hz for validation
    const minHz = convertToHz(minFreq, unit);
    const maxHz = convertToHz(maxFreq, unit);

    // Check for negative frequencies
    if (minHz < 0 || maxHz < 0) {
      errors.push("Negative frequencies are not allowed");
    }

    // Check for zero frequency (0Hz is allowed for RTL-SDR)
    if (minHz === 0 || maxHz === 0) {
      // 0Hz is valid, but range must still be valid
      if (minHz === 0 && maxHz === 0) {
        errors.push("Frequency range cannot be zero width");
      }
    }

    // Check min < max
    if (minHz >= maxHz) {
      errors.push("Minimum frequency must be less than maximum frequency");
    }

    // Check bandwidth doesn't exceed sample rate
    const bandwidth = maxHz - minHz;
    const sampleRate = maxSampleRateHz || 3200000;
    if (bandwidth > sampleRate) {
      errors.push("Bandwidth exceeds sample rate limit");
    }

    // Check device limits (RTL-SDR can tune 0Hz-1766MHz)
    if (maxHz > 1766000000) {
      errors.push("Frequency range outside device capabilities");
    }

    // Check for extremely large values
    if (minHz > 10000000000 || maxHz > 10000000000) { // 10GHz
      errors.push("Frequency exceeds maximum supported value");
    }

    return errors;
  };

  const convertToHz = (freq: number, unit: 'MHz' | 'kHz' | 'Hz'): number => {
    switch (unit) {
      case 'MHz': return freq * 1000000;
      case 'kHz': return freq * 1000;
      case 'Hz': return freq;
      default: return freq;
    }
  };

  const validateAllRanges = (): string[] => {
    const allErrors: string[] = [];

    // Validate each range individually
    frequencyRanges.forEach((range, index) => {
      const errors = validateFrequencyRange(range.minFreq, range.maxFreq, range.unit);
      errors.forEach(error => {
        allErrors.push(`Range ${index + 1}: ${error}`);
      });
    });

    // Check for overlaps between ranges
    for (let i = 0; i < frequencyRanges.length; i++) {
      for (let j = i + 1; j < frequencyRanges.length; j++) {
        const range1 = frequencyRanges[i];
        const range2 = frequencyRanges[j];

        const min1 = convertToHz(range1.minFreq, range1.unit);
        const max1 = convertToHz(range1.maxFreq, range1.unit);
        const min2 = convertToHz(range2.minFreq, range2.unit);
        const max2 = convertToHz(range2.maxFreq, range2.unit);

        if (!(max1 <= min2 || max2 <= min1)) {
          allErrors.push("Frequency ranges cannot overlap");
        }
      }
    }

    return allErrors;
  };

  const handleCapture = () => {
    const errors = validateAllRanges();

    if (errors.length > 0) {
      alert(errors.join("\n"));
      return;
    }

    // Convert ranges to backend format
    const fragments = frequencyRanges.map(range => ({
      minFreq: convertToHz(range.minFreq, range.unit),
      maxFreq: convertToHz(range.maxFreq, range.unit),
    }));

    sendCaptureCommand?.({
      jobId: `freq-test-${Date.now()}`,
      fragments,
      durationS: captureDurationS,
      fileType: captureFileType,
      acquisitionMode,
      encrypted: captureEncrypted,
      fftSize: 1024,
      fftWindow: "Rectangular",
      geolocation: undefined,
    });
  };

  const addFrequencyRange = () => {
    setFrequencyRanges([...frequencyRanges, { minFreq: 100, maxFreq: 103.2, unit: 'MHz' }]);
  };

  const updateFrequencyRange = (index: number, field: 'minFreq' | 'maxFreq' | 'unit', value: number | 'MHz' | 'kHz' | 'Hz') => {
    const newRanges = [...frequencyRanges];
    if (field === 'unit') {
      newRanges[index][field] = value as 'MHz' | 'kHz' | 'Hz';
    } else {
      newRanges[index][field] = value as number;
    }
    setFrequencyRanges(newRanges);
  };

  const removeFrequencyRange = (index: number) => {
    setFrequencyRanges(frequencyRanges.filter((_, i) => i !== index));
  };

  const errors = validateAllRanges();
  const hasErrors = errors.length > 0;

  return (
    <div data-testid="frequency-validation-test">
      <h3>Frequency Validation Integration Test</h3>

      {/* Device Info */}
      {dataRef?.current?.deviceInfo && (
        <div data-testid="device-info">
          Device: {dataRef.current.deviceInfo}
        </div>
      )}

      {/* Frequency Range Inputs */}
      <div data-testid="frequency-ranges">
        {frequencyRanges.map((range, index) => (
          <div key={index} data-testid={`frequency-range-${index}`}>
            <label>
              Min Frequency ({range.unit}):
              <input
                type="number"
                value={range.minFreq}
                onChange={(e) => updateFrequencyRange(index, 'minFreq', parseFloat(e.target.value) || 0)}
                aria-label={`Min Frequency (${range.unit})`}
              />
            </label>

            <label>
              Max Frequency ({range.unit}):
              <input
                type="number"
                value={range.maxFreq}
                onChange={(e) => updateFrequencyRange(index, 'maxFreq', parseFloat(e.target.value) || 0)}
                aria-label={`Max Frequency (${range.unit})`}
              />
            </label>

            <label>
              Frequency Unit:
              <select
                value={range.unit}
                onChange={(e) => updateFrequencyRange(index, 'unit', e.target.value as 'MHz' | 'kHz' | 'Hz')}
                aria-label="Frequency Unit"
              >
                <option value="Hz">Hz</option>
                <option value="kHz">kHz</option>
                <option value="MHz">MHz</option>
              </select>
            </label>

            {frequencyRanges.length > 1 && (
              <button onClick={() => removeFrequencyRange(index)}>Remove</button>
            )}
          </div>
        ))}
      </div>

      {/* Add Range Button */}
      <button onClick={addFrequencyRange} data-testid="add-frequency-range">
        Add Frequency Range
      </button>

      {/* Error Display */}
      {hasErrors && (
        <div data-testid="frequency-errors" style={{ color: 'red' }}>
          {errors.map((error, index) => (
            <div key={index}>{error}</div>
          ))}
        </div>
      )}

      {/* Capture Controls */}
      <div>
        <label>
          Duration (s):
          <input
            type="number"
            value={captureDurationS}
            onChange={(e) => setCaptureDurationS(parseInt(e.target.value) || 1)}
            min="1"
          />
        </label>

        <label>
          File Type:
          <select
            value={captureFileType}
            onChange={(e) => setCaptureFileType(e.target.value as CaptureFileType)}
          >
            <option value=".napt">.napt</option>
            <option value=".wav">.wav</option>
          </select>
        </label>

        <label>
          Acquisition Mode:
          <select
            value={acquisitionMode}
            onChange={(e) => setAcquisitionMode(e.target.value as "stepwise" | "interleaved")}
          >
            <option value="stepwise">Stepwise</option>
            <option value="interleaved">Interleaved</option>
          </select>
        </label>

        <label>
          <input
            type="checkbox"
            checked={captureEncrypted}
            onChange={(e) => setCaptureEncrypted(e.target.checked)}
          />
          Encrypted
        </label>
      </div>

      {/* Capture Button */}
      <button
        onClick={handleCapture}
        disabled={hasErrors || !isConnected}
        data-testid="capture-button"
      >
        Capture
      </button>

      {/* Capture Status */}
      {captureStatus && (
        <div data-testid="capture-status">
          Status: {captureStatus.status}
          {captureStatus.jobId && <span>Job ID: {captureStatus.jobId}</span>}
        </div>
      )}

      {/* Frequency Validation Results */}
      {dataRef?.current?.captureMetadata && (
        <div data-testid="frequency-validation">
          <h4>Capture Frequency Validation</h4>
          {dataRef.current.captureMetadata.frequencies?.map((freq: any, index: number) => (
            <div key={index}>
              Requested: {(freq.min / 1000000).toFixed(2)}MHz - {(freq.max / 1000000).toFixed(2)}MHz
              {freq.actualMin && freq.actualMax && (
                <span>
                  , Actual: {(freq.actualMin / 1000000).toFixed(5)}MHz - {(freq.actualMax / 1000000).toFixed(5)}MHz
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
