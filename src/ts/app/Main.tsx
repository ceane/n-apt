import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "@n-apt/app/App";
import ReduxProvider from "@n-apt/app/ReduxProvider";
import { HelmetProvider } from "react-helmet-async";
import "../fonts.css";

const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

// R3F's Canvas cleanup is delayed by 500 ms. React StrictMode intentionally
// cleans up and remounts effects in development, which can make that delayed
// cleanup dispose the newly mounted auth-page renderers and lose their WebGL
// contexts. The framework entry already mounts without StrictMode; keep the
// legacy Vite entry consistent so the auth models remain mounted in dev.
root.render(
  <ReduxProvider>
    <HelmetProvider>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </HelmetProvider>
  </ReduxProvider>,
);
