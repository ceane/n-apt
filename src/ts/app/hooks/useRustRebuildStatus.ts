import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import {
  addNotification,
  removeNotification,
  updateNotification,
} from "@n-apt/redux/slices/notificationsSlice";
import {
  formatRebuildNotificationMessage,
  shouldShowRebuildNotification,
  type RebuildStatusResponse,
} from "@n-apt/app/infrastructure/services/rebuildStatusMessage";

const notificationId = "rust-rebuild-notification";

export const useRustRebuildStatus = () => {
  const dispatch = useDispatch();
  const wasRebuildingRef = useRef(false);
  const lastProgressRef = useRef<string>("");

  useEffect(() => {
    if (!import.meta.env.DEV) return;

    const checkStatus = async () => {
      try {
        const res = await fetch("/rebuild-status");
        if (!res.ok) return;
        const data = (await res.json()) as RebuildStatusResponse;
        const showToast = shouldShowRebuildNotification(data);

        if (showToast) {
          const message = formatRebuildNotificationMessage(data);
          if (!wasRebuildingRef.current) {
            wasRebuildingRef.current = true;
            lastProgressRef.current = message;
            dispatch(
              addNotification({
                id: notificationId,
                type: "warning",
                title: "Rebuilding Rust Backend...",
                message,
                duration: 0,
              }),
            );
            return;
          }

          if (message !== lastProgressRef.current) {
            lastProgressRef.current = message;
            dispatch(
              updateNotification({
                id: notificationId,
                updates: {
                  title: "Rebuilding Rust Backend...",
                  message,
                },
              }),
            );
          }
          return;
        }

        if (wasRebuildingRef.current) {
          wasRebuildingRef.current = false;
          lastProgressRef.current = "";
          dispatch(removeNotification(notificationId));

          // Waiting/pending episodes should not produce a success/failure toast.
          if (data.pending || data.phase === "waiting") {
            return;
          }

          const success = data.success !== false;
          dispatch(
            addNotification({
              id: `rust-rebuild-finished-${Date.now()}`,
              type: success ? "success" : "error",
              title: success
                ? "Rust Backend Reloaded"
                : "Rust Rebuild Failed",
              message: success
                ? data.progress || "[check] Rebuild of backend complete."
                : data.progress || "Check terminal output for details.",
              duration: 5000,
            }),
          );
        }
      } catch {
        // Silently ignore errors when server is restarting
      }
    };

    const interval = setInterval(checkStatus, 500);
    return () => clearInterval(interval);
  }, [dispatch]);
};
