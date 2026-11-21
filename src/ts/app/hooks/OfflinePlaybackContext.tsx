import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type OfflineUnlockMode = "password" | "fido";
export type OfflineUnlockStatus = "locked" | "unlocking" | "decrypted" | "error";

interface OfflinePlaybackValue {
  enabled: boolean;
  key: CryptoKey | null;
  mode: OfflineUnlockMode | null;
  captureSalt: Uint8Array | null;
  status: OfflineUnlockStatus;
  error: string | null;
  setUnlockedKey: (
    key: CryptoKey,
    mode: OfflineUnlockMode,
    captureSalt?: Uint8Array | null,
  ) => void;
  markDecrypted: () => void;
  setError: (message: string) => void;
  lock: () => void;
}

const noop = () => undefined;
const OfflinePlaybackContext = createContext<OfflinePlaybackValue>({
  enabled: false,
  key: null,
  mode: null,
  captureSalt: null,
  status: "locked",
  error: null,
  setUnlockedKey: noop,
  markDecrypted: noop,
  setError: noop,
  lock: noop,
});

export const OfflinePlaybackProvider: React.FC<{
  enabled: boolean;
  children: React.ReactNode;
}> = ({ enabled, children }) => {
  const [key, setKey] = useState<CryptoKey | null>(null);
  const [mode, setMode] = useState<OfflineUnlockMode | null>(null);
  const [captureSalt, setCaptureSalt] = useState<Uint8Array | null>(null);
  const [status, setStatus] = useState<OfflineUnlockStatus>("locked");
  const [error, setErrorMessage] = useState<string | null>(null);

  const lock = useCallback(() => {
    setCaptureSalt((current) => {
      current?.fill(0);
      return null;
    });
    setKey(null);
    setMode(null);
    setStatus("locked");
    setErrorMessage(null);
  }, []);

  useEffect(() => {
    if (!enabled) lock();
  }, [enabled, lock]);

  const setUnlockedKey = useCallback(
    (nextKey: CryptoKey, nextMode: OfflineUnlockMode, nextSalt?: Uint8Array | null) => {
      setCaptureSalt((current) => {
        current?.fill(0);
        return nextSalt?.slice() ?? null;
      });
      setKey(nextKey);
      setMode(nextMode);
      setStatus("unlocking");
      setErrorMessage(null);
    },
    [],
  );

  const markDecrypted = useCallback(() => {
    setCaptureSalt((current) => {
      current?.fill(0);
      return null;
    });
    setStatus("decrypted");
    setErrorMessage(null);
  }, []);

  const setError = useCallback((message: string) => {
    setStatus("error");
    setErrorMessage(message);
  }, []);

  const value = useMemo(
    () => ({
      enabled,
      key,
      mode,
      captureSalt,
      status,
      error,
      setUnlockedKey,
      markDecrypted,
      setError,
      lock,
    }),
    [
      enabled,
      key,
      mode,
      captureSalt,
      status,
      error,
      setUnlockedKey,
      markDecrypted,
      setError,
      lock,
    ],
  );

  return (
    <OfflinePlaybackContext.Provider value={value}>
      {children}
    </OfflinePlaybackContext.Provider>
  );
};

export const useOfflinePlayback = () => useContext(OfflinePlaybackContext);
