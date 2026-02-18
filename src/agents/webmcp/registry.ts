// WebMCP Tool Registry for N-APT Application
// Provides structured tool definitions for AI agent interaction

export interface WebMCPTool {
  name: string;
  description: string;
  parameters: WebMCPParameter[];
  returns: WebMCPReturn;
  category: string;
  route?: string;
}

export interface WebMCPParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  enum?: string[] | number[];
  min?: number;
  max?: number;
  default?: any;
  minItems?: number;
  maxItems?: number;
}

export interface WebMCPReturn {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
}

// Spectrum Visualizer Tools
export const spectrumTools: WebMCPTool[] = [
  {
    name: 'setSourceMode',
    description: 'Switch between live SDR device and file input sources',
    parameters: [
      {
        name: 'mode',
        type: 'string',
        description: 'Source mode: live for SDR device, file for file input',
        required: true,
        enum: ['live', 'file']
      }
    ],
    returns: { type: 'boolean', description: 'Success status of mode change' },
    category: 'Source Management',
    route: '/'
  },
  {
    name: 'connectDevice',
    description: 'Connect to SDR hardware device',
    parameters: [
      {
        name: 'deviceType',
        type: 'string',
        description: 'Type of SDR device to connect',
        required: false,
        enum: ['rtl-sdr', 'hackrf', 'mock'],
        default: 'rtl-sdr'
      }
    ],
    returns: { type: 'object', description: 'Device connection status and info' },
    category: 'Source Management',
    route: '/'
  },
  {
    name: 'startCapture',
    description: 'Start capturing I/Q signal data',
    parameters: [
      {
        name: 'duration',
        type: 'number',
        description: 'Capture duration in seconds',
        required: false,
        min: 1,
        max: 60,
        default: 5
      },
      {
        name: 'format',
        type: 'string',
        description: 'Output file format',
        required: false,
        enum: ['.napt', '.csv', '.wav'],
        default: '.napt'
      },
      {
        name: 'frequencyRange',
        type: 'object',
        description: 'Frequency range to capture',
        required: false,
        default: { min: 0, max: 30 }
      }
    ],
    returns: { type: 'object', description: 'Capture job information' },
    category: 'I/Q Capture',
    route: '/'
  },
  {
    name: 'stopCapture',
    description: 'Stop current signal capture',
    parameters: [],
    returns: { type: 'boolean', description: 'Capture stopped successfully' },
    category: 'I/Q Capture',
    route: '/'
  },
  {
    name: 'setActiveArea',
    description: 'Select frequency area of interest for analysis',
    parameters: [
      {
        name: 'area',
        type: 'string',
        description: 'Signal area to activate',
        required: true,
        enum: ['A', 'B']
      }
    ],
    returns: { type: 'object', description: 'Selected area information' },
    category: 'Signal Areas',
    route: '/'
  },
  {
    name: 'setFrequencyRange',
    description: 'Adjust frequency range for signal analysis',
    parameters: [
      {
        name: 'area',
        type: 'string',
        description: 'Area to configure (A or B)',
        required: true,
        enum: ['A', 'B']
      },
      {
        name: 'minFreq',
        type: 'number',
        description: 'Minimum frequency in MHz',
        required: true,
        min: 0,
        max: 1000
      },
      {
        name: 'maxFreq',
        type: 'number',
        description: 'Maximum frequency in MHz',
        required: true,
        min: 0,
        max: 1000
      }
    ],
    returns: { type: 'object', description: 'Updated frequency range' },
    category: 'Signal Areas',
    route: '/'
  },
  {
    name: 'classifySignal',
    description: 'Run ML classification on current signal',
    parameters: [
      {
        name: 'confidence',
        type: 'number',
        description: 'Minimum confidence threshold',
        required: false,
        min: 0,
        max: 1,
        default: 0.8
      }
    ],
    returns: { type: 'object', description: 'Classification results with confidence' },
    category: 'Signal Features',
    route: '/'
  },
  {
    name: 'setFftSize',
    description: 'Adjust FFT size for frequency resolution',
    parameters: [
      {
        name: 'size',
        type: 'number',
        description: 'FFT size (power of 2)',
        required: true,
        enum: [512, 1024, 2048, 4096, 8192]
      }
    ],
    returns: { type: 'number', description: 'Current FFT size' },
    category: 'Signal Display',
    route: '/'
  },
  {
    name: 'setGain',
    description: 'Adjust SDR receiver gain',
    parameters: [
      {
        name: 'gain',
        type: 'number',
        description: 'Gain value in dB',
        required: true,
        min: -10,
        max: 50
      }
    ],
    returns: { type: 'number', description: 'Current gain setting' },
    category: 'Source Settings',
    route: '/'
  },
  {
    name: 'takeSnapshot',
    description: 'Capture current spectrum display',
    parameters: [
      {
        name: 'format',
        type: 'string',
        description: 'Image format',
        required: false,
        enum: ['png', 'svg'],
        default: 'png'
      },
      {
        name: 'showWaterfall',
        type: 'boolean',
        description: 'Include waterfall in snapshot',
        required: false,
        default: true
      }
    ],
    returns: { type: 'object', description: 'Snapshot file information' },
    category: 'Snapshot Controls',
    route: '/'
  }
];

