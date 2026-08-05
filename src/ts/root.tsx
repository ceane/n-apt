import React from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { HelmetProvider } from "react-helmet-async";
import ReduxProvider from "@n-apt/components/ReduxProvider";
import ReduxThemeProvider from "@n-apt/components/ReduxThemeProvider";
import { AuthProvider } from "@n-apt/hooks/useAuthentication";
import { AuthenticationRoute as AuthRoute } from "@n-apt/routes/AuthenticationRoute";
import { PostAuthLandingRedirect } from "@n-apt/components/PostAuthLandingRedirect";
import "./fonts.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>N-APT</title>
        <Meta />
        <Links />
      </head>
      <body>
        <main id="root">{children}</main>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export function HydrateFallback() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        color: "#888888",
        fontFamily: "monospace",
        fontSize: 12,
      }}
    >
      Loading N-APT…
    </div>
  );
}

export default function Root() {
  return (
    <ReduxProvider>
      <HelmetProvider>
        <ReduxThemeProvider>
          <AuthProvider>
            <PostAuthLandingRedirect>
              <AuthRoute>
                <Outlet />
              </AuthRoute>
            </PostAuthLandingRedirect>
          </AuthProvider>
        </ReduxThemeProvider>
      </HelmetProvider>
    </ReduxProvider>
  );
}
