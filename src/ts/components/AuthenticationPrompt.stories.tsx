import AuthenticationRoute from "@n-apt/routes/AuthenticationRoute";

export default {
  title: 'Auth/AuthenticationRoute',
  parameters: {
    layout: 'fullscreen',
  },
};

export const PasswordLogin = () => (
  <AuthenticationRoute
    authState="ready"
    error={null}
    hasPasskeys={false}
    onPasswordSubmit={() => { }}
    onPasskeyAuth={() => { }}
    onRegisterPasskey={() => { }}
  />
);

export const PasskeyFirst = () => (
  <AuthenticationRoute
    authState="ready"
    error={null}
    hasPasskeys={true}
    onPasswordSubmit={() => { }}
    onPasskeyAuth={() => { }}
    onRegisterPasskey={() => { }}
  />
);

export const AuthenticationFailed = () => (
  <AuthenticationRoute
    authState="failed"
    error="Invalid password. Re-enter the local dev key to unlock the live SDR session."
    hasPasskeys={false}
    onPasswordSubmit={() => { }}
    onPasskeyAuth={() => { }}
    onRegisterPasskey={() => { }}
  />
);

export const Authenticating = () => (
  <AuthenticationRoute
    authState="authenticating"
    error={null}
    hasPasskeys={true}
    onPasswordSubmit={() => { }}
    onPasskeyAuth={() => { }}
    onRegisterPasskey={() => { }}
  />
);