// Analysis Tab Tools
export const analysisTools: WebMCPTool[] = [
  {
    name: 'startAnalysis',
    description: 'Begin ML signal analysis session',
    parameters: [
      {
        name: 'model',
        type: 'string',
        description: 'ML model to use for analysis',
        required: false,
        enum: ['neural-network', 'random-forest', 'svm', 'ensemble'],
        default: 'neural-network'
      },
      {
        name: 'windowSize',
        type: 'number',
        description: 'Analysis window duration in seconds',
        required: false,
        min: 0.1,
        max: 10,
        default: 1.0
      }
    ],
    returns: { type: 'object', description: 'Analysis session information' },
    category: 'ML Analysis',
    route: '/analysis'
  },
  {
    name: 'getAnalysisResults',
    description: 'Retrieve current analysis results',
    parameters: [
      {
        name: 'format',
        type: 'string',
        description: 'Output format for results',
        required: false,
        enum: ['json', 'csv'],
        default: 'json'
      }
    ],
    returns: { type: 'object', description: 'Analysis results and metadata' },
    category: 'ML Analysis',
    route: '/analysis'
  },
  {
    name: 'exportAnalysisResults',
    description: 'Export analysis results to file',
    parameters: [
      {
        name: 'format',
        type: 'string',
        description: 'Export format',
        required: true,
        enum: ['json', 'csv', 'pdf']
      },
      {
        name: 'includeMetadata',
        type: 'boolean',
        description: 'Include analysis metadata',
        required: false,
        default: true
      }
    ],
    returns: { type: 'object', description: 'Export file information' },
    category: 'ML Analysis',
    route: '/analysis'
  }
];

// Draw Signal Tools
export const drawSignalTools: WebMCPTool[] = [
  {
    name: 'setSpikeCount',
    description: 'Set number of spikes in generated signal',
    parameters: [
      {
        name: 'count',
        type: 'number',
        description: 'Number of signal spikes',
        required: true,
        min: 1,
        max: 20
      }
    ],
    returns: { type: 'number', description: 'Current spike count' },
    category: 'Signal Generation',
    route: '/draw-signal'
  },
  {
    name: 'setSpikeWidth',
    description: 'Adjust width of signal spikes',
    parameters: [
      {
        name: 'width',
        type: 'number',
        description: 'Spike width value',
        required: true,
        min: 0.1,
        max: 2.0
      }
    ],
    returns: { type: 'number', description: 'Current spike width' },
    category: 'Signal Generation',
    route: '/draw-signal'
  },
  {
    name: 'generateSignal',
    description: 'Generate synthetic N-APT signal with current parameters',
    parameters: [
      {
        name: 'duration',
        type: 'number',
        description: 'Signal duration in seconds',
        required: false,
        min: 0.1,
        max: 60,
        default: 5.0
      },
      {
        name: 'sampleRate',
        type: 'number',
        description: 'Sample rate in Hz',
        required: false,
        enum: [1000000, 2000000, 3200000],
        default: 3200000
      }
    ],
    returns: { type: 'object', description: 'Generated signal information' },
    category: 'Signal Generation',
    route: '/draw-signal'
  },
  {
    name: 'exportSignal',
    description: 'Export generated signal to file',
    parameters: [
      {
        name: 'format',
        type: 'string',
        description: 'Export format',
        required: true,
        enum: ['.napt', '.csv', '.wav']
      },
      {
        name: 'includeParameters',
        type: 'boolean',
        description: 'Include generation parameters in export',
        required: false,
        default: true
      }
    ],
    returns: { type: 'object', description: 'Export file information' },
    category: 'Signal Generation',
    route: '/draw-signal'
  }
];

