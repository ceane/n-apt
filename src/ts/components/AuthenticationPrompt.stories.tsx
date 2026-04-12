import { AuthenticationUI } from "@n-apt/routes/AuthenticationRoute";

export default {
  title: 'Auth/AuthenticationRoute',
  parameters: {
    layout: 'fullscreen',
  },
};

export const PasswordLogin = () => (
  <AuthenticationUI
    authState="ready"
    error={null}
    hasPasskeys={false}
    onPasswordSubmit={() => { }}
    onPasskeyAuth={() => { }}
    onRegisterPasskey={() => { }}
  />
);

export const PasskeyFirst = () => (
  <AuthenticationUI
    authState="ready"
    error={null}
    hasPasskeys={true}
    onPasswordSubmit={() => { }}
    onPasskeyAuth={() => { }}
    onRegisterPasskey={() => { }}
  />
);

export const AuthenticationFailed = () => (
  <AuthenticationUI
    authState="failed"
    error="Invalid password. Re-enter the local dev key to unlock the live SDR session."
    hasPasskeys={false}
    onPasswordSubmit={() => { }}
    onPasskeyAuth={() => { }}
    onRegisterPasskey={() => { }}
  />
);

export const Authenticating = () => (
  <AuthenticationUI
    authState="authenticating"
    error={null}
    hasPasskeys={true}
    onPasswordSubmit={() => { }}
    onPasskeyAuth={() => { }}
    onRegisterPasskey={() => { }}
  />
);
