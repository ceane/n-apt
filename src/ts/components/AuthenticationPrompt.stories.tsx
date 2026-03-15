import AuthenticationPrompt from './AuthenticationPrompt';

export default {
  title: 'Auth/AuthenticationPrompt',
  parameters: {
    layout: 'fullscreen',
  },
};

export const PasswordLogin = () => (
  <AuthenticationPrompt
    authState="ready"
    error={null}
    hasPasskeys={false}
    onPasswordSubmit={() => {}}
    onPasskeyAuth={() => {}}
    onRegisterPasskey={() => {}}
  />
);

export const PasskeyFirst = () => (
  <AuthenticationPrompt
    authState="ready"
    error={null}
    hasPasskeys={true}
    onPasswordSubmit={() => {}}
    onPasskeyAuth={() => {}}
    onRegisterPasskey={() => {}}
  />
);

export const AuthenticationFailed = () => (
  <AuthenticationPrompt
    authState="failed"
    error="Invalid password. Re-enter the local dev key to unlock the live SDR session."
    hasPasskeys={false}
    onPasswordSubmit={() => {}}
    onPasskeyAuth={() => {}}
    onRegisterPasskey={() => {}}
  />
);

export const Authenticating = () => (
  <AuthenticationPrompt
    authState="authenticating"
    error={null}
    hasPasskeys={true}
    onPasswordSubmit={() => {}}
    onPasskeyAuth={() => {}}
    onRegisterPasskey={() => {}}
  />
);
