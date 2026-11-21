import React, { useEffect, useMemo, useState } from "react";
import { CircleHelp, Lock, Radio } from "lucide-react";
import { Button } from "@n-apt/ui/Button";
import { deriveAesKey } from "@n-apt/crypto/webcrypto";
import { fileRegistry } from "@n-apt/app/infrastructure/io/fileRegistry";
import {
  parseIqCaptureMetadata,
  parseNaptMetadata,
} from "@n-apt/capture/public/metadata";
import {
  derivePrfAesKey,
  deriveRecoveryAesKey,
  getVaultPrfResult,
  requestVaultPrf,
  unwrapVaultMasterKey,
  type VaultKeyWrapper,
} from "@n-apt/crypto/webauthnPrf";
import {
  useOfflinePlayback,
  type OfflineUnlockStatus,
} from "@n-apt/app/hooks/OfflinePlaybackContext";

type SelectedFile = { id: string; name: string };

interface OfflineCaptureUnlockProps {
  selectedFiles: SelectedFile[];
}

const FIDO_VAULT_ENCRYPTION = "AES-256-GCM-FIDO-VAULT-V1";

const decodeBase64 = (value: string): Uint8Array =>
  Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

const decodeBase64Url = (value: string): ArrayBuffer => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const parseCaptureSalt = (value: string): Uint8Array => {
  const normalized = value.trim().replace(/^0x/i, "").replace(/\s+/g, "");
  if (!/^(?:[0-9a-fA-F]{2}){32}$/.test(normalized)) {
    throw new Error("Capture salt must be 64 hexadecimal characters.");
  }
  return Uint8Array.from(
    normalized.match(/.{2}/g) ?? [],
    (byte) => Number.parseInt(byte, 16),
  );
};

