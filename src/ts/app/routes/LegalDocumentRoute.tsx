import React from "react";
import { LegalDocumentRoute as LegalDocumentPage } from "@n-apt/app/routes/pages/LegalDocumentRoute";

export default function FrameworkLegalDocumentRoute() {
  return <LegalDocumentPage />;
}

export { RouteErrorBoundary as ErrorBoundary } from "@n-apt/app/routes/RouteErrorBoundary";
