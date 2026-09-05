import React, { createContext, useContext, useMemo, useState } from "react";

interface DrawSignalPaginationContextValue {
  pageIndex: number;
  setPageIndex: React.Dispatch<React.SetStateAction<number>>;
  pageCount: number;
}

const DrawSignalPaginationContext =
  createContext<DrawSignalPaginationContextValue | null>(null);

export const DrawSignalPaginationProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [pageIndex, setPageIndex] = useState(0);
  const value = useMemo(
    () => ({ pageIndex, setPageIndex, pageCount: 2 }),
    [pageIndex],
  );

  return (
    <DrawSignalPaginationContext.Provider value={value}>
      {children}
    </DrawSignalPaginationContext.Provider>
  );
};

export const useDrawSignalPagination = () => {
  const context = useContext(DrawSignalPaginationContext);
  if (!context) {
    throw new Error(
      "useDrawSignalPagination must be used within DrawSignalPaginationProvider",
    );
  }
  return context;
};
