import React from "react";
import styled from "styled-components";
import {
  ShieldAlert,
  Terminal,
  HelpCircle,
  RefreshCcw,
  Shield,
} from "lucide-react";
import { useAuthentication } from "../../hooks/useAuthentication";
import { Button } from "@n-apt/components/ui";

const FallbackContainer = styled.div`
  grid-column: 1 / -1;
  padding: 16px;
  background: ${(props) =>
    props.theme.mode === "light"
      ? "linear-gradient(180deg, rgba(255, 68, 68, 0.05), rgba(255, 68, 68, 0.02))"
      : "rgba(255, 68, 68, 0.05)"};
  border: 1px dashed
    ${(props) =>
      props.theme.mode === "light"
        ? "rgba(214, 54, 54, 0.28)"
        : "rgba(255, 68, 68, 0.2)"};
  border-radius: 8px;
  color: ${(props) =>
    props.theme.danger || props.theme.colors?.danger || "#ff6666"};
  font-family: "JetBrains Mono", monospace;
  font-size: 12px;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  min-width: 0;
  box-sizing: border-box;
`;

const Header = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  color: ${(props) =>
    props.theme.danger || props.theme.colors?.danger || "#ff4444"};
`;

const Title = styled.div`
  font-weight: bold;
  text-transform: uppercase;
  letter-spacing: 1px;
`;

const Message = styled.div`
  opacity: 0.9;
  font-size: 11px;
  line-height: 1.5;
  color: ${(props) =>
    props.theme.textSecondary ||
    props.theme.colors?.textSecondary ||
    "#4a5568"};
`;

const Instructions = styled.div`
  background: ${(props) =>
    props.theme.mode === "light"
      ? "rgba(255, 255, 255, 0.85)"
      : "rgba(0, 0, 0, 0.2)"};
  padding: 10px;
  border-radius: 4px;
  font-size: 10px;
  color: ${(props) =>
    props.theme.textSecondary || props.theme.colors?.textSecondary || "#bbb"};
  display: flex;
  flex-direction: column;
  gap: 6px;
  border: 1px solid
    ${(props) =>
      props.theme.mode === "light"
        ? "rgba(214, 222, 235, 0.9)"
        : "rgba(255, 255, 255, 0.08)"};
  box-shadow: ${(props) =>
    props.theme.mode === "light" ? "0 1px 2px rgba(31, 37, 50, 0.04)" : "none"};
`;

const CodeBlock = styled.code`
  color: ${(props) =>
    props.theme.textPrimary || props.theme.colors?.textPrimary || "#eee"};
  background: ${(props) =>
    props.theme.mode === "light"
      ? "rgba(0, 85, 255, 0.08)"
      : "rgba(255, 255, 255, 0.05)"};
  padding: 2px 4px;
  border-radius: 2px;
`;

const AsideText = styled.span`
  opacity: 0.8;
  font-size: 10px;
  color: ${(props) =>
    props.theme.textMuted || props.theme.colors?.textMuted || "#6b7280"};
`;

export type DecryptionErrorType = "vault" | "demod" | "latex";

interface DecryptionFallbackProps {
  moduleName: string;
  errorType?: DecryptionErrorType;
}

export const DecryptionFallback: React.FC<DecryptionFallbackProps> = ({
  moduleName,
  errorType = "vault",
}) => {
  const { logout } = useAuthentication();

  const getErrorInfo = () => {
    switch (errorType) {
      case "demod":
        return {
          envVar: "UNSAFE_LOCAL_DEMOD_PASSWORD",
          message:
            "Demodulation logic is encrypted and requires a specific password for this environment.",
          troubleshooting:
            "Ensure the demodulation keys are correctly synchronized with your .env.local file.",
        };
      case "latex":
        return {
          envVar: "UNSAFE_LOCAL_LATEX_PASSWORD",
          message:
            "LaTeX math rendering components are encrypted to protect proprietary formatting logic.",
          troubleshooting:
            "Check if the LaTeX renderer service is authenticated correctly.",
        };
      case "vault":
      default:
        return {
          envVar: "UNSAFE_LOCAL_USER_PASSWORD",
          message:
            "This file or module is encrypted and the current vault session cannot unlock it.",
          troubleshooting:
            "Try locking and unlocking the vault again from the sidebar header.",
        };
    }
  };

  const { envVar, message, troubleshooting } = getErrorInfo();

  return (
    <FallbackContainer>
      <Header>
        <ShieldAlert size={16} />
        <Title>{moduleName} Decryption Failed</Title>
      </Header>

      <Message>
        {message}
        <br />
        <AsideText>
          This usually happens if the session key has expired or the password
          was incorrect.
        </AsideText>
      </Message>

      <Instructions>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Terminal size={12} />
          <span>
            Check your <CodeBlock>.env.local</CodeBlock> configuration:
          </span>
        </div>
        <div style={{ paddingLeft: 18, color: "inherit" }}>
          Ensure <CodeBlock>{envVar}</CodeBlock> is set correctly.
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginTop: 4,
          }}
        >
          <HelpCircle size={12} />
          <span>Troubleshooting:</span>
        </div>
        <div style={{ paddingLeft: 18, color: "inherit" }}>
          {troubleshooting}
        </div>
      </Instructions>

      <div style={{ display: "flex", gap: "8px" }}>
        <Button
          $variant="primary"
          onClick={() => window.location.reload()}
          style={{
            fontSize: "12px",
            padding: "4px 8px",
            height: "auto",
            flex: 1,
          }}
        >
          <RefreshCcw size={10} />
          Reload
        </Button>
        <Button
          $variant="secondary"
          onClick={logout}
          style={{
            fontSize: "12px",
            padding: "4px 8px",
            height: "auto",
            flex: 1,
          }}
        >
          <Shield size={10} />
          Re-auth
        </Button>
      </div>
    </FallbackContainer>
  );
};

export default DecryptionFallback;
