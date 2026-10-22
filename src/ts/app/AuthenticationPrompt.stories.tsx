import { AuthenticationUI } from "@n-apt/app/routes/pages/AuthenticationRoute";

export default {
  title: "Auth/AuthenticationRoute",
  parameters: {
    layout: "fullscreen",
  },
};

export const PasswordLogin = () => (
  <AuthenticationUI
    authState="ready"
    error={null}
    hasPasskeys={false}
    hasFidoSecurityKey={false}
    onPasswordSubmit={() => {}}
    onPasskeyAuth={() => {}}
    onFidoKeyAuth={() => {}}
    onRegisterPasskey={() => {}}
    onRegisterFidoKey={() => {}}
  />
);

export const PasskeyFirst = () => (
  <AuthenticationUI
    authState="ready"
    error={null}
    hasPasskeys={true}
    hasFidoSecurityKey={false}
    onPasswordSubmit={() => {}}
    onPasskeyAuth={() => {}}
    onFidoKeyAuth={() => {}}
    onRegisterPasskey={() => {}}
    onRegisterFidoKey={() => {}}
  />
);

export const AuthenticationFailed = () => (
  <AuthenticationUI
    authState="failed"
    error="Invalid password. Re-enter the local dev key to unlock the live SDR session."
    hasPasskeys={false}
    hasFidoSecurityKey={false}
    onPasswordSubmit={() => {}}
    onPasskeyAuth={() => {}}
    onFidoKeyAuth={() => {}}
    onRegisterPasskey={() => {}}
    onRegisterFidoKey={() => {}}
  />
);

export const Authenticating = () => (
  <AuthenticationUI
    authState="authenticating"
    error={null}
    hasPasskeys={true}
    hasFidoSecurityKey={true}
    onPasswordSubmit={() => {}}
    onPasskeyAuth={() => {}}
    onFidoKeyAuth={() => {}}
    onRegisterPasskey={() => {}}
    onRegisterFidoKey={() => {}}
  />
);
