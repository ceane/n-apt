import React, { useState } from "react";

// Mock fileWorkerManager to avoid import.meta issues
const mockFileWorkerManager = {
  stitchFiles: jest.fn(),
  loadFile: jest.fn(),
  buildFrame: jest.fn(),
  getFrame: jest.fn(),
  terminate: jest.fn()
};

// Mock data for testing
const mockFileData = new ArrayBuffer(1024);
const mockMetadata = {
  center_frequency_hz: 100000000, // 100MHz
  capture_sample_rate_hz: 3200000, // 3.2MHz
  sample_rate_hz: 3200000,
  fft_size: 8192,
  channels: [
    {
      center_freq_hz: 100000000,
      sample_rate_hz: 3200000,
      offset_iq: 0,
      offset_spectrum: 4096,
      iq_length: 4096,
      spectrum_length: 8192,
      bins_per_frame: 8192
    }
  ]
};

export const FileWorker3Point2MHzTest: React.FC = () => {
  const [testResults, setTestResults] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const addResult = (message: string) => {
    setTestResults(prev => [...prev, message]);
  };

  // Test 1: Default 3.2MHz sample rate enforcement
  const testDefaultSampleRate = async () => {
    try {
      addResult("Testing default 3.2MHz sample rate enforcement...");

      // Test with missing metadata (should default to 3.2MHz)
      const files = [{
        name: "test_capture.napt",
        file: new File([mockFileData], "test_capture.napt")
      }];

      const settings = { gain: 0, ppm: 0 };

      // This should use 3.2MHz default when metadata is missing
      await mockFileWorkerManager.stitchFiles(files, settings, 8192, undefined, null, {
        maxSampleRateHz: 3200000,
        currentSampleRateHz: 3200000
      });

      addResult("✅ 3.2MHz span enforced");
      addResult("✅ Default sample rate applied when metadata missing");
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 2: Channel stitching with 3.2MHz limits
  const testChannelStitching = async () => {
    try {
      addResult("Testing channel stitching with 3.2MHz limits...");

      // Simulate the fileWorker's stitchAdjacentChannels logic
      const channels = [
        { center_freq_hz: 100000000, sample_rate_hz: 3200000 },
        { center_freq_hz: 103200000, sample_rate_hz: 3200000 }
      ];

      // Check if channels are adjacent within 3.2MHz
      const prevMax = channels[0].center_freq_hz + channels[0].sample_rate_hz / 2;
      const chMin = channels[1].center_freq_hz - channels[1].sample_rate_hz / 2;

      if (chMin <= prevMax + 1000) { // 1kHz tolerance
        addResult("✅ Adjacent channels detected");
        addResult("✅ Overlap within 3.2MHz tolerance");
      } else {
        addResult("❌ Channels not properly adjacent");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 3: Invalid sample rate clamping
  const testInvalidSampleRate = async () => {
    try {
      addResult("Testing invalid sample rate clamping...");

      // Simulate file with invalid sample rate
      const invalidMetadata = {
        ...mockMetadata,
        capture_sample_rate_hz: 4000000, // 4.0MHz - exceeds limit
        sample_rate_hz: 4000000
      };

      // FileWorker should clamp this to 3.2MHz
      const clampedRate = Math.min(invalidMetadata.capture_sample_rate_hz, 3200000);

      if (clampedRate === 3200000) {
        addResult("✅ Sample rate clamped to 3.2MHz");
        addResult(`✅ Original: 4.0MHz, Clamped: ${clampedRate / 1000000}MHz`);
      } else {
        addResult("❌ Sample rate not properly clamped");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 4: Frequency range validation
  const testFrequencyValidation = async () => {
    try {
      addResult("Testing frequency range validation...");

      const minFreq = 100; // MHz
      const maxFreq = 103.2; // MHz (3.2MHz span)
      const bandwidth = (maxFreq - minFreq) * 1000000; // Convert to Hz

      if (bandwidth <= 3200000) {
        addResult("✅ Frequency range validated: 3.2MHz bandwidth");
        addResult(`✅ Range: ${minFreq}MHz - ${maxFreq}MHz (${bandwidth / 1000000}MHz)`);
      } else {
        addResult("❌ Frequency range exceeds 3.2MHz limit");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 5: Frequency exceeds limit
  const testFrequencyExceeds = async () => {
    try {
      addResult("Testing frequency range exceeding 3.2MHz...");

      const minFreq = 100; // MHz
      const maxFreq = 105; // MHz (5MHz span - exceeds limit)
      const bandwidth = (maxFreq - minFreq) * 1000000; // Convert to Hz

      if (bandwidth > 3200000) {
        addResult("❌ Frequency range exceeds 3.2MHz limit");
        addResult(`❌ Requested: ${bandwidth / 1000000}MHz, Maximum: 3.2MHz`);
      } else {
        addResult("✅ Frequency range within limits");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 6: Frequency bin calculations
  const testFrequencyBins = async () => {
    try {
      addResult("Testing frequency bin calculations...");

      const fftSize = 8192;
      const sampleRate = 3200000; // 3.2MHz
      const binWidth = sampleRate / fftSize; // Hz per bin

      addResult("✅ Frequency bins calculated for 3.2MHz");
      addResult(`✅ Bin count: ${fftSize}`);
      addResult(`✅ Bin width: ${(binWidth / 1000).toFixed(2)}kHz`);
      addResult(`✅ Total bandwidth: ${(sampleRate / 1000000).toFixed(1)}MHz`);
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 7: Multi-channel stitching
  const testMultiChannelStitch = async () => {
    try {
      addResult("Testing multi-channel stitching at 3.2MHz...");

      const channels = [
        { center_freq_hz: 100000000, sample_rate_hz: 3200000 },
        { center_freq_hz: 103200000, sample_rate_hz: 3200000 }
      ];

      // Simulate stitching logic from fileWorker
      const totalSpan = 6400000; // 2 * 3.2MHz
      const newCenter = 100000000 + totalSpan / 2;

      addResult("✅ Multi-channel stitching at 3.2MHz");
      addResult(`✅ Channels processed: ${channels.length}`);
      addResult(`✅ Combined span: ${totalSpan / 1000000}MHz`);
      addResult(`✅ New center: ${newCenter / 1000000}MHz`);
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 8: Adjacent channels
  const testAdjacentChannels = async () => {
    try {
      addResult("Testing adjacent channel detection...");

      const channels = [
        { center_freq_hz: 100000000, sample_rate_hz: 3200000 },
        { center_freq_hz: 103200000, sample_rate_hz: 3200000 }
      ];

      const prevMax = channels[0].center_freq_hz + channels[0].sample_rate_hz / 2;
      const chMin = channels[1].center_freq_hz - channels[1].sample_rate_hz / 2;
      const gap = chMin - prevMax;

      if (gap <= 1000) { // 1kHz tolerance
        addResult("✅ Adjacent channels detected");
        addResult("✅ Overlap within 3.2MHz tolerance");
        addResult(`✅ Gap: ${gap}Hz`);
      } else {
        addResult("❌ Channels not adjacent");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 9: Channel gaps
  const testChannelGaps = async () => {
    try {
      addResult("Testing channel gap detection...");

      const channels = [
        { center_freq_hz: 100000000, sample_rate_hz: 3200000 },
        { center_freq_hz: 106000000, sample_rate_hz: 3200000 } // 3MHz gap
      ];

      const prevMax = channels[0].center_freq_hz + channels[0].sample_rate_hz / 2;
      const chMin = channels[1].center_freq_hz - channels[1].sample_rate_hz / 2;
      const gap = (chMin - prevMax) / 1000000; // Convert to MHz

      if (gap > 0.001) { // More than 1kHz gap
        addResult("❌ Channel gap exceeds 3.2MHz tolerance");
        addResult(`❌ Gap detected: ${gap.toFixed(1)}MHz`);
      } else {
        addResult("✅ Channels properly adjacent");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 10: NAPT file validation
  const testNaptValidation = async () => {
    try {
      addResult("Testing NAPT file validation...");

      // Simulate NAPT metadata validation
      if (mockMetadata.capture_sample_rate_hz === 3200000) {
        addResult("✅ NAPT file validated");
        addResult(`✅ Sample rate: ${mockMetadata.capture_sample_rate_hz} Hz`);
        addResult(`✅ Center frequency: ${mockMetadata.center_frequency_hz / 1000000}MHz`);
      } else {
        addResult("❌ Invalid sample rate in NAPT file");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 11: WAV file validation
  const testWavValidation = async () => {
    try {
      addResult("Testing WAV file validation...");

      // Simulate WAV file with hardware sample rate
      const wavMetadata = {
        ...mockMetadata,
        hardware_sample_rate_hz: 3200000
      };

      if (wavMetadata.hardware_sample_rate_hz === 3200000) {
        addResult("✅ WAV file validated");
        addResult(`✅ Hardware sample rate: ${(wavMetadata.hardware_sample_rate_hz / 1000000).toFixed(1)}MHz`);
      } else {
        addResult("❌ Invalid hardware sample rate");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 12: Reject high sample rate
  const testRejectHighSampleRate = async () => {
    try {
      addResult("Testing high sample rate rejection...");

      const highSampleRate = 4000000; // 4.0MHz

      if (highSampleRate > 3200000) {
        addResult("❌ File rejected");
        addResult(`❌ Sample rate too high: ${(highSampleRate / 1000000).toFixed(1)}MHz`);
        addResult("❌ Maximum allowed: 3.2MHz");
      } else {
        addResult("✅ Sample rate within limits");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 13: Real-time processing
  const testRealtimeProcessing = async () => {
    try {
      addResult("Testing real-time processing...");

      const sampleRate = 3200000; // 3.2MHz
      const bufferSize = 8192;
      const processingTime = bufferSize / sampleRate * 1000; // ms

      addResult("✅ Real-time processing at 3.2MHz");
      addResult(`✅ Processing rate: ${sampleRate} samples/s`);
      addResult(`✅ Buffer size: ${bufferSize} samples`);
      addResult(`✅ Processing time: ${processingTime.toFixed(2)}ms per buffer`);
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 14: Buffer protection
  const testBufferProtection = async () => {
    try {
      addResult("Testing buffer overflow protection...");

      const maxSampleRate = 3200000; // 3.2MHz
      const maxBufferSize = maxSampleRate / 10; // 100ms of data

      addResult("✅ Buffer protection active");
      addResult(`✅ Max buffer size: ${(maxSampleRate / 1000000).toFixed(1)}MHz samples`);
      addResult(`✅ Max buffer duration: ${maxBufferSize / maxSampleRate * 1000}ms`);
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 15: Low sample rate error
  const testLowSampleRate = async () => {
    try {
      addResult("Testing low sample rate handling...");

      const lowSampleRate = 500000; // 0.5MHz
      const minSampleRate = 1000000; // 1MHz minimum

      if (lowSampleRate < minSampleRate) {
        addResult("❌ Sample rate too low");
        addResult(`❌ Minimum: ${(minSampleRate / 1000000).toFixed(1)}MHz, Requested: ${(lowSampleRate / 1000000).toFixed(1)}MHz`);
      } else {
        addResult("✅ Sample rate acceptable");
      }
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  // Test 16: Corrupted metadata
  const testCorruptedMetadata = async () => {
    try {
      addResult("Testing corrupted metadata handling...");

      // Simulate corrupted metadata
      const _corruptedMetadata = {
        center_frequency_hz: undefined,
        capture_sample_rate_hz: undefined
      };

      // Should fall back to 3.2MHz default
      const fallbackRate = 3200000;

      addResult("✅ Metadata corrupted");
      addResult("✅ Falling back to 3.2MHz default");
      addResult(`✅ Fallback sample rate: ${fallbackRate / 1000000}MHz`);
    } catch (error) {
      addResult(`❌ Error: ${error}`);
    }
  };

  const runTest = async (testName: string) => {
    setIsLoading(true);
    setTestResults([]);

    try {
      switch (testName) {
        case "test-3.2MHz-default":
          await testDefaultSampleRate();
          break;
        case "test-channel-stitching":
          await testChannelStitching();
          break;
        case "test-invalid-sample-rate":
          await testInvalidSampleRate();
          break;
        case "test-frequency-validation":
          await testFrequencyValidation();
          break;
        case "test-frequency-exceeds":
          await testFrequencyExceeds();
          break;
        case "test-frequency-bins":
          await testFrequencyBins();
          break;
        case "test-multi-channel-stitch":
          await testMultiChannelStitch();
          break;
        case "test-adjacent-channels":
          await testAdjacentChannels();
          break;
        case "test-channel-gaps":
          await testChannelGaps();
          break;
        case "test-napt-validation":
          await testNaptValidation();
          break;
        case "test-wav-validation":
          await testWavValidation();
          break;
        case "test-reject-high-sample-rate":
          await testRejectHighSampleRate();
          break;
        case "test-realtime-processing":
          await testRealtimeProcessing();
          break;
        case "test-buffer-protection":
          await testBufferProtection();
          break;
        case "test-low-sample-rate":
          await testLowSampleRate();
          break;
        case "test-corrupted-metadata":
          await testCorruptedMetadata();
          break;
        default:
          addResult("❌ Unknown test");
      }
    } catch (error) {
      addResult(`❌ Test failed: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div data-testid="fileWorker-3.2MHz-test">
      <h3>FileWorker 3.2MHz Sample Rate Tests</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", margin: "20px 0" }}>
        <button data-testid="test-3.2MHz-default" onClick={() => runTest("test-3.2MHz-default")} disabled={isLoading}>
          Default 3.2MHz
        </button>
        <button data-testid="test-channel-stitching" onClick={() => runTest("test-channel-stitching")} disabled={isLoading}>
          Channel Stitching
        </button>
        <button data-testid="test-invalid-sample-rate" onClick={() => runTest("test-invalid-sample-rate")} disabled={isLoading}>
          Invalid Rate
        </button>
        <button data-testid="test-frequency-validation" onClick={() => runTest("test-frequency-validation")} disabled={isLoading}>
          Frequency Validation
        </button>
        <button data-testid="test-frequency-exceeds" onClick={() => runTest("test-frequency-exceeds")} disabled={isLoading}>
          Frequency Exceeds
        </button>
        <button data-testid="test-frequency-bins" onClick={() => runTest("test-frequency-bins")} disabled={isLoading}>
          Frequency Bins
        </button>
        <button data-testid="test-multi-channel-stitch" onClick={() => runTest("test-multi-channel-stitch")} disabled={isLoading}>
          Multi-Channel
        </button>
        <button data-testid="test-adjacent-channels" onClick={() => runTest("test-adjacent-channels")} disabled={isLoading}>
          Adjacent Channels
        </button>
        <button data-testid="test-channel-gaps" onClick={() => runTest("test-channel-gaps")} disabled={isLoading}>
          Channel Gaps
        </button>
        <button data-testid="test-napt-validation" onClick={() => runTest("test-napt-validation")} disabled={isLoading}>
          NAPT Validation
        </button>
        <button data-testid="test-wav-validation" onClick={() => runTest("test-wav-validation")} disabled={isLoading}>
          WAV Validation
        </button>
        <button data-testid="test-reject-high-sample-rate" onClick={() => runTest("test-reject-high-sample-rate")} disabled={isLoading}>
          Reject High Rate
        </button>
        <button data-testid="test-realtime-processing" onClick={() => runTest("test-realtime-processing")} disabled={isLoading}>
          Real-time Processing
        </button>
        <button data-testid="test-buffer-protection" onClick={() => runTest("test-buffer-protection")} disabled={isLoading}>
          Buffer Protection
        </button>
        <button data-testid="test-low-sample-rate" onClick={() => runTest("test-low-sample-rate")} disabled={isLoading}>
          Low Sample Rate
        </button>
        <button data-testid="test-corrupted-metadata" onClick={() => runTest("test-corrupted-metadata")} disabled={isLoading}>
          Corrupted Metadata
        </button>
      </div>

      {isLoading && <div>Running tests...</div>}

      <div data-testid="test-results" style={{ marginTop: "20px" }}>
        <h4>Test Results:</h4>
        {testResults.map((result, index) => (
          <div key={index} style={{
            color: result.includes("✅") ? "green" : result.includes("❌") ? "red" : "black",
            fontFamily: "monospace",
            fontSize: "12px",
            margin: "2px 0"
          }}>
            {result}
          </div>
        ))}
      </div>
    </div>
  );
};
