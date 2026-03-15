import React from "react";
import ReactDOM from "react-dom/client";
import App from "@n-apt/App";
import ReduxProvider from "@n-apt/components/ReduxProvider";
import "katex/dist/katex.min.css";


// Register service worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then((registration) => {
        console.log('SW registered: ', registration);

        // Check if there's a new service worker waiting
        if (registration.waiting) {
          console.log('SW waiting: New service worker available');
        }

        if (registration.installing) {
          console.log('SW installing: Service worker is installing');
        }

        // Listen for updates
        registration.addEventListener('updatefound', () => {
          console.log('SW update found: New service worker being installed');
          const newWorker = registration.installing;
          if (newWorker) {
            newWorker.addEventListener('statechange', () => {
              console.log('SW state changed:', newWorker.state);
              if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('SW updated: New content available, please refresh');
              }
            });
          }
        });
      })
      .catch((registrationError) => {
        console.error('SW registration failed: ', registrationError);
      });

    // Handle controller changes (when a new service worker takes control)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      console.log('SW controller changed: New service worker is controlling the page');
      window.location.reload();
    });
  });
} else {
  console.log('Service Worker is not supported in this browser');
}

console.log("Main.tsx is executing...");
const root = ReactDOM.createRoot(
  document.getElementById("root") as HTMLElement,
);

root.render(
  <React.StrictMode>
    <ReduxProvider>
      <App />
    </ReduxProvider>
  </React.StrictMode>,
);
