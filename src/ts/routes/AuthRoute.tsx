import React from "react";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import AuthenticationPrompt from "@n-apt/components/AuthenticationPrompt";
import {
  InitializingContainer,
  InitializingTitle,
  InitializingText,
} from "@n-apt/components/Layout";

interface AuthRouteProps {
  children: React.ReactNode;
}

export const AuthRoute: React.FC<AuthRouteProps> = ({ children }) => {
  const {
    authState,
    isAuthenticated,
    authError,
    hasPasskeys,
    isInitialAuthCheck,
    handlePasswordAuth,
    handlePasskeyAuth,
    handleRegisterPasskey,
  } = useAuthentication();

  if (isInitialAuthCheck) {
    return (
      <InitializingContainer>
        <InitializingTitle>Initializing N-APT</InitializingTitle>
        <InitializingText>
          Establishing secure connection and verifying session...
        </InitializingText>
      </InitializingContainer>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthenticationPrompt
        authState={authState}
        error={authError}
        hasPasskeys={hasPasskeys}
        onPasswordSubmit={handlePasswordAuth}
        onPasskeyAuth={handlePasskeyAuth}
        onRegisterPasskey={handleRegisterPasskey}
      />
    );
  }

  return <>{children}</>;
};

export default AuthRoute;
