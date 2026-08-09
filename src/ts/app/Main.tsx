import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "@n-apt/app/App";
import ReduxProvider from "@n-apt/app/ReduxProvider";
import { HelmetProvider } from "react-helmet-async";
import "../fonts.css";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <React.StrictMode>
    <ReduxProvider>
      <HelmetProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </HelmetProvider>
    </ReduxProvider>
  </React.StrictMode>,
);
