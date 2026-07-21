// @ts-nocheck
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { TriangleLattice } from "./TriangleLattice";

export function IntroView({ onComplete }: { onComplete: () => void }) {
  const [hexBytes, setHexBytes] = useState<Array<{ id: number; value: string; x: number; y: number }>>([]);

  useEffect(() => {
    const bytes = Array.from({ length: 30 }, (_, i) => ({
      id: i,
      value: Math.floor(Math.random() * 256).toString(16).padStart(2, '0').toUpperCase(),
      x: Math.random() * 100,
      y: Math.random() * 100,
    }));
    setHexBytes(bytes);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      onComplete();
    }, 5000);
    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-background">
      {/* Triangle lattice background */}
      <TriangleLattice />

      {/* Sine waves */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-8">
        {[0, 1, 2].map((waveIndex) => (
          <svg
            key={waveIndex}
            className="w-full h-24"
            viewBox="0 0 1000 100"
            preserveAspectRatio="none"
          >
            <motion.path
              d="M0,50 Q125,0 250,50 T500,50 T750,50 T1000,50"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              className={waveIndex === 0 ? 'text-foreground opacity-60' : waveIndex === 1 ? 'text-muted-foreground opacity-50' : 'text-foreground opacity-40'}
              animate={{
                d: [
                  "M0,50 Q125,0 250,50 T500,50 T750,50 T1000,50",
                  "M0,50 Q125,100 250,50 T500,50 T750,50 T1000,50",
                  "M0,50 Q125,0 250,50 T500,50 T750,50 T1000,50",
                ],
              }}
              transition={{
                duration: 3 + waveIndex * 0.5,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          </svg>
        ))}
      </div>

      {/* Flowing hex bytes */}
      {hexBytes.map((byte, index) => (
        <motion.div
          key={byte.id}
          className="absolute text-muted-foreground font-mono text-sm"
          style={{ left: `${byte.x}%`, top: `${byte.y}%` }}
          initial={{ opacity: 0 }}
          animate={{
            x: [0, 200],
            y: [
              0,
              40 * Math.sin((index * Math.PI) / 6),
              0,
            ],
            opacity: [0, 0.7, 0],
          }}
          transition={{
            duration: 4 + (index % 3),
            repeat: Infinity,
            ease: "linear",
            delay: index * 0.1,
          }}
        >
          0x{byte.value}
        </motion.div>
      ))}

      {/* Title */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center"
        initial={{ opacity: 0, scale: 0.8 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1, delay: 0.5 }}
      >
        <h1 className="text-6xl font-bold text-foreground mb-4">Signal Processing</h1>
        <p className="text-xl text-muted-foreground">Exploring the fundamentals of radio and digital signals</p>
      </motion.div>

      {/* Skip button */}
      <motion.button
        className="absolute bottom-8 right-8 px-6 py-3 bg-primary text-primary-foreground hover:bg-primary/90 rounded-lg transition-colors"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 2 }}
        onClick={onComplete}
      >
        Skip Intro
      </motion.button>
    </div>
  );
}