// 3D Model Tools
export const model3DTools: WebMCPTool[] = [
  {
    name: 'selectBodyArea',
    description: 'Focus camera on specific anatomical area',
    parameters: [
      {
        name: 'area',
        type: 'string',
        description: 'Body area to select',
        required: true,
        enum: [
          'Head', 'Face', 'Throat', 'Vocal Cords',
          'Arms (Left)', 'Arms (Right)', 'Hands (Left)', 'Hands (Right)',
          'Legs (Left)', 'Legs (Right)', 'Feet (Left)', 'Feet (Right)',
          'Torso', 'Heart', 'Stomach', 'Genitals', 'Buttocks',
          'Ears (Left)', 'Ears (Right)'
        ]
      }
    ],
    returns: { type: 'object', description: 'Selected area and camera position' },
    category: 'Body Areas',
    route: '/3d-model'
  },
  {
    name: 'resetCamera',
    description: 'Reset camera to default position',
    parameters: [],
    returns: { type: 'object', description: 'Camera reset status' },
    category: 'Camera Controls',
    route: '/3d-model'
  },
  {
    name: 'setViewMode',
    description: 'Change camera viewing angle',
    parameters: [
      {
        name: 'mode',
        type: 'string',
        description: 'View mode',
        required: true,
        enum: ['front', 'side', 'back']
      }
    ],
    returns: { type: 'object', description: 'Current view mode' },
    category: 'Camera Controls',
    route: '/3d-model'
  },
  {
    name: 'exportModelData',
    description: 'Export 3D model data and area information',
    parameters: [
      {
        name: 'format',
        type: 'string',
        description: 'Export format',
        required: true,
        enum: ['json', 'obj']
      },
      {
        name: 'includeAreas',
        type: 'boolean',
        description: 'Include body area data',
        required: false,
        default: true
      }
    ],
    returns: { type: 'object', description: 'Export file information' },
    category: 'Data Export',
    route: '/3d-model'
  }
];

// Hotspot Editor Tools
export const hotspotTools: WebMCPTool[] = [
  {
    name: 'createHotspot',
    description: 'Create new 3D hotspot on model',
    parameters: [
      {
        name: 'name',
        type: 'string',
        description: 'Hotspot name/label',
        required: true
      },
      {
        name: 'position',
        type: 'array',
        description: '3D position [x, y, z]',
        required: true,
        minItems: 3,
        maxItems: 3
      },
      {
        name: 'size',
        type: 'string',
        description: 'Hotspot size',
        required: false,
        enum: ['small', 'large'],
        default: 'small'
      }
    ],
    returns: { type: 'object', description: 'Created hotspot information' },
    category: 'Hotspot Creation',
    route: '/hotspot-editor'
  },
  {
    name: 'setSymmetryMode',
    description: 'Set hotspot creation symmetry mode',
    parameters: [
      {
        name: 'mode',
        type: 'string',
        description: 'Symmetry mode',
        required: true,
        enum: ['none', 'x', 'y']
      }
    ],
    returns: { type: 'string', description: 'Current symmetry mode' },
    category: 'Creation Settings',
    route: '/hotspot-editor'
  },
  {
    name: 'selectHotspot',
    description: 'Select hotspot for editing',
    parameters: [
      {
        name: 'id',
        type: 'string',
        description: 'Hotspot ID to select',
        required: true
      }
    ],
    returns: { type: 'object', description: 'Selected hotspot data' },
    category: 'Hotspot Management',
    route: '/hotspot-editor'
  },
  {
    name: 'deleteHotspot',
    description: 'Delete specific hotspot',
    parameters: [
      {
        name: 'id',
        type: 'string',
        description: 'Hotspot ID to delete',
        required: true
      }
    ],
    returns: { type: 'boolean', description: 'Deletion success status' },
    category: 'Hotspot Management',
    route: '/hotspot-editor'
  },
  {
    name: 'exportHotspots',
    description: 'Export all hotspots to JSON file',
    parameters: [
      {
        name: 'includePositions',
        type: 'boolean',
        description: 'Include 3D positions in export',
        required: false,
        default: true
      }
    ],
    returns: { type: 'object', description: 'Export file information' },
    category: 'Data Management',
    route: '/hotspot-editor'
  },
  {
    name: 'importHotspots',
    description: 'Import hotspots from JSON file',
    parameters: [
      {
        name: 'jsonData',
        type: 'string',
        description: 'JSON data for hotspots',
        required: true
      }
    ],
    returns: { type: 'object', description: 'Import results and hotspot count' },
    category: 'Data Management',
    route: '/hotspot-editor'
  }
];

// All tools combined
export const allWebMCPTools: WebMCPTool[] = [
  ...spectrumTools,
  ...analysisTools,
  ...drawSignalTools,
  ...model3DTools,
  ...hotspotTools
];

// Get tools by route
export function getToolsByRoute(route: string): WebMCPTool[] {
  return allWebMCPTools.filter(tool => tool.route === route || tool.route === '/');
}

// Get tool by name
export function getToolByName(name: string): WebMCPTool | undefined {
  return allWebMCPTools.find(tool => tool.name === name);
}

// Get tools by category
export function getToolsByCategory(category: string): WebMCPTool[] {
  return allWebMCPTools.filter(tool => tool.category === category);
}
