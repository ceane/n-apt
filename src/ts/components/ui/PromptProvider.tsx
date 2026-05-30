import React, {
  createContext,
  useContext,
  useState,
  ReactNode,
  useRef,
  useEffect,
} from "react";
import styled from "styled-components";
import { Prompt } from "./Prompt";

const PasswordDialog = styled.dialog`
  background: ${({ theme }) => theme.surface};
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 12px;
  padding: 24px;
  min-width: 320px;
  max-width: 90vw;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.9);
  font-family: ${({ theme }) => theme.typography?.mono || "JetBrains Mono"};
  color: ${({ theme }) => theme.textPrimary};
  outline: none;
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  margin: 0;

  &::backdrop {
    background: rgba(0, 0, 0, 0.8);
    backdrop-filter: blur(4px);
  }
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 16px;
`;

const Title = styled.div`
  font-size: ${({ theme }) => theme.typography.headingSize};
  font-weight: 700;
  margin-bottom: 4px;
`;

const Message = styled.div`
  font-size: ${({ theme }) => theme.typography.bodySize};
  color: ${({ theme }) => theme.textSecondary};
  line-height: 1.5;
`;

const Input = styled.input`
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid ${({ theme }) => theme.border};
  border-radius: 6px;
  padding: 10px 12px;
  color: #fff;
  font-family: inherit;
  font-size: ${({ theme }) => theme.typography.bodySize};
  outline: none;

  &:focus {
    border-color: ${({ theme }) => theme.primary};
  }
`;

const ButtonRow = styled.div`
  display: flex;
  gap: 12px;
  justify-content: flex-end;
`;

const Button = styled.button<{ $primary?: boolean }>`
  background: ${({ theme, $primary }) =>
    $primary ? theme.primary : "transparent"};
  color: ${({ theme, $primary }) =>
    $primary
      ? theme.mode === "light"
        ? "#fff"
        : "#000"
      : theme.textSecondary};
  border: ${({ theme, $primary }) =>
    $primary ? "none" : `1px solid ${theme.border}`};
  border-radius: 6px;
  padding: 8px 16px;
  font-size: ${({ theme }) => theme.typography.codeSize};
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${({ theme, $primary }) =>
      $primary ? theme.textPrimary : theme.surfaceHover};
  }
`;

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
  showPasswordPrompt: (onConfirm: (password: string) => void) => void;
}

const PromptContext = createContext<PromptContextType | undefined>(undefined);

export const usePrompt = () => {
  const context = useContext(PromptContext);
  if (!context) {
    throw new Error("usePrompt must be used within a PromptProvider");
  }
  return context;
};

export const PromptProvider: React.FC<{ children: ReactNode }> = ({
  children,
}) => {
  const [promptState, setPromptState] = useState({
    open: false,
    title: "",
    message: "",
    confirmText: "Confirm",
    cancelText: "Cancel",
    onConfirm: () => {},
    onCancel: () => {},
    variant: "primary" as "primary" | "danger",
  });

  const [passwordState, setPasswordState] = useState({
    open: false,
    onConfirm: (_password: string) => {},
  });

  const passwordRef = useRef<HTMLDialogElement>(null);
  const passwordInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (passwordState.open) {
      passwordRef.current?.showModal();
      passwordInputRef.current?.focus();
    } else {
      passwordRef.current?.close();
    }
  }, [passwordState.open]);

  const showPrompt = (options: PromptOptions) => {
    setPromptState({
      open: true,
      title: options.title,
      message: options.message,
      confirmText: options.confirmText || "Confirm",
      cancelText: options.cancelText || "Cancel",
      onConfirm: () => {
        options.onConfirm();
        setPromptState((prev) => ({ ...prev, open: false }));
      },
      onCancel: () => {
        options.onCancel?.();
        setPromptState((prev) => ({ ...prev, open: false }));
      },
      variant: options.variant || "primary",
    });
  };

  const showPasswordPrompt = (onConfirm: (password: string) => void) => {
    setPasswordState({ open: true, onConfirm });
  };

  const handlePasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const password = passwordInputRef.current?.value || "";
    passwordState.onConfirm(password);
    setPasswordState({ open: false, onConfirm: () => {} });
    if (passwordInputRef.current) passwordInputRef.current.value = "";
  };

  return (
    <PromptContext.Provider value={{ showPrompt, showPasswordPrompt }}>
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
      <PasswordDialog
        ref={passwordRef}
        onClose={() => setPasswordState({ open: false, onConfirm: () => {} })}
      >
        <Form onSubmit={handlePasswordSubmit}>
          <div>
            <Title>Unlock Vault</Title>
            <Message>
              Enter your password to derive the decryption key and unlock the
              vault.
            </Message>
          </div>
          <input
            type="text"
            name="username"
            autoComplete="username"
            value="n-apt-user"
            readOnly
            style={{ display: "none" }}
          />
          <Input
            ref={passwordInputRef}
            type="password"
            placeholder="Vault Password"
            autoComplete="current-password"
            required
          />
          <ButtonRow>
            <Button
              type="button"
              onClick={() =>
                setPasswordState({ open: false, onConfirm: () => {} })
              }
            >
              Cancel
            </Button>
            <Button type="submit" $primary>
              Unlock
            </Button>
          </ButtonRow>
        </Form>
      </PasswordDialog>
    </PromptContext.Provider>
  );
};
