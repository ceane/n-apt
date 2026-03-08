import React, { createContext, useContext, useState, ReactNode } from "react";

interface PromptOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel?: () => void;
  variant?: "primary" | "danger";
}

interface PromptContextType {
  showPrompt: (options: PromptOptions) => void;
}

const PromptContext = createContext<PromptContextType | undefined>(undefined);

export const usePrompt = () => {
  const context = useContext(PromptContext);
  if (!context) {
    throw new Error("usePrompt must be used within a PromptProvider");
  }
  return context.showPrompt;
};

interface PromptState {
  open: boolean;
  title: string;
  message: string;
  confirmText: string;
  cancelText: string;
  onConfirm: () => void;
  onCancel: () => void;
  variant: "primary" | "danger";
}

export const PromptProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [promptState, setPromptState] = useState<PromptState>({
    open: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    onConfirm: () => { },
    onCancel: () => { },
    variant: "primary",
  });

  const showPrompt = (options: PromptOptions) => {
    setPromptState({
      open: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText || "Confirm",
      cancelText: options.cancelText || "Cancel",
      onConfirm: () => {
        options.onConfirm();
        setPromptState(prev => ({ ...prev, open: false }));
      },
      onCancel: () => {
        options.onCancel?.();
        setPromptState(prev => ({ ...prev, open: false }));
      },
      variant: options.variant || "primary",
    });
  };

  const handleCancel = () => {
    promptState.onCancel();
  };

  const handleConfirm = () => {
    promptState.onConfirm();
  };

  return (
    <PromptContext.Provider value={{ showPrompt }}>
      {children}
      {promptState.open && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            width: "100vw",
            height: "100vh",
            background: "rgba(0, 0, 0, 0.8)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 99999,
            backdropFilter: "blur(4px)",
          }}
          onClick={handleCancel}
        >
          <div
            style={{
              background: "#1a1a1a",
              border: "1px solid #333",
              borderRadius: "12px",
              padding: "24px",
              minWidth: "320px",
              maxWidth: "90vw",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.9)",
              fontFamily: "'JetBrains Mono', monospace",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              fontSize: "16px",
              fontWeight: "700",
              color: "#fff",
              marginBottom: "12px",
            }}>
              {promptState.title}
            </div>
            <div style={{
              fontSize: "13px",
              color: "#ccc",
              lineHeight: "1.5",
              marginBottom: "20px",
            }}>
              {promptState.message}
            </div>
            <div style={{
              display: "flex",
              gap: "12px",
              justifyContent: "flex-end",
            }}>
              <button
                onClick={handleCancel}
                style={{
                  background: "#333",
                  color: "#ccc",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 16px",
                  fontSize: "12px",
                  fontWeight: "600",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {promptState.cancelText}
              </button>
              <button
                onClick={handleConfirm}
                style={{
                  background: promptState.variant === "danger" ? "#ff4444" : "#00d4ff",
                  color: "#000",
                  border: "none",
                  borderRadius: "6px",
                  padding: "10px 16px",
                  fontSize: "12px",
                  fontWeight: "600",
                  fontFamily: "inherit",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                }}
              >
                {promptState.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </PromptContext.Provider>
  );
};