const readSelectedMetadata = async (
  selected: SelectedFile,
): Promise<Record<string, unknown>> => {
  if (selected.name.toLowerCase().endsWith(".enc")) {
    throw new Error("Open the .enc envelope with its password and capture salt.");
  }
  const file = fileRegistry.get(selected.id);
  if (!file) throw new Error("The selected capture is no longer available.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  return selected.name.toLowerCase().endsWith(".napt")
    ? parseNaptMetadata(bytes)
    : parseIqCaptureMetadata(bytes);
};

const unlockWithPassword = async (
  selectedFiles: SelectedFile[],
  password: string,
): Promise<{ key: CryptoKey; mode: "password" | "fido" }> => {
  if (!password.trim()) throw new Error("Enter the capture password.");
  const selected = selectedFiles[0];
  if (
    selected &&
    selectedFiles.length === 1 &&
    !selected.name.toLowerCase().endsWith(".enc")
  ) {
    const metadata = await readSelectedMetadata(selected);
    if (metadata.encryption === FIDO_VAULT_ENCRYPTION) {
      const wrapper = metadata.vault_key_recovery as
        | Partial<VaultKeyWrapper>
        | undefined;
      if (
        !wrapper ||
        wrapper.format !== "n-apt-vault-key-wrapper-v1" ||
        typeof wrapper.salt !== "string" ||
        typeof wrapper.nonce !== "string" ||
        typeof wrapper.ciphertext !== "string"
      ) {
        throw new Error("This FIDO capture has no password recovery wrapper.");
      }
      const recoveryKey = await deriveRecoveryAesKey(
        password,
        decodeBase64(wrapper.salt),
      );
      const vaultKey = await unwrapVaultMasterKey(
        wrapper as VaultKeyWrapper,
        recoveryKey,
      );
      try {
        return {
          key: await crypto.subtle.importKey(
            "raw",
            vaultKey,
            { name: "AES-GCM" },
            true,
            ["decrypt"],
          ),
          mode: "fido",
        };
      } finally {
        vaultKey.fill(0);
      }
    }
  }
  return { key: await deriveAesKey(password), mode: "password" };
};

const readFidoWrapper = async (
  selectedFiles: SelectedFile[],
): Promise<{ wrapper: VaultKeyWrapper; credentialId: string }> => {
  if (selectedFiles.length !== 1) {
    throw new Error("Select one FIDO-encrypted capture to unlock with a security key.");
  }
  const selected = selectedFiles[0];
  if (selected.name.toLowerCase().endsWith(".enc")) {
    throw new Error(
      "Increased Protection .enc files need the capture password and salt. FIDO applies to FIDO-vault .iq or .napt files.",
    );
  }
  const file = fileRegistry.get(selected.id);
  if (!file) throw new Error("The selected capture is no longer available.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const metadata = selected.name.toLowerCase().endsWith(".napt")
    ? parseNaptMetadata(bytes)
    : parseIqCaptureMetadata(bytes);
  const candidate = metadata.fido_vault_wrapper as Partial<VaultKeyWrapper> | undefined;
  const credentialId = metadata.fido_vault_credential_id;
  if (
    !candidate ||
    candidate.format !== "n-apt-vault-key-wrapper-v1" ||
    typeof candidate.salt !== "string" ||
    typeof candidate.nonce !== "string" ||
    typeof candidate.ciphertext !== "string" ||
    typeof credentialId !== "string" ||
    !credentialId
  ) {
    throw new Error(
      "This capture has no offline FIDO wrapper. Use its password recovery option or open a FIDO capture created with offline unlock support.",
    );
  }
  return { wrapper: candidate as VaultKeyWrapper, credentialId };
};

const unlockWithFido = async (
  selectedFiles: SelectedFile[],
): Promise<CryptoKey> => {
  if (!navigator.credentials?.get) {
    throw new Error("This browser does not support security-key unlock.");
  }
  const { wrapper, credentialId } = await readFidoWrapper(selectedFiles);
  const salt = decodeBase64(wrapper.salt);
  const credential = await navigator.credentials.get({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: [
        { type: "public-key", id: decodeBase64Url(credentialId) },
      ],
      userVerification: "preferred",
      timeout: 60_000,
      extensions: requestVaultPrf(salt),
    },
  });
  if (!credential) throw new Error("Security-key unlock was cancelled.");
  const prfResult = getVaultPrfResult(credential as PublicKeyCredential);
  try {
    const wrappingKey = await derivePrfAesKey(
      prfResult,
      salt,
      "n-apt/fido-vault-wrapper/v1",
    );
    const vaultKey = await unwrapVaultMasterKey(wrapper, wrappingKey);
    try {
      return await crypto.subtle.importKey(
        "raw",
        vaultKey,
        { name: "AES-GCM" },
        true,
        ["decrypt"],
      );
    } finally {
      vaultKey.fill(0);
    }
  } finally {
    prfResult.fill(0);
  }
};

const statusCopy: Record<OfflineUnlockStatus, string> = {
  locked: "Decrypt captures locally in this browser.",
  unlocking: "Decrypting the selected capture…",
  decrypted: "Capture successfully decrypted.",
  error: "Capture could not be decrypted.",
};

export const OfflineCaptureUnlock: React.FC<OfflineCaptureUnlockProps> = ({
  selectedFiles,
}) => {
  const {
    status,
    error,
    setUnlockedKey,
    setError,
    lock,
  } = useOfflinePlayback();
  const [password, setPassword] = useState("");
  const [salt, setSalt] = useState("");
  const [busy, setBusy] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const selectedIdentity = useMemo(
    () => selectedFiles.map((file) => file.id + ":" + file.name).join("|"),
    [selectedFiles],
  );
  const requiresSalt = selectedFiles.some((file) =>
    file.name.toLowerCase().endsWith(".enc"),
  );
  const hasSelectedFile = selectedFiles.length > 0;

  useEffect(() => {
    lock();
    setPassword("");
    setSalt("");
    setLocalError(null);
    // A new file selection always needs fresh credentials.
  }, [selectedIdentity, requiresSalt, lock]);

  const runUnlock = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setLocalError(null);
    try {
      if (selectedFiles.length === 0) {
        throw new Error("Choose a capture file first.");
      }
      const captureSalt = requiresSalt ? parseCaptureSalt(salt) : null;
      const { key, mode } = await unlockWithPassword(selectedFiles, password);
      setUnlockedKey(key, mode, captureSalt);
      setPassword("");
      setSalt("");
    } catch (unlockError) {
      const message =
        unlockError instanceof Error ? unlockError.message : "Unable to unlock capture.";
      setLocalError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const runFidoUnlock = async () => {
    setBusy(true);
    setLocalError(null);
    try {
      const key = await unlockWithFido(selectedFiles);
      setUnlockedKey(key, "fido", null);
      setPassword("");
      setSalt("");
    } catch (unlockError) {
      const message =
        unlockError instanceof Error ? unlockError.message : "Security-key unlock failed.";
      setLocalError(message);
      setError(message);
    } finally {
      setBusy(false);
    }
  };

  const isUnlocked = status === "decrypted";
  const message = localError ?? error;

  if (isUnlocked) {
    return (
      <section
        aria-label="Capture decryption"
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: 12,
          border: "1px solid var(--color-border, #454545)",
          borderRadius: 10,
          background: "var(--color-surface, #202020)",
          color: "var(--color-text-primary, #f5f5f5)",
        }}
      >
        <span role="status" aria-live="polite">{statusCopy.decrypted}</span>
        <Button
          type="button"
          $variant="secondary"
          aria-label="Lock capture and re-enter credentials"
          title="Lock capture and re-enter credentials"
          onClick={() => {
            lock();
          }}
        >
          <Lock size={14} aria-hidden="true" />
        </Button>
      </section>
    );
  }

  return (
    <section
      aria-label="Offline capture decryption"
      style={{
        gridColumn: "1 / -1",
        display: "grid",
        gap: 10,
        padding: 12,
        border: "1px solid var(--color-border, #454545)",
        borderRadius: 10,
        background: "var(--color-surface, #202020)",
        color: "var(--color-text-primary, #f5f5f5)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          opacity: hasSelectedFile ? 1 : 0.45,
        }}
      >
        <strong style={{ fontSize: 12 }}>Unlock capture</strong>
        <span
          title="Regular encrypted captures use their capture password. FIDO-vault captures use the vault recovery password here, or the enrolled security key below. Increased Protection .enc files also need their 32-byte capture salt."
          aria-label="About offline capture unlock"
          style={{ display: "inline-flex", color: "var(--color-text-muted, #aaa)" }}
        >
          <CircleHelp size={13} />
        </span>
      </div>

      <p
        style={{
          margin: 0,
          fontSize: 11,
          color: "var(--color-text-secondary, #bbb)",
          opacity: hasSelectedFile ? 1 : 0.45,
        }}
      >
        {statusCopy[status]}
      </p>

      <form onSubmit={(event) => void runUnlock(event)} style={{ display: "grid", gap: 8 }}>
        <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
          Password
          <input
            aria-label="Capture password"
            autoComplete="off"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            disabled={busy || !hasSelectedFile}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "8px 9px",
              opacity: hasSelectedFile ? 1 : 0.55,
              cursor: hasSelectedFile ? "text" : "not-allowed",
              color: "var(--color-text-primary, #f5f5f5)",
              background: "var(--color-background, #151515)",
              border: "1px solid var(--color-border, #454545)",
              borderRadius: 6,
            }}
          />
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11 }}>
          <input
            type="checkbox"
            checked={requiresSalt}
            disabled
          />
          Has increased protection?
          <span
            title="Enter the 32-byte per-capture salt supplied with an Increased Protection .enc capture."
            aria-label="About Increased Protection salt"
            style={{ display: "inline-flex", color: "var(--color-text-muted, #aaa)" }}
          >
            <CircleHelp size={13} />
          </span>
        </label>

        {requiresSalt && (
          <label style={{ display: "grid", gap: 4, fontSize: 11 }}>
            Capture salt (64-character hex)
            <input
              aria-label="Capture protection salt"
              autoComplete="off"
              inputMode="text"
              value={salt}
              onChange={(event) => setSalt(event.target.value)}
              disabled={busy || !hasSelectedFile}
              placeholder="Paste the 64-character salt"
              style={{
                width: "100%",
                boxSizing: "border-box",
                padding: "8px 9px",
                color: "var(--color-text-primary, #f5f5f5)",
                background: "var(--color-background, #151515)",
                border: "1px solid var(--color-border, #454545)",
                borderRadius: 6,
                fontFamily: "monospace",
              }}
            />
          </label>
        )}

        <Button
          type="submit"
          $variant="primary"
          disabled={busy || !hasSelectedFile}
        >
          {busy ? "Unlocking…" : "Decrypt with password"}
        </Button>
      </form>

      <div
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          color: "var(--color-text-muted, #aaa)",
          fontSize: 10,
          fontFamily: "monospace",
        }}
      >
        <span style={{ height: 1, flex: 1, background: "var(--color-border, #454545)" }} />
        <span>OR</span>
        <span style={{ height: 1, flex: 1, background: "var(--color-border, #454545)" }} />
      </div>

      <Button
        type="button"
        $variant="secondary"
        onClick={() => void runFidoUnlock()}
        disabled={busy || !hasSelectedFile || requiresSalt}
        title={
          requiresSalt
            ? "Increased Protection captures require their password and capture salt."
            : "Unlock an FIDO-vault capture with its enrolled security key"
        }
      >
        <Radio size={14} aria-hidden="true" />
        {busy ? "Waiting for security key…" : "Unlock with FIDO"}
      </Button>

      {message && (
        <p
          role="alert"
          style={{
            margin: 0,
            color: "var(--color-danger, #f87171)",
            fontSize: 11,
            lineHeight: 1.4,
          }}
        >
          {message}
        </p>
      )}
    </section>
  );
};

export default OfflineCaptureUnlock;
