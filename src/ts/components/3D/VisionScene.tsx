import React, { useState, useEffect } from "react";
import styled from "styled-components";
import { createPortal } from "react-dom";

const FullscreenOverlay = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background-color: #ff0000;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 9999;
  color: white;
  font-family: "JetBrains Mono", monospace;
`;

const Timer = styled.div`
  font-size: 120px;
  font-weight: 800;
  margin-bottom: 24px;
  text-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
`;

const Label = styled.div`
  font-size: 24px;
  text-transform: uppercase;
  letter-spacing: 4px;
  opacity: 0.8;
`;

export const VisionScene: React.FC<{ session: any }> = ({ session }) => {
  const [captureTime, setCaptureTime] = useState(5);

  useEffect(() => {
    if (session.state === 'capturing' && (!session.countdown || session.countdown === 0)) {
      const timer = setInterval(() => {
        setCaptureTime((prev) => Math.max(0, prev - 1));
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [session.state, session.countdown]);

  return createPortal(
    <FullscreenOverlay>
      {session.countdown && session.countdown > 0 ? (
        <>
          <Timer>{session.countdown}</Timer>
          <Label>Preparing Vision Baseline...</Label>
        </>
      ) : (
        <>
          <Timer>{captureTime}</Timer>
          <Label>Capturing Visual Scene</Label>
        </>
      )}
    </FullscreenOverlay>,
    document.body
  );
};

export default VisionScene;
