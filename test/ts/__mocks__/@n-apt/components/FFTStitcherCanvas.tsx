import * as React from "react"

export default function FFTStitcherCanvas(props: any) {
  const [hasData, setHasData] = React.useState(false)
  
  React.useEffect(() => {
    if (props.selectedFiles && props.selectedFiles.length > 0) {
      setHasData(true)
      // Simulate stitching process
      setTimeout(() => {
        props.onStitchStatus?.("Ready")
      }, 100)
    }
  }, [props.selectedFiles, props.onStitchStatus])

  React.useEffect(() => {
    if (props.stitchTrigger !== 0) {
      props.onStitchStatus?.("Processing")
      setTimeout(() => {
        props.onStitchStatus?.("Ready")
      }, 200)
    }
  }, [props.stitchTrigger, props.onStitchStatus])

  return React.createElement("div", { 
    "data-testid": "fft-stitcher-canvas",
    style: { padding: "20px" }
  }, [
    React.createElement("h2", null, "N-APT File Stitcher & I/Q Replay"),
    hasData && React.createElement("div", null, "Files loaded"),
    props.selectedFiles?.map((file: any, index: number) => 
      React.createElement("div", { key: index }, file.name)
    ),
    React.createElement("button", {
      onClick: () => props.onStitchPauseToggle?.(!props.isPaused)
    }, props.isPaused ? "Play" : "Pause"),
    React.createElement("button", {
      onClick: () => props.onClear?.()
    }, "Clear"),
    React.createElement("div", null, "Frequency Range"),
    React.createElement("div", null, "Frame: 0")
  ])
}
