import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { addNotification, removeNotification } from "@n-apt/redux/slices/notificationsSlice";

export const useRustRebuildStatus = () => {
  const dispatch = useDispatch();
  const wasRebuildingRef = useRef(false);
  const notificationId = "rust-rebuild-notification";

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const checkStatus = async () => {
      try {
        const res = await fetch("/rebuild-status");
        if (!res.ok) return;
        const data = await res.json();
        
        if (data.rebuilding) {
          if (!wasRebuildingRef.current) {
            wasRebuildingRef.current = true;
            dispatch(
              addNotification({
                id: notificationId,
                type: "warning",
                title: "Rebuilding Rust Backend...",
                message: "Rust source files modified. Compiling new binary...",
                duration: 0, // persistent until finished
              })
            );
          }
        } else {
          if (wasRebuildingRef.current) {
            wasRebuildingRef.current = false;
            dispatch(removeNotification(notificationId));
            
            const success = data.success !== false;
            dispatch(
              addNotification({
                id: `rust-rebuild-finished-${Date.now()}`,
                type: success ? "success" : "error",
                title: success ? "Rust Backend Reloaded" : "Rust Rebuild Failed",
                message: success 
                  ? "[check] Rebuild of backend complete." 
                  : "Check terminal output for details.",
                duration: 5000,
              })
            );
          }
        }
      } catch {
        // Silently ignore errors when server is restarting
      }
    };

    const interval = setInterval(checkStatus, 1000);
    return () => clearInterval(interval);
  }, [dispatch]);
};
