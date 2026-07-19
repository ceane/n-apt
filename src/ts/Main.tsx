import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "@n-apt/App";
import ReduxProvider from "@n-apt/components/ReduxProvider";
import { HelmetProvider } from "react-helmet-async";
import "katex/dist/katex.min.css";
import "./fonts.css";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <React.StrictMode>
    <ReduxProvider>
      <HelmetProvider>
        <App />
      </HelmetProvider>
    </ReduxProvider>
  </React.StrictMode>,
);
