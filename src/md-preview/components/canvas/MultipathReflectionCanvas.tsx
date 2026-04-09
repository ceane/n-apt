import { useEffect, useState } from 'react';

const useTime = (speed = 1) => {
  const [time, setTime] = useState(0);
  useEffect(() => {
    let frame: number;
    let lastTime: number;
    const update = (currentTime: number) => {
      if (lastTime !== undefined) {
        let dt = (currentTime - lastTime) / 1000;
        if (dt > 0.1) dt = 0.1; // Cap dt to 100ms to prevent huge jumps
        if (dt < 0) dt = 0;
        setTime(t => t + dt * speed);
      }
      lastTime = currentTime;
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frame);
  }, [speed]);
  return time;
};

const AnimatedWave = ({ start, end, time, amplitude = 6, frequency = 0.15, color = "#c026d3", speed = 150 }: any) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.sqrt(dx * dx + dy * dy);
  const angle = Math.atan2(dy, dx);

  const packetSpacing = 200; // Distance between packets
  const packetLength = 100;

  const numPackets = Math.ceil((distance + packetLength) / packetSpacing) + 1;

  const packets = [];
  for (let p = 0; p < numPackets; p++) {
    const offset = p * packetSpacing;
    const arrowDist = ((time * speed) + offset) % (distance + packetSpacing);

    if (arrowDist > 0 && arrowDist - packetLength < distance) {
      const actualHead = Math.min(distance, arrowDist);
      const actualTail = Math.max(0, arrowDist - packetLength);

      if (actualHead > actualTail) {
        const waveEnd = Math.max(actualTail, actualHead - 10); // Gap for arrow
        const steps = Math.max(2, Math.ceil((waveEnd - actualTail) / 2));
        const points = [];

        for (let i = 0; i <= steps; i++) {
          const t = actualTail + (i / steps) * (waveEnd - actualTail);
          const envelope = Math.min(1, (t - actualTail) / 10, (waveEnd - t) / 10);
          const yPrime = Math.sin(t * frequency - time * 15) * amplitude * envelope;

          const x = start.x + t * Math.cos(angle) - yPrime * Math.sin(angle);
          const y = start.y + t * Math.sin(angle) + yPrime * Math.cos(angle);
          points.push(`${x},${y}`);
        }

        packets.push({
          pathData: points.length > 0 ? `M ${points.join(' L ')}` : '',
          headX: start.x + actualHead * Math.cos(angle),
          headY: start.y + actualHead * Math.sin(angle),
          showArrow: actualHead < distance && actualHead > 0
        });
      }
    }
  }

  return (
    <g>
      <line
        x1={start.x} y1={start.y}
        x2={end.x} y2={end.y}
        stroke={color}
        strokeWidth="1"
        opacity="0.3"
      />
      {packets.map((pkt, idx) => (
        <g key={idx}>
          {pkt.pathData && <path d={pkt.pathData} fill="none" stroke={color} strokeWidth="2" />}
          {pkt.showArrow && (
            <g transform={`translate(${pkt.headX}, ${pkt.headY}) rotate(${(angle * 180) / Math.PI})`}>
              <path d="M -8 -5 L 2 0 L -8 5 z" fill={color} />
            </g>
          )}
        </g>
      ))}
    </g>
  );
};

const PulsingNode = ({ x, y, label, sublabel, time }: any) => {
  const radius1 = (time * 15) % 40;
  const radius2 = (time * 15 + 20) % 40;

  return (
    <g>
      <circle cx={x} cy={y} r={10 + radius1} fill="none" stroke="#94a3b8" strokeWidth="2" opacity={1 - radius1 / 40} />
      <circle cx={x} cy={y} r={10 + radius2} fill="none" stroke="#94a3b8" strokeWidth="2" opacity={1 - radius2 / 40} />
      <circle cx={x} cy={y} r="12" fill="#3b82f6" />
      <text x={x} y={y + 50} textAnchor="middle" className="font-bold text-3xl fill-slate-800">{label}</text>
      {sublabel && (
        <text x={x} y={y + 75} textAnchor="middle" className="text-sm fill-slate-600 font-mono">{sublabel}</text>
      )}
    </g>
  );
};

export default function MultipathReflectionCanvas() {
  const time = useTime(1);

  return (
    <div className="w-full h-full bg-[#E0E0E2] rounded-lg overflow-hidden">
      <div className="w-full h-full">
        <canvas aria-hidden="true" style={{ display: 'none' }} />
        <svg viewBox="0 0 900 600" className="w-full h-auto block">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#DBDCDE" strokeWidth="1" />
            </pattern>
          </defs>

          {/* Grid */}
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Title */}
          <text x="40" y="50" className="text-2xl font-mono font-bold fill-slate-800">Multipath</text>

          {/* Obstacle */}
          <rect x="540" y="180" width="100" height="240" fill="#cbd5e1" rx="4" />
          <text x="590" y="305" textAnchor="middle" className="text-sm font-mono fill-slate-500">Obstacle</text>

          {/* Reflectors */}
          <line x1="520" y1="90" x2="660" y2="90" stroke="#94a3b8" strokeWidth="8" strokeLinecap="round" />
          <text x="680" y="95" className="text-sm font-mono fill-slate-500">Reflection</text>

          <line x1="520" y1="510" x2="660" y2="510" stroke="#94a3b8" strokeWidth="8" strokeLinecap="round" />
          <text x="680" y="515" className="text-sm font-mono fill-slate-500">Reflection</text>

          {/* Target */}
          <circle cx="300" cy="300" r="45" fill="#d1d5db" />
          <text x="300" y="235" textAnchor="middle" className="font-bold text-xl fill-slate-700">Target</text>

          {/* Waves */}
          <AnimatedWave start={{ x: 115, y: 300 }} end={{ x: 250, y: 300 }} time={time} color="#c026d3" />

          {/* Fan waves hitting the obstacle */}
          <AnimatedWave start={{ x: 339, y: 277 }} end={{ x: 540, y: 220 }} time={time} color="#c026d3" />
          <AnimatedWave start={{ x: 345, y: 300 }} end={{ x: 540, y: 300 }} time={time} color="#c026d3" />
          <AnimatedWave start={{ x: 339, y: 323 }} end={{ x: 540, y: 380 }} time={time} color="#c026d3" />

          {/* Reflected waves */}
          <AnimatedWave start={{ x: 335, y: 265 }} end={{ x: 590, y: 90 }} time={time} color="#c026d3" />
          <AnimatedWave start={{ x: 590, y: 90 }} end={{ x: 785, y: 285 }} time={time} color="#c026d3" />

          <AnimatedWave start={{ x: 335, y: 335 }} end={{ x: 590, y: 510 }} time={time} color="#c026d3" />
          <AnimatedWave start={{ x: 590, y: 510 }} end={{ x: 785, y: 315 }} time={time} color="#c026d3" />

          {/* Nodes */}
          <PulsingNode x={100} y={300} label="Tx" sublabel="(transmitter / source)" time={time} />
          <PulsingNode x={800} y={300} label="Rx" sublabel="(receiver / destination)" time={time} />

        </svg>
      </div>
    </div>
  );
}
