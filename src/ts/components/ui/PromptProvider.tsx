import React, { createContext, useContext, useState, ReactNode } from "react";
import { Prompt } from "./Prompt";

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

  return (
    <PromptContext.Provider value={{ showPrompt }}>
      {children}
      <Prompt
        open={promptState.open}
        title={promptState.title}
        message={promptState.message}
        confirmText={promptState.confirmText}
        cancelText={promptState.cancelText}
        onConfirm={promptState.onConfirm}
        onCancel={promptState.onCancel}
        variant={promptState.variant}
      />
    </PromptContext.Provider>
  );
};
