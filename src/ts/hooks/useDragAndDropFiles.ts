import { useCallback, useState, type DragEvent } from "react";

interface UseDragAndDropFilesOptions {
  onFilesDropped: (files: File[]) => void;
}

const extractFiles = (dataTransfer: DataTransfer): File[] => {
  if (dataTransfer.items && dataTransfer.items.length > 0) {
    const itemFiles = Array.from(dataTransfer.items)
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => !!file);

    if (itemFiles.length > 0) {
      return itemFiles;
    }
  }

  return dataTransfer.files ? Array.from(dataTransfer.files) : [];
};

export const useDragAndDropFiles = ({
  onFilesDropped,
}: UseDragAndDropFilesOptions) => {
  const [isDragging, setIsDragging] = useState(false);

  const onDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(true);
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
      if (files.length > 0) {
        onFilesDropped(files);
      }
    },
    [onFilesDropped],
  );

  return {
    isDragging,
    onDragEnter,
    onDragOver,
    onDragLeave,
    onDrop,
  };
};
