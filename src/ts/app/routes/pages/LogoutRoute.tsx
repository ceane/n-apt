import React, { useEffect, useCallback, useState, useRef } from "react";
import styled, { keyframes } from "styled-components";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";

const ellipsisWave = keyframes`
  0%, 60%, 100% {
    opacity: 0.55;
    transform: translateY(0);
  }

  30% {
    opacity: 1;
    transform: translateY(-0.22em);
  }
`;

const Page = styled.main`
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
  box-sizing: border-box;
  background: ${(props) => props.theme.background};
  color: ${(props) => props.theme.textPrimary};
`;

const Status = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: center;
  color: ${(props) => props.theme.textPrimary};
  font-family: ${(props) => props.theme.typography.sans};
  font-size: clamp(2rem, 5vw, 6rem);
  font-weight: 600;
  letter-spacing: -0.04em;
  line-height: 1.1;
  text-align: center;
`;

const Ellipsis = styled.span`
  display: inline-flex;
  margin-left: 0.08em;
`;

const Dot = styled.span<{ $delay: number }>`
  display: inline-block;
  animation: ${ellipsisWave} 1.2s ease-in-out infinite;
  animation-delay: ${(props) => props.$delay}s;

  @media (prefers-reduced-motion: reduce) {
    animation: none;
  }
`;

export const LogoutRoute: React.FC = () => {
  const { logout } = useAuthentication();

  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const signOut = useCallback(() => {
    setError(null);
    void logout().catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Unable to log out");
    });
  }, [logout]);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    signOut();
  }, [signOut]);

  return (
    <Page>
      {error ? (
        <div>
          <p role="alert">{error}. Your session has not been cleared.</p>
          <button onClick={signOut}>Retry logout</button>
        </div>
      ) : (
        <Status role="status" aria-live="polite">
          Logging out
          <Ellipsis data-testid="logout-ellipsis" aria-hidden="true">
            <Dot $delay={0}>.</Dot>
            <Dot $delay={0.15}>.</Dot>
            <Dot $delay={0.3}>.</Dot>
          </Ellipsis>
        </Status>
      )}
    </Page>
  );
};

export default LogoutRoute;
