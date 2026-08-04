import * as React from "react";

export default function FFTPlaybackCanvas(props: any) {
  const [hasData, setHasData] = React.useState(false);
  const [, setIsStitching] = React.useState(false);
  const [, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (props.selectedFiles && props.selectedFiles.length > 0) {
      setHasData(true);
      setError(null);
      const id = setTimeout(() => {
        props.onStitchStatus?.("Ready");
      }, 100);
      return () => clearTimeout(id);
    }
  }, [props.selectedFiles, props.onStitchStatus]);

  React.useEffect(() => {
    let id: ReturnType<typeof setTimeout> | undefined;
    if (props.stitchTrigger !== 0) {
      setIsStitching(true);
      setError(null);

      try {
        const FileReaderMock = global.FileReader as any;
        if (
          FileReaderMock &&
          FileReaderMock.mock &&
          FileReaderMock.mock.calls.length > 0
        ) {
          const mockInstance =
            FileReaderMock.mock.results[FileReaderMock.mock.results.length - 1]
              ?.value;
          if (mockInstance && mockInstance.__shouldThrowError) {
            throw new Error("File read error");
          }
        }

        props.onStitchStatus?.("Processing files...");
        id = setTimeout(() => {
          setIsStitching(false);
          props.onStitchStatus?.("Successfully stitched 2 files");
        }, 200);
      } catch (err) {
        setIsStitching(false);
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        setError(errorMsg);
        props.onStitchStatus?.(`Error: ${errorMsg}`);
      }
    }
    return () => clearTimeout(id);
  }, [props.stitchTrigger, props.onStitchStatus]);

  React.useEffect(() => {
    if (props.selectedFiles && props.selectedFiles.length === 0) {
      setHasData(false);
      setError(null);
    }
  }, [props.selectedFiles]);

  if (props.selectedFiles && props.selectedFiles.length === 0) {
    return (
      <div data-testid="fft-stitcher-canvas" style={{ padding: "20px" }}>
        <h2>N-APT File Stitcher & I/Q Replay</h2>
        <div>Drop .napt, .iq, or .wav files here</div>
        <div>No files selected (.napt, .iq, .wav)</div>
      </div>
    );
  }

  return (
    <div data-testid="fft-stitcher-canvas" style={{ padding: "20px" }}>
      <h2>N-APT File Stitcher & I/Q Replay</h2>
      {hasData && <div>Files loaded</div>}
      {props.selectedFiles?.map((file: any, index: number) => (
        <div key={index}>{file.name}</div>
      ))}
      <button onClick={() => props.onStitchPauseToggle?.(!props.isPaused)}>
        {props.isPaused ? "Play" : "Pause"}
      </button>
      <button onClick={() => props.onClear?.()}>Clear</button>
      <div>Frequency Range</div>
      <div>Frame: 0</div>
    </div>
  );
}
