import { act, renderHook } from "@testing-library/react";
import { useDragAndDropFiles } from "@n-apt/hooks/useDragAndDropFiles";

describe("useDragAndDropFiles", () => {
  it("extracts files from dataTransfer items on drop", () => {
    const onFilesDropped = jest.fn();
    const file = new File(["abc"], "capture.wav", {
      type: "application/octet-stream",
    });

    const { result } = renderHook(() =>
      useDragAndDropFiles({
        onFilesDropped,
      }),
    );

    act(() => {
      result.current.onDrop({
        preventDefault: jest.fn(),
        stopPropagation: jest.fn(),
        dataTransfer: {
          items: [
            {
              kind: "file",
              getAsFile: () => file,
            },
          ],
          files: [],
        },
      } as any);
    });

    expect(onFilesDropped).toHaveBeenCalledWith([file]);
    expect(result.current.isDragging).toBe(false);
  });
});
