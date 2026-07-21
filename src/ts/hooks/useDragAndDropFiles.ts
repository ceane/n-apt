import { useCallback, useState, type DragEvent } from "react";

interface UseDragAndDropFilesOptions {
  onFilesDropped: (files: File[]) => void;
  acceptedTypes?: string[];
}

const extractFiles = (dataTransfer: DataTransfer): File[] => {
  if (dataTransfer.items && dataTransfer.items.length > 0) {
    const itemFiles = Array.from(dataTransfer.items).reduce<File[]>(
      (acc, item) => {
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) acc.push(file);
        }
        return acc;
      },
      [],
    );

    if (itemFiles.length > 0) {
      return itemFiles;
    }
  }

  return dataTransfer.files ? Array.from(dataTransfer.files) : [];
};

const isFileTypeAccepted = (file: File, acceptedTypes: string[]): boolean => {
  if (acceptedTypes.length === 0) return true;

  const fileName = file.name.toLowerCase();
  const fileType = file.type.toLowerCase();

  return acceptedTypes.some((acceptedType) => {
    if (acceptedType.startsWith(".")) {
      return fileName.endsWith(acceptedType.toLowerCase());
    }
    if (acceptedType.endsWith("/*")) {
      const baseType = acceptedType.slice(0, -1);
      return fileType.startsWith(baseType);
    }
    return (
      fileType === acceptedType.toLowerCase() ||
      fileName.endsWith(`.${acceptedType.toLowerCase()}`)
    );
  });
};

export const useDragAndDropFiles = ({
  onFilesDropped,
  acceptedTypes = [],
}: UseDragAndDropFilesOptions) => {
  const [isDragging, setIsDragging] = useState(false);
  const [dragError, setDragError] = useState<string | null>(null);
  const [showGlow, setShowGlow] = useState(false);

  const onDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
    setDragError(null);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
  }, []);

  const onDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }, []);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setIsDragging(false);

      const files = extractFiles(event.dataTransfer);
      if (files.length === 0) return;

      const validFiles: File[] = [];
      const invalidFiles: string[] = [];

      files.forEach((file) => {
        if (isFileTypeAccepted(file, acceptedTypes)) {
          validFiles.push(file);
        } else {
          invalidFiles.push(file.name);
        }
      });

      if (invalidFiles.length > 0) {
        setDragError(
          `Unsupported file type(s): ${invalidFiles.join(", ")}. Accepted: ${acceptedTypes.join(", ")}`,
        );
      } else {
        setDragError(null);
        setShowGlow(true);
        setTimeout(() => setShowGlow(false), 800);
      }

      if (validFiles.length > 0) {
        onFilesDropped(validFiles);
      }
    },
    [onFilesDropped, acceptedTypes],
  );

  const clearError = useCallback(() => {
    setDragError(null);
  }, []);

  return {
    isDragging,
    dragError,
    showGlow,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
    clearError,
  };
};
