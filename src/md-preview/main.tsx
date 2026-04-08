import React from "react";
import { createRoot } from "react-dom/client";
import App from "@n-apt/md-preview/App";

const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing #root element for markdown preview app");
}

const root = createRoot(container);
root.render(<App />);
