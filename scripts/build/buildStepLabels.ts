const completedStepLabels: Record<string, string> = {
  "Cleaning up existing processes": "Cleaned up existing processes.",
  "Validating Rust backend code": "Validated Rust backend.",
  "Validating signals.yaml": "Validated signals.yaml.",
  "Starting Redis database server": "Running Redis DB server.",
  "Swapping Redis Database": "Restored cell tower data.",
  "Swapping Redis Database...": "Restored cell tower data.",
  "Restoring OpenCellID tower database from disk": "Restored cell tower data.",
  "Building WASM SIMD module": "Built WASM SIMD modules.",
  "Building N-APT Encrypted Modules": "Built N-APT Encrypted Modules.",
  "Building and starting Rust backend": "Rust backend running...",
  "Starting frontend server": "Frontend server running...",
};

export function getCompletedStepLabel(description: string): string {
  return completedStepLabels[description] ?? description;
}
