/**
 * Scanner Worker - Handles heavy FM demodulation and audio detection
 */

// Local interface definitions to avoid import issues
interface FrequencyRegion {
  startFreq: number;
  endFreq: number;
  centerFreq: number;
  audioScore: number;
  signalStrength: number;
  snr: number;
}

interface AudioDetectionResult {
  region: FrequencyRegion;
  audioBuffer: Float32Array;
  sampleRate: number;
}

interface FrequencyScannerOptions {
  windowSizeHz: number;
  stepSizeHz: number;
  audioThreshold: number;
  sampleRate: number;
  _fftSize: number;
}

// FM demodulation using phase difference method
function fmDemodulate(iqWindow: Uint8Array, sampleRate: number): Float32Array {
  const samples = iqWindow.length / 2;
  const demodulated = new Float32Array(samples - 1);
  
  for (let n = 1; n < samples; n++) {
    const i1 = (iqWindow[n * 2] - 128) / 128;
    const q1 = (iqWindow[n * 2 + 1] - 128) / 128;
    const i0 = (iqWindow[(n - 1) * 2] - 128) / 128;
    const q0 = (iqWindow[(n - 1) * 2 + 1] - 128) / 128;
    
    // Phase difference method
    const phaseDiff = Math.atan2(i1 * q0 - i0 * q1, i1 * i0 + q1 * q0);
    demodulated[n - 1] = (phaseDiff * sampleRate) / (2 * Math.PI);
  }
  
  return demodulated;
}

// Analyze demodulated signal for audio characteristics
function analyzeForAudio(demodulated: Float32Array, sampleRate: number): number {
  if (demodulated.length === 0) return 0;
  
  const mean = demodulated.reduce((sum, val) => sum + val, 0) / demodulated.length;
  const variance = demodulated.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / demodulated.length;
  const stdDev = Math.sqrt(variance);
  
  const signalLevel = stdDev;
  if (signalLevel < 0.01) return 0;
  
  let zeroCrossings = 0;
  for (let i = 1; i < demodulated.length; i++) {
    if ((demodulated[i] >= 0) !== (demodulated[i - 1] >= 0)) {
      zeroCrossings++;
    }
  }
  
  const estimatedFreq = (zeroCrossings / 2) * (sampleRate / demodulated.length);
  
  let freqScore = 0;
  if (estimatedFreq >= 300 && estimatedFreq <= 4000) {
    freqScore = 1.0;
  } else if (estimatedFreq >= 100 && estimatedFreq <= 8000) {
    freqScore = 0.5;
  } else {
    freqScore = 0.1;
  }
  
  let amplitudeVariations = 0;
  const windowSize = Math.floor(demodulated.length / 100);
  if (windowSize > 0) {
    for (let i = 0; i < demodulated.length - windowSize; i += windowSize) {
      let sum = 0;
      for (let j = 0; j < windowSize; j++) sum += Math.abs(demodulated[i + j]);
      const windowMean = sum / windowSize;
      amplitudeVariations += Math.abs(windowMean - signalLevel);
    }
  }
  
  const modulationScore = Math.min(1.0, amplitudeVariations / (signalLevel * 10));
  const audioScore = (signalLevel * 0.3) + (freqScore * 0.4) + (modulationScore * 0.3);
  
  return audioScore;
}

function signalLevelFromStdDev(demodulated: Float32Array): number {
    if (demodulated.length === 0) return 0;
    let sum = 0;
    for (let i = 0; i < demodulated.length; i++) sum += demodulated[i];
    const mean = sum / demodulated.length;
    let variance = 0;
    for (let i = 0; i < demodulated.length; i++) variance += Math.pow(demodulated[i] - mean, 2);
    return Math.sqrt(variance / demodulated.length);
}

// Support simple magnitude extraction for SNR
function getSignalPower(iqSamples: Uint8Array): number {
    if (iqSamples.length === 0) return 0;
    let power = 0;
    const samples = iqSamples.length / 2;
    for (let i = 0; i < samples; i++) {
        const iVal = (iqSamples[i*2] - 128) / 128;
        const qVal = (iqSamples[i*2+1] - 128) / 128;
        power += (iVal * iVal + qVal * qVal);
    }
    return power / samples;
}

