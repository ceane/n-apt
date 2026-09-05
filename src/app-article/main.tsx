// React entry point for markdown preview app
import { createRoot } from "react-dom/client";
import App from "@n-apt/app-article/App";
import { preloadMarkdown } from "@n-apt/app-article/utils/markdown-source";

// Start the article request while React is mounting so the network wait and
// the initial app setup overlap. App consumes this same in-flight promise.
void preloadMarkdown();

const container = document.getElementById("root");

if (!container) {
  throw new Error("Missing #root element for markdown preview app");
}

const root = createRoot(container);
root.render(<App />);
