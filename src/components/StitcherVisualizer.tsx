import React from 'react'

interface StitcherVisualizerProps {
  selectedFiles: { name: string }[]
  onStitch: (handler: () => void) => void
  onClear: () => void
}

const StitcherVisualizer: React.FC<StitcherVisualizerProps> = ({
  selectedFiles,
  onStitch,
  onClear,
}) => {
  const containerStyle: React.CSSProperties = {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    backgroundColor: '#0a0a0a',
    padding: '20px',
    gap: '20px',
  }

  const headerStyle: React.CSSProperties = {
    fontSize: '12px',
    color: '#888',
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: '1px',
  }

  const statusStyle: React.CSSProperties = {
    padding: '12px',
    backgroundColor: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    color: '#ccc',
    textAlign: 'center',
  }

  const buttonContainerStyle: React.CSSProperties = {
    display: 'flex',
    gap: '12px',
  }

  const buttonStyle: React.CSSProperties = {
    flex: 1,
    padding: '12px',
    backgroundColor: '#1a1a1a',
    border: '1px solid #2a2a2a',
    borderRadius: '8px',
    color: '#ccc',
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '12px',
    fontWeight: '500',
    cursor: 'pointer',
    textAlign: 'center',
  }

  return (
    <div style={containerStyle}>
      <div>
        <h3 style={headerStyle}>Stitcher Visualizer</h3>
      </div>
      
      <div style={statusStyle}>
        {selectedFiles.length === 0 
          ? 'Select files to begin stitching'
          : `${selectedFiles.length} file(s) selected`
        }
      </div>
      
      {selectedFiles.length > 0 && (
        <div style={buttonContainerStyle}>
          <button 
            style={buttonStyle}
            onClick={() => onStitch(() => console.log('Stitching...'))}
          >
            Stitch
          </button>
          <button style={buttonStyle} onClick={onClear}>
            Clear
          </button>
        </div>
      )}
    </div>
  )
}

export default StitcherVisualizer
