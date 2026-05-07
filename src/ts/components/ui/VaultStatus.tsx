import React from "react";
import styled from "styled-components";
import { Shield, ShieldAlert, ShieldCheck } from "lucide-react";
import { useAppSelector } from "@n-apt/redux";
import { useAuthentication } from "../../hooks/useAuthentication";
import { Tooltip } from "./Tooltip";

const Container = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-right: 8px;
`;

const StatusIcon = styled.div<{ $status: "locked" | "unlocked" | "error" }>`
  color: ${(props) => {
    switch (props.$status) {
      case "unlocked":
        return props.theme.success || "#4caf50";
      case "error":
        return props.theme.danger || "#f44336";
      default:
        return props.theme.textSecondary || "#888";
    }
  }};
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: help;
  transition: transform 0.2s ease;

  &:hover {
    transform: scale(1.1);
  }
`;

export const VaultStatus: React.FC = () => {
  const auth = useAuthentication();
  const cryptoCorrupted = useAppSelector((s) => s.websocket.cryptoCorrupted);
  const isUnlocked = auth.isAuthenticated && !!auth.aesKey && !cryptoCorrupted;
  const isFailed = auth.authState === "failed" || cryptoCorrupted;

  let status: "locked" | "unlocked" | "error" = "locked";
  let Icon = Shield;
  let label = "Vault Locked";
  let content =
    "The vault is locked. NAPT files cannot be decrypted until you authenticate.";

  if (cryptoCorrupted) {
    status = "error";
    Icon = ShieldAlert;
    label = "Decryption Corrupted";
    content =
      "The decryption stream has been corrupted. This usually indicates an invalid session key or mismatched environment variables (.env.local).";
  } else if (isUnlocked) {
    status = "unlocked";
    Icon = ShieldCheck;
    label = "Vault Unlocked";
    content =
      "The vault is unlocked. NAPT files will be decrypted automatically using your session key.";
  } else if (isFailed) {
    status = "error";
    Icon = ShieldAlert;
    label = "Vault Error";
    content = `Authentication failed: ${auth.authError || "Unknown error"}. Please re-authenticate to unlock the vault.`;
  }

  return (
    <Container>
      <Tooltip title={label} content={content} />
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <StatusIcon $status={status} title={label}>
          <Icon size={18} />
        </StatusIcon>
        <span
          style={{
            fontSize: "10px",
            fontWeight: "bold",
            color:
              status === "unlocked"
                ? "#4caf50"
                : status === "error"
                  ? "#f44336"
                  : "#888",
            fontFamily: "JetBrains Mono, monospace",
            letterSpacing: "0.5px",
          }}
        >
          {label.toUpperCase()}
        </span>
      </div>
    </Container>
  );
};
