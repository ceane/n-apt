import React from "react";
import ReactDOM from "react-dom/client";
import App from "@n-apt/App";

console.log("Main.tsx is executing...");
const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);

root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
