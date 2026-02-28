/**
 * REST-based authentication service.
 *
 * Handles password auth (PBKDF2+HMAC challenge-response), WebAuthn passkey
 * auth, and session persistence via localStorage.
 */

import { computeHmac } from "@n-apt/crypto/webcrypto";
import { BACKEND_HTTP_URL, WS_URL, SESSION_KEY as ENV_SESSION_KEY } from "../consts/ts/env";

// In dev, Vite proxies /auth/* and /status to the backend.
// In production, these are served from the same origin.
const API_BASE = BACKEND_HTTP_URL.replace(/\/$/, "");
const SESSION_KEY = ENV_SESSION_KEY ?? "n-apt-session-token";

// ── Types ──────────────────────────────────────────────────────────────

export interface AuthInfo {
  has_passkeys: boolean;
}

export interface AuthResult {
  token: string;
  expires_in: number;
}

export interface SessionValidation {
  valid: boolean;
  token?: string;
  error?: string;
}

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

/** GET /auth/info — check if passkeys are registered. */
export async function fetchAuthInfo(): Promise<AuthInfo> {
  const res = await fetch(`${API_BASE}/auth/info`);
  if (!res.ok) throw new Error(`auth/info failed: ${res.status}`);
  return res.json();
}

/** GET /status — public server status (no auth required). */
export async function fetchServerStatus(): Promise<any> {
  const res = await fetch(`${API_BASE}/status`);
  if (!res.ok) throw new Error(`status failed: ${res.status}`);
  return res.json();
}

/** POST /auth/session — validate an existing session token. */
export async function validateSession(token: string): Promise<SessionValidation> {
  const res = await fetch(`${API_BASE}/auth/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return res.json();
}

// ── Password authentication ────────────────────────────────────────────

/** Full password auth flow: challenge → derive key → HMAC → verify → session. */
export async function authenticateWithPassword(password: string): Promise<AuthResult> {
  // Step 1: Get challenge from server
  const challengeRes = await fetch(`${API_BASE}/auth/challenge`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!challengeRes.ok) throw new Error("Authentication failed — Server disconnected 500");
  const { challenge_id, nonce } = await challengeRes.json();

  // Step 2: Derive key and compute HMAC (client-side, using WebCrypto)
  const hmacB64 = await computeHmac(password, nonce);

  // Step 3: Send HMAC to server for verification
  const verifyRes = await fetch(`${API_BASE}/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ challenge_id, hmac: hmacB64 }),
  });

  if (!verifyRes.ok) {
    const err = await verifyRes.json().catch(() => ({ message: "Authentication failed" }));
    throw new Error(err.message || "Authentication failed");
  }

  const result: AuthResult = await verifyRes.json();

  // Step 4: Store session and derive AES key for later decryption
  storeSession(result.token);

  return result;
}

// ── Passkey (WebAuthn) authentication ──────────────────────────────────

/** Register a new passkey. */
export async function registerPasskey(): Promise<void> {
  console.log("Starting passkey registration...");

  // Step 1: Get registration options from server
  const startRes = await fetch(`${API_BASE}/auth/passkey/register/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!startRes.ok) {
    const text = await startRes.text();
    console.error("Failed to start passkey registration:", text);
    throw new Error(`Failed to start passkey registration: ${text}`);
  }
  const { challenge_id, options } = await startRes.json();
  console.log("Got registration options:", { challenge_id, options });

  // Step 2: Create credential via WebAuthn API
  console.log("Calling navigator.credentials.create...");
  const credential = await navigator.credentials.create({
    publicKey: parseCreationOptions(options),
  });
  if (!credential) {
    console.error("Passkey creation cancelled by user");
    throw new Error("Passkey creation cancelled");
  }
  console.log("Created credential:", credential);

  // Step 3: Send credential to server
  const finishRes = await fetch(`${API_BASE}/auth/passkey/register/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id,
      credential: serializeRegistrationCredential(credential as PublicKeyCredential),
    }),
  });

  if (!finishRes.ok) {
    const text = await finishRes.text();
    console.error("Failed to finish passkey registration:", text);
    throw new Error(`Failed to finish passkey registration: ${text}`);
  }
  console.log("Passkey registration completed successfully");
}

/** Authenticate with an existing passkey. */
export async function authenticateWithPasskey(): Promise<AuthResult> {
  // Step 1: Get authentication options from server
  const startRes = await fetch(`${API_BASE}/auth/passkey/auth/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  if (!startRes.ok) throw new Error("Failed to start passkey authentication");
  const { challenge_id, options } = await startRes.json();

  // Step 2: Get credential assertion via WebAuthn API
  const credential = await navigator.credentials.get({
    publicKey: parseRequestOptions(options),
  });
  if (!credential) throw new Error("Passkey authentication cancelled");

  // Step 3: Send assertion to server
  const finishRes = await fetch(`${API_BASE}/auth/passkey/auth/finish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      challenge_id,
      credential: serializeAuthenticationCredential(credential as PublicKeyCredential),
    }),
  });

  if (!finishRes.ok) {
    const err = await finishRes.json().catch(() => ({ message: "Authentication failed" }));
    throw new Error(err.message || "Passkey authentication failed");
  }

  const result: AuthResult = await finishRes.json();
  storeSession(result.token);
  return result;
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

function parseCreationOptions(options: any): PublicKeyCredentialCreationOptions {
  console.log("Parsing creation options:", options);

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
      userHandle: response.userHandle ? bufferToBase64url(response.userHandle) : null,
    },
  };
}

// ── WebSocket URL builder ──────────────────────────────────────────────

/** Build the WebSocket URL with session token as query parameter. */
export function buildWsUrl(token: string): string {
  const wsBase = (WS_URL || BACKEND_HTTP_URL).replace(/^http/, "ws").replace(/\/$/, "");
  return `${wsBase}/ws?token=${encodeURIComponent(token)}`;
}
