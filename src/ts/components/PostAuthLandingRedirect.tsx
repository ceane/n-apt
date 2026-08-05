import React, { useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { useAuthentication } from "@n-apt/hooks/useAuthentication";
import { getPostAuthLandingPath } from "@n-apt/utils/bypassStartPage";

interface PostAuthLandingRedirectProps {
  children?: React.ReactNode;
}

/**
 * After a fresh login, leave `/auth` or `/` for the start page
 * (`/get-started`), or `/` when the user has enabled bypassing it.
 *
 * This component is intentionally mounted OUTSIDE the auth gate so it can
 * observe the full auth lifecycle. A returning user whose stored session is
 * restored goes straight from "initializing" to "authenticated" — no redirect.
 * A user who just logged in was first shown the login UI (auth check finished,
 * still unauthenticated) and then became authenticated — that's the redirect.
 *
 * While a redirect is pending the app content is not rendered (children are
 * dropped), and the navigation runs in useLayoutEffect — before the browser
 * paints — so the authenticated app never flashes on screen.
 */
export const PostAuthLandingRedirect: React.FC<PostAuthLandingRedirectProps> = ({
  children,
}) => {
  const { isAuthenticated, isInitialAuthCheck } = useAuthentication();
  const location = useLocation();
  const navigate = useNavigate();
  const sawLoginScreenRef = useRef(false);
  const [pendingRedirect, setPendingRedirect] = useState<string | null>(null);

  const isProtectedEntry =
    location.pathname === "/auth" || location.pathname === "/";

  // Auth check finished while still unauthenticated on a protected entry:
  // the login UI was shown to the user.
  if (!isAuthenticated && !isInitialAuthCheck && isProtectedEntry) {
    sawLoginScreenRef.current = true;
  }

  // A fresh login just completed on a protected entry. Compute the landing
  // path during render so we can block children this same commit.
  if (
    pendingRedirect === null &&
    sawLoginScreenRef.current &&
    isAuthenticated &&
    isProtectedEntry
  ) {
    const landingPath = getPostAuthLandingPath();
    if (landingPath !== location.pathname) {
      setPendingRedirect(landingPath);
    }
  }

  useLayoutEffect(() => {
    if (pendingRedirect === null) {
      return;
    }
    navigate(pendingRedirect, { replace: true });
    setPendingRedirect(null);
  }, [pendingRedirect, navigate]);

  // Drop children while a redirect is pending so the app never paints.
  if (pendingRedirect !== null) {
    return null;
  }

  return <>{children}</>;
};

export default PostAuthLandingRedirect;
