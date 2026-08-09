import React, { useEffect, useState } from "react";
import styled from "styled-components";
import { useAuthentication } from "@n-apt/app/hooks/useAuthentication";
import { clearSession, logoutSession } from "@n-apt/app/infrastructure/services/auth";

const Page = styled.div`
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
`;

const Panel = styled.div`
  width: min(520px, 100%);
  padding: 24px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(12, 14, 18, 0.92);
  color: #e8e8ea;
  border-radius: 8px;
  font-size: 14px;
  line-height: 1.5;
`;

export const LogoutRoute: React.FC = () => {
  const { sessionToken } = useAuthentication();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (!sessionToken) {
        clearSession();
        window.location.replace("/");
        return;
      }

      try {
        void logoutSession(sessionToken).catch((err) => {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "logout failed");
          }
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "logout failed");
        }
      }

      clearSession();
      window.location.replace("/");
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [sessionToken]);

  return (
    <Page>
      <Panel>{error ? error : "Logging out..."}</Panel>
    </Page>
  );
};

export default LogoutRoute;
