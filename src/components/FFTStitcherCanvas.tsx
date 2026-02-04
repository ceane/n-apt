import React, { useEffect } from "react"

interface FFTStitcherCanvasProps {
  selectedFiles: { name: string }[]
  onStitch: (handler: () => void) => void
}

const FFTStitcherCanvas: React.FC<FFTStitcherCanvasProps> = ({
  selectedFiles,
  onStitch,
}) => {
  // Register the stitch handler when component mounts
  useEffect(() => {
    // Pass a proper handler function to the parent
    onStitch(() => {
      // Stitch operation logic here
    })

    // Cleanup when unmounting
    return () => {
      onStitch(() => {})
    }
  }, [onStitch])

  const containerStyle: React.CSSProperties = {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    backgroundColor: "#0a0a0a",
    padding: "20px",
    gap: "20px",
  }

  const headerStyle: React.CSSProperties = {
    fontSize: "12px",
    color: "#888",
    fontWeight: "500",
    textTransform: "uppercase",
    letterSpacing: "1px",
  }

  const statusStyle: React.CSSProperties = {
    padding: "12px",
    backgroundColor: "#1a1a1a",
    border: "1px solid #2a2a2a",
    borderRadius: "8px",
    color: "#ccc",
    textAlign: "center",
  }

  return (
    <div style={containerStyle}>
      <div>
        <h3 style={headerStyle}>FFT Stitcher Canvas</h3>
      </div>

      <div style={statusStyle}>
        {selectedFiles.length === 0
          ? "Select files to begin stitching"
          : `${selectedFiles.length} file(s) selected`}
      </div>

      {selectedFiles.length > 0 && (
        <div
          style={{
            padding: "12px",
            backgroundColor: "#1a1a1a",
            border: "1px solid #2a2a2a",
            borderRadius: "8px",
            color: "#888",
            fontSize: "12px",
            textAlign: "center",
          }}
        >
          Use the sidebar buttons to stitch or clear files
        </div>
      )}
    </div>
  )
}

export default FFTStitcherCanvas
