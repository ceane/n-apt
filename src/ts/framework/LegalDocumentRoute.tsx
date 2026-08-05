import React from "react";
import { LegalDocumentRoute as LegalDocumentPage } from "@n-apt/routes/LegalDocumentRoute";

export default function FrameworkLegalDocumentRoute() {
  return <LegalDocumentPage />;
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/framework/RouteErrorBoundary";
