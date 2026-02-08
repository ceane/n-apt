import React, { useEffect, useState } from "react"

interface FFTStitcherCanvasProps {
  selectedFiles: { name: string }[]
  onStitch: (handler: () => Promise<void>) => void
}

const FFTStitcherCanvas: React.FC<FFTStitcherCanvasProps> = ({
  selectedFiles,
  onStitch,
}) => {
  const [stitchStatus, setStitchStatus] = useState<string>("")

  // Register the stitch handler when component mounts
  useEffect(() => {
    // Pass a proper handler function to the parent
    onStitch(async () => {
      if (selectedFiles.length === 0) {
        setStitchStatus("No files selected for stitching")
        return
      }

      try {
        setStitchStatus(`Stitching ${selectedFiles.length} files...`)
        
        // Simulate stitching operation
        // In a real implementation, this would:
        // 1. Load the selected files
        // 2. Align their frequency ranges
        // 3. Combine the waterfall data
        // 4. Create a stitched output
        
        await new Promise(resolve => setTimeout(resolve, 1000)) // Simulate processing
        
        setStitchStatus(`Successfully stitched ${selectedFiles.length} files`)
        
        // Clear status after 3 seconds
        setTimeout(() => setStitchStatus(""), 3000)
      } catch (error) {
        setStitchStatus(`Stitching failed: ${error}`)
        setTimeout(() => setStitchStatus(""), 3000)
      }
    })

    // Cleanup when unmounting
    return () => {
      onStitch(async () => {})
    }
  }, [onStitch, selectedFiles])

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
        {stitchStatus || 
          (selectedFiles.length === 0
            ? "Select files to begin stitching"
            : `${selectedFiles.length} file(s) selected`)}
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