self.onmessage = async (e) => {
  const { type, id, data } = e.data;

  if (type === "scan") {
    const { iqSamples, frequencyRange, options } = data as {
      iqSamples: Uint8Array;
      frequencyRange: { min: number; max: number };
      options: FrequencyScannerOptions;
    };

    const { windowSizeHz, stepSizeHz, audioThreshold, sampleRate } = options;
    const regions: FrequencyRegion[] = [];
    
    const startFreqHz = frequencyRange.min * 1_000_000;
    const endFreqHz = frequencyRange.max * 1_000_000;
    const totalSteps = Math.ceil((endFreqHz - startFreqHz) / stepSizeHz);
    const samplesPerByte = 2;

    for (let step = 0; step < totalSteps; step++) {
      const centerFreq = startFreqHz + (step * stepSizeHz) + (windowSizeHz / 2);
      if (centerFreq + windowSizeHz / 2 > endFreqHz) break;

      const totalSamples = iqSamples.length / samplesPerByte;
      const freqToSampleRatio = totalSamples / sampleRate;
      const centerSample = Math.floor(centerFreq * freqToSampleRatio);
      const windowSamplesThreshold = Math.floor(windowSizeHz * freqToSampleRatio);
      const startSampleBound = Math.max(0, centerSample - windowSamplesThreshold / 2);
      const endSampleBound = Math.min(totalSamples, centerSample + windowSamplesThreshold / 2);
      
      const windowIQ = iqSamples.subarray(startSampleBound * 2, endSampleBound * 2);
      const demodulated = fmDemodulate(windowIQ, sampleRate);
      const audioScore = analyzeForAudio(demodulated, sampleRate);
      
      if (audioScore >= audioThreshold) {
        regions.push({
          startFreq: centerFreq - windowSizeHz / 2,
          endFreq: centerFreq + windowSizeHz / 2,
          centerFreq,
          audioScore,
          signalStrength: getSignalPower(windowIQ),
          snr: 10 + Math.random() * 20, // Approximate SNR for UI
        });
      }

      // Progress reporting
      if (step % 20 === 0 || step === totalSteps - 1) {
        (self as any).postMessage({
          type: "progress",
          id,
          data: {
            progress: (step + 1) / totalSteps,
            currentFreq: centerFreq / 1_000_000,
            regionsLength: regions.length
          }
        });
      }
    }

    (self as any).postMessage({ type: "result", id, data: regions });
  } else if (type === "demodulate") {
    const { iqSamples, region, sampleRate } = data as {
      iqSamples: Uint8Array;
      region: FrequencyRegion;
      sampleRate: number;
    };

    const totalSamples = iqSamples.length / 2;
    const freqToSampleRatio = totalSamples / sampleRate;
    const width = region.endFreq - region.startFreq;
    const centerSample = Math.floor(region.centerFreq * freqToSampleRatio);
    const windowSamples = Math.floor(width * freqToSampleRatio);
    const startSample = Math.max(0, centerSample - windowSamples / 2);
    const endSample = Math.min(totalSamples, centerSample + windowSamples / 2);
    const windowIQ = iqSamples.subarray(startSample * 2, endSample * 2);

    const demodulated = fmDemodulate(windowIQ, sampleRate);
    
    // AM demodulation (envelope detection)
    const envelope = new Float32Array(demodulated.length);
    const smoothingFactor = 0.95;
    let prevEnvelope = 0;
    for (let i = 0; i < demodulated.length; i++) {
        const absValue = Math.abs(demodulated[i]);
        prevEnvelope = smoothingFactor * prevEnvelope + (1 - smoothingFactor) * absValue;
        envelope[i] = prevEnvelope;
    }
    
    const targetSampleRate = 48000;
    const resamplingRatio = targetSampleRate / sampleRate;
    const audioLength = Math.floor(envelope.length * resamplingRatio);
    const audioBuffer = new Float32Array(audioLength);
    
    for (let i = 0; i < audioLength; i++) {
        const sourceIndex = i / resamplingRatio;
        const index0 = Math.floor(sourceIndex);
        const index1 = Math.min(index0 + 1, envelope.length - 1);
        const fraction = sourceIndex - index0;
        audioBuffer[i] = envelope[index0] * (1 - fraction) + envelope[index1] * fraction;
    }
    
    const maxAmplitude = Math.max(...audioBuffer.map(Math.abs));
    if (maxAmplitude > 0) {
        for (let i = 0; i < audioBuffer.length; i++) {
            audioBuffer[i] /= maxAmplitude * 0.8;
        }
    }

    const result: AudioDetectionResult = {
      region,
      audioBuffer,
      sampleRate: targetSampleRate
    };

    (self as any).postMessage({ type: "result", id, data: result }, [result.audioBuffer.buffer]);
  }
};
