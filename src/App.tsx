import React, { useEffect, useState } from "react";
import init, { SDRProcessor } from "sdr_wasm";
import { SpectrumCanvas } from "./SpectrumCanvas";
import { WaterfallCanvas } from "./WaterfallCanvas";

const FFT_SIZE = 1024;

export default function App() {
  const [proc, setProc] = useState<any>();
  const [iq, setIQ] = useState<Float32Array>();
  const [fft, setFFT] = useState<Float32Array>();

  useEffect(() => {
    init().then(() => setProc(new SDRProcessor(FFT_SIZE)));
  }, []);

  const loadIQ = async (f: File) => {
    const buf = await f.arrayBuffer();
    setIQ(new Float32Array(buf));
  };

  const process = () => {
    if (!proc || !iq) return;
    setFFT(proc.process(iq));
  };

  return (
    <div>
      <input type="file" onChange={e => e.target.files && loadIQ(e.target.files[0])} />

      <div>
        Gain <input type="range" min="0" max="5" step="0.01"
          onChange={e => proc.set_gain(+e.target.value)} />
        PPM <input type="number" step="0.01"
          onChange={e => proc.set_ppm(+e.target.value)} />
        <button onClick={process}>Process</button>
      </div>

      <SpectrumCanvas fft={fft} />
      <WaterfallCanvas fftFrame={fft} />
    </div>
  );
}