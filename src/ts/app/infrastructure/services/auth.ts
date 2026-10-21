/**
 * REST-based authentication service.
 *
 * Handles password auth (PBKDF2+HMAC challenge-response), WebAuthn passkey
 * auth, and session persistence via localStorage.
 */

import { computeHmac } from "@n-apt/crypto/webcrypto";
import {
  derivePrfAesKey,
  deriveRecoveryAesKey,
  getVaultPrfResult,
  requestVaultPrf,
  unwrapVaultMasterKey,
  wrapVaultMasterKey,
  type VaultKeyWrapper,
} from "@n-apt/crypto/webauthnPrf";
import {
  BACKEND_HTTP_URL,
  WS_URL,
  SESSION_KEY as ENV_SESSION_KEY,
} from "@n-apt/consts/env";
import {
  validateAuthInfo,
  validateAuthResult,
  validateSessionValidation,
  isValidSessionToken,
} from "@n-apt/validation";

const getApiBase = (): string => {
  if (typeof window !== "undefined") {
    const host = window.location.hostname;
    const isLocalPreviewHost = host === "localhost" || host === "127.0.0.1";

    if (isLocalPreviewHost) {
      return "";
    }
  }

  return BACKEND_HTTP_URL.replace(/\/$/, "");
};

const API_BASE = getApiBase();
const SESSION_KEY = ENV_SESSION_KEY ?? "n-apt-session-token";
const AUTH_SERVER_DISCONNECTED_MESSAGE =
  "The app isn't running, run `npm run dev` to start the server and login.";

// ── Types ──────────────────────────────────────────────────────────────

export interface AuthInfo {
  has_passkeys: boolean;
  has_fido_security_key: boolean;
}

export interface AuthResult {
  token: string;
  expires_in: number;
  fido_vault_unlocked?: boolean;
}

type FidoVaultWrappers = { fido: VaultKeyWrapper; recovery: VaultKeyWrapper };

export interface SessionValidation {
  valid: boolean;
  token?: string;
  error?: string;
}

// -- Request Deduplication --
let authInfoPromise: Promise<AuthInfo> | null = null;
const sessionValidationPromises = new Map<string, Promise<SessionValidation>>();
const vaultKeyPromises = new Map<string, Promise<string | null>>();

// ── Session persistence ────────────────────────────────────────────────

export function getStoredSession(): string | null {
  try {
    return localStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function storeSession(token: string): void {
  try {
    localStorage.setItem(SESSION_KEY, token);
  } catch {
    // localStorage unavailable
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // localStorage unavailable
  }
}

// ── REST API calls ─────────────────────────────────────────────────────

function isFetchNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  return (
    error.message === "Failed to fetch" ||
    error.message === "fetch failed" ||
    error.message.includes("NetworkError") ||
    error.message.includes("Load failed")
  );
}

function authServerDisconnectedError(error: unknown): Error {
  if (isFetchNetworkError(error)) {
    return new Error(AUTH_SERVER_DISCONNECTED_MESSAGE);
  }

  return error instanceof Error ? error : new Error("Authentication failed");
}

/** GET /auth/info — check if passkeys are registered. */
export async function fetchAuthInfo(): Promise<AuthInfo> {
  if (authInfoPromise) return authInfoPromise;

  authInfoPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/info`);
      if (!res.ok) throw new Error(`auth/info failed: ${res.status}`);

      const data = await res.json();
      if (!validateAuthInfo(data)) {
        throw new Error("Invalid auth info response from server");
      }

      return data;
    } catch (e) {
      authInfoPromise = null; // Allow retry on failure
      throw e;
    }
  })();

  return authInfoPromise;
}

/** GET /status — public server status (no auth required). */
export async function fetchServerStatus(): Promise<any> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`status failed: ${res.status}`);
  return res.json();
}

/** POST /auth/logout — revoke the current session without clearing user data. */
export async function logoutSession(token?: string | null): Promise<void> {
  if (!token) throw new Error("Logout requires a session token");
  const res = await fetch(`${API_BASE}/auth/logout`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    credentials: "include",
    keepalive: true,
  });
  // Validation failures can also mean Redis is unavailable; retain the session.
  if (!res.ok) {
    throw new Error(`logout failed: ${res.status}`);
  }
}

/** POST /auth/session — validate an existing session token. */
export async function validateSession(
  token: string,
): Promise<SessionValidation> {
  // Validate token format first
  if (!isValidSessionToken(token)) {
    return {
      valid: false,
      error: "Invalid session token format",
    };
  }

  const existing = sessionValidationPromises.get(token);
  if (existing) return existing;

  const promise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/session`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token }),
      });

      const responseText = await res.text();
      const parsed = responseText
        ? (() => {
            try {
              return JSON.parse(responseText) as SessionValidation;
            } catch {
              return null;
            }
          })()
        : null;

      if (!res.ok) {
        return {
          valid: false,
          error: parsed?.error || `Session validation failed: ${res.status}`,
        };
      }

      if (parsed && validateSessionValidation(parsed)) {
        return parsed;
      }

      return {
        valid: false,
        error: "Invalid session validation response",
      };
    } finally {
      // We don't necessarily want to clear this immediately if we want to avoid
      // Strict Mode double-fire, but we don't want to keep it forever either
      // if the token might expire. For now, keeping it simple.
      setTimeout(() => sessionValidationPromises.delete(token), 5000);
    }
  })();

  sessionValidationPromises.set(token, promise);
  return promise;
}

/**
 * Fetch the derived encryption key (Vault Key) for an authenticated session.
 */
export async function fetchVaultKey(token: string): Promise<string | null> {
  const existing = vaultKeyPromises.get(token);
  if (existing) return existing;

  const promise = (async () => {
    try {
      // Send the session token via the Authorization header so it stays out
      // of the URL (access logs, browser history).
      const response = await fetch(`${API_BASE}/auth/vault-key`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!response.ok) {
        return null;
      }

      const data = await response.json();
      return data.vault_key;
    } finally {
      setTimeout(() => vaultKeyPromises.delete(token), 5000);
    }
  })();

  vaultKeyPromises.set(token, promise);
  return promise;
}

// ── Password authentication ────────────────────────────────────────────

/** Full password auth flow: challenge → derive key → HMAC → verify → session. */
export async function authenticateWithPassword(
  password: string,
): Promise<AuthResult> {
  // Step 1: Get challenge from server
  let challengeRes: Response;
  try {
    challengeRes = await fetch(`${API_BASE}/auth/challenge`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  } catch (error) {
    throw authServerDisconnectedError(error);
  }
  if (!challengeRes.ok)
    throw new Error("Authentication failed — Server disconnected 500");
  const { challenge_id, nonce } = await challengeRes.json();

  // Step 2: Derive key and compute HMAC (client-side, using WebCrypto)
  const hmacB64 = await computeHmac(password, nonce);

  // Step 3: Send HMAC to server for verification
  let verifyRes: Response;
  try {
    verifyRes = await fetch(`${API_BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge_id, hmac: hmacB64 }),
    });
  } catch (error) {
    throw authServerDisconnectedError(error);
  }

  if (!verifyRes.ok) {
    const err = await verifyRes
      .json()
      .catch(() => ({ message: "Authentication failed" }));
    throw new Error(err.message || "Authentication failed");
  }

  const result: AuthResult = await verifyRes.json();

  // Validate authentication result
  if (!validateAuthResult(result)) {
    throw new Error("Invalid authentication result from server");
  }

  // Step 4: Store session and derive AES key for later decryption
  storeSession(result.token);

  return result;
}

// ── Passkey (WebAuthn) authentication ──────────────────────────────────

/** Register a new passkey. */
export async function registerPasskey(
  password?: string,
  fidoSecurityKey = false,
): Promise<void> {
  // First enrollment also requires password knowledge. Keep the vault
  // password unchanged and authorize the ceremony with a fresh session.
  let storedToken = getStoredSession();
  if (password?.trim()) storedToken = (await authenticateWithPassword(password)).token;
  if (!storedToken) throw new Error("Enter your password or sign in before registering a passkey");
  if (!password?.trim()) throw new Error("Enter your password to register this authentication credential");
  const authHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(storedToken ? { Authorization: `Bearer ${storedToken}` } : {}),
  };

  // Step 1: Get registration options from server
  let startRes: Response;
  try {
    startRes = await fetch(`${API_BASE}/auth/passkey/register/start`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ fido_security_key: fidoSecurityKey }),
    });
  } catch (error) {
    throw authServerDisconnectedError(error);
  }
  if (!startRes.ok) {
    const text = await startRes.text();
    throw new Error(`Failed to start passkey registration: ${text}`);
  }
  const { challenge_id, options } = await startRes.json();

  // Step 2: Create credential via WebAuthn API
  const creationOptions = parseCreationOptions(options);
  const fidoSalt = fidoSecurityKey
    ? crypto.getRandomValues(new Uint8Array(32))
    : null;
  const credential = await navigator.credentials.create({
    publicKey: {
      ...creationOptions,
      ...(fidoSecurityKey
        ? {
            authenticatorSelection: {
              ...creationOptions.authenticatorSelection,
              authenticatorAttachment: "cross-platform",
            },
            extensions: {
              ...creationOptions.extensions,
              // Registration must enable PRF for this credential. Browsers
              // are allowed to omit PRF evaluation results from create();
              // request the secret in a follow-up assertion below instead.
              prf: {},
            },
          }
        : {}),
    },
  });
  if (!credential) {
    throw new Error("Passkey creation cancelled");
  }

  const credentialPublicKey = credential as PublicKeyCredential;
  let vmk: Uint8Array | null = null;
  let wrappers: FidoVaultWrappers | undefined;
  if (fidoSecurityKey) {
    const prfEnabled = (credentialPublicKey.getClientExtensionResults() as {
      prf?: { enabled?: boolean };
    }).prf?.enabled;
    if (!prfEnabled) {
      throw new Error(
        "This security key or browser did not enable WebAuthn PRF for the new credential. Login may still work, but I/Q capture encryption needs a PRF-capable FIDO key and browser.",
      );
    }

    // PRF evaluation output is not guaranteed during credential creation.
    // Run an assertion for the credential just created and derive the vault
    // wrapping key from that assertion's PRF result.
    const prfAssertion = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        ...(creationOptions.rp.id ? { rpId: creationOptions.rp.id } : {}),
        allowCredentials: [
          { type: "public-key", id: credentialPublicKey.rawId },
        ],
        extensions: requestVaultPrf(fidoSalt!),
      },
    });
    if (!prfAssertion) {
      throw new Error("FIDO security-key PRF verification was cancelled");
    }
    const prfResult = getVaultPrfResult(prfAssertion as PublicKeyCredential);
    const fidoWrappingKey = await derivePrfAesKey(
      prfResult,
      fidoSalt!,
      "n-apt/fido-vault-wrapper/v1",
    );
    let recoveryWrapper: VaultKeyWrapper | undefined;
    const existingRecovery = await fetch(`${API_BASE}/auth/fido-vault/recovery-wrapper`, {
      headers: { Authorization: `Bearer ${storedToken}` },
    });
    if (existingRecovery.ok) {
      const payload = await existingRecovery.json() as { fido_vault_recovery: VaultKeyWrapper };
      recoveryWrapper = payload.fido_vault_recovery;
      const recoveryKey = await deriveRecoveryAesKey(password, decodeBase64(recoveryWrapper.salt));
      vmk = await unwrapVaultMasterKey(recoveryWrapper, recoveryKey);
    } else if (existingRecovery.status === 404) {
      vmk = crypto.getRandomValues(new Uint8Array(32));
      const recoverySalt = crypto.getRandomValues(new Uint8Array(32));
      const recoveryWrappingKey = await deriveRecoveryAesKey(password, recoverySalt);
      recoveryWrapper = await wrapVaultMasterKey(vmk, recoveryWrappingKey, recoverySalt);
    } else {
      throw new Error("Unable to load the existing FIDO vault recovery wrapper");
    }
    const fidoWrapper = await wrapVaultMasterKey(vmk!, fidoWrappingKey, fidoSalt!);
    prfResult.fill(0);
    wrappers = { fido: fidoWrapper, recovery: recoveryWrapper! };
  }

  // Step 3: Send credential to server
  let finishRes: Response;
  try {
    finishRes = await fetch(`${API_BASE}/auth/passkey/register/finish`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        challenge_id,
        fido_security_key: fidoSecurityKey,
        credential: serializeRegistrationCredential(
          credentialPublicKey,
        ),
        ...(wrappers ? { fido_vault: wrappers } : {}),
      }),
    });
  } catch (error) {
    throw authServerDisconnectedError(error);
  }

  if (!finishRes.ok) {
    const text = await finishRes.text();
    throw new Error(`Failed to finish passkey registration: ${text}`);
  }
  if (fidoSecurityKey && vmk) {
    await unlockFidoVault(storedToken, vmk);
    vmk.fill(0);
  }
  authInfoPromise = null;
}

/** Authenticate with an existing passkey. */
export async function authenticateWithPasskey(
  fidoSecurityKey = false,
): Promise<AuthResult> {
  // Step 1: Get authentication options from server
  let startRes: Response;
  try {
    startRes = await fetch(`${API_BASE}/auth/passkey/auth/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fido_security_key: fidoSecurityKey }),
    });
  } catch (error) {
    throw authServerDisconnectedError(error);
  }
  if (!startRes.ok) {
    throw new Error(`Failed to start ${fidoSecurityKey ? "FIDO security-key" : "passkey"} authentication`);
  }
  const { challenge_id, options, fido_vault: fidoWrapper } = await startRes.json() as {
    challenge_id: string;
    options: any;
    fido_vault: VaultKeyWrapper | null;
  };

  // Step 2: Get credential assertion via WebAuthn API
  const requestOptions = parseRequestOptions(options);
  if (fidoSecurityKey && !fidoWrapper) {
    throw new Error("This device has no enrolled FIDO security key vault");
  }
  const credential = await navigator.credentials.get({
    publicKey: {
      ...requestOptions,
      ...(fidoSecurityKey ? { hints: ["security-key"] } : {}),
      ...(fidoWrapper ? { extensions: {
        ...requestOptions.extensions,
        prf: { eval: { first: decodeBase64(fidoWrapper.salt).buffer as ArrayBuffer } },
      } } : {}),
    },
  });
  if (!credential) throw new Error("Passkey authentication cancelled");
  if (fidoSecurityKey) {
    getVaultPrfResult(credential as PublicKeyCredential).fill(0);
  }

  // Step 3: Send assertion to server
  let finishRes: Response;
  try {
    finishRes = await fetch(`${API_BASE}/auth/passkey/auth/finish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        challenge_id,
        credential: serializeAuthenticationCredential(
          credential as PublicKeyCredential,
        ),
      }),
    });
  } catch (error) {
    throw authServerDisconnectedError(error);
  }

  if (!finishRes.ok) {
    const err = await finishRes
      .json()
      .catch(() => ({ message: "Authentication failed" }));
    throw new Error(err.message || "Passkey authentication failed");
  }

  const result: AuthResult = await finishRes.json();

  // Validate authentication result
  if (!validateAuthResult(result)) {
    throw new Error("Invalid passkey authentication result from server");
  }

  if (fidoSecurityKey && fidoWrapper) {
    let prfResult: Uint8Array | undefined;
    let vmk: Uint8Array | undefined;
    try {
      const activePrfResult = getVaultPrfResult(credential as PublicKeyCredential);
      prfResult = activePrfResult;
      const fidoSalt = decodeBase64(fidoWrapper.salt);
      const fidoWrappingKey = await derivePrfAesKey(activePrfResult, fidoSalt, "n-apt/fido-vault-wrapper/v1");
      const unwrappedVmk = await unwrapVaultMasterKey(fidoWrapper, fidoWrappingKey);
      vmk = unwrappedVmk;
      await unlockFidoVault(result.token, unwrappedVmk);
      result.fido_vault_unlocked = true;
    } catch {
      throw new Error("Security key did not unlock the FIDO capture vault");
    } finally {
      prfResult?.fill(0);
      vmk?.fill(0);
    }
  } else {
    result.fido_vault_unlocked = false;
  }
  storeSession(result.token);
  return result;
}

export async function unlockFidoVault(token: string, key: Uint8Array): Promise<void> {
  const response = await fetch(`${API_BASE}/auth/fido-vault/unlock`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ vault_key: encodeBase64(key) }),
  });
  if (!response.ok) throw new Error("Failed to unlock the FIDO capture vault");
}

export async function unlockFidoVaultWithRecovery(token: string, password: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/auth/fido-vault/recovery-wrapper`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return false;
    const { fido_vault_recovery: wrapper } = await response.json() as { fido_vault_recovery: VaultKeyWrapper };
    const salt = decodeBase64(wrapper.salt);
    const recoveryKey = await deriveRecoveryAesKey(password, salt);
    const vmk = await unwrapVaultMasterKey(wrapper, recoveryKey);
    await unlockFidoVault(token, vmk);
    vmk.fill(0);
    return true;
  } catch {
    return false;
  }
}

export async function fetchFidoVaultUnlocked(token: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE}/auth/fido-vault/status`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return false;
    const status = await response.json() as { unlocked?: unknown };
    return status.unlocked === true;
  } catch {
    return false;
  }
}

// ── WebAuthn serialization helpers ─────────────────────────────────────

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  if (!base64url) {
    throw new Error("base64urlToBuffer: input is undefined or empty");
  }
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

function parseCreationOptions(
  options: any,
): PublicKeyCredentialCreationOptions {
  // webauthn-rs nests everything under publicKey
  const pk = options.publicKey || options;
  if (!pk.challenge) {
    throw new Error("options.publicKey.challenge is undefined");
  }
  if (!pk.user?.id) {
    throw new Error("options.publicKey.user.id is undefined");
  }

  return {
    challenge: base64urlToBuffer(pk.challenge),
    rp: pk.rp,
    user: {
      id: base64urlToBuffer(pk.user.id),
      name: pk.user.name,
      displayName: pk.user.displayName,
    },
    pubKeyCredParams: pk.pubKeyCredParams,
    timeout: pk.timeout,
    attestation: pk.attestation,
    authenticatorSelection: pk.authenticatorSelection,
    extensions: pk.extensions,
    excludeCredentials: pk.excludeCredentials?.map((c: any) => {
      if (!c.id) {
        throw new Error("excludeCredentials item id is undefined");
      }
      return {
        type: c.type,
        id: base64urlToBuffer(c.id),
        transports: c.transports,
      };
    }),
  };
}

function parseRequestOptions(options: any): PublicKeyCredentialRequestOptions {
  // webauthn-rs nests everything under publicKey
  const pk = options.publicKey || options;
  return {
    ...pk,
    challenge: base64urlToBuffer(pk.challenge),
    allowCredentials: (pk.allowCredentials || []).map((c: any) => ({
      ...c,
      id: base64urlToBuffer(c.id),
    })),
  };
}

function serializeRegistrationCredential(cred: PublicKeyCredential): any {
  const response = cred.response as AuthenticatorAttestationResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      attestationObject: bufferToBase64url(response.attestationObject),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
    },
  };
}

function serializeAuthenticationCredential(cred: PublicKeyCredential): any {
  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64url(cred.rawId),
    type: cred.type,
    response: {
      authenticatorData: bufferToBase64url(response.authenticatorData),
      clientDataJSON: bufferToBase64url(response.clientDataJSON),
      signature: bufferToBase64url(response.signature),
      userHandle: response.userHandle
        ? bufferToBase64url(response.userHandle)
        : null,
    },
  };
}

// ── WebSocket URL builder ──────────────────────────────────────────────

/** Build the WebSocket URL with session token as query parameter. */
export function buildWsUrl(token: string): string {
  const wsBase = (WS_URL || BACKEND_HTTP_URL)
    .replace(/^http/, "ws")
    .replace(/\/$/, "");
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}
