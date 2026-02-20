# Sidebar Components

This directory contains all sidebar-related components for the N-APT application.

## Structure

### Main Sidebar Components

- **`Sidebar.tsx`** - Original sidebar component with all functionality
- \*\*`SidebarNew.tsx` - Refactored sidebar using extracted section components

### Section Components

- **`ConnectionStatusSection.tsx`** - Device connection status and controls
- **`SignalDisplaySection.tsx`** - FFT settings and display options
- **`IQCaptureControlsSection.tsx`** - I/Q capture controls (renamed from Capture)
- **`SnapshotControlsSection.tsx`** - Screenshot and export controls
- **`SourceSettingsSection.tsx`** - SDR device settings (PPM, gain, AGC)
- **`FileProcessingSection.tsx`** - File selection and NAPT metadata display

### Supporting Components

- **`DrawMockNAPTSidebar.tsx** - Draw signal parameters sidebar

## Import Patterns

### Within Sidebar Folder

Components within the sidebar folder use relative imports for local components:

```typescript
import DrawMockNAPTSidebar from "./DrawMockNAPTSidebar";
```

### From Outside Sidebar Folder

External components import from the sidebar folder using @n-apt namespace:

```typescript
import { Sidebar } from "@n-apt/components/sidebar/Sidebar";
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
```

## Usage

### Main Sidebar

```typescript
import { Sidebar } from "@n-apt/components/sidebar/Sidebar";
```

### Refactored Sidebar

```typescript
import { SidebarNew } from "@n-apt/components/sidebar/SidebarNew";
```

### Individual Sections

```typescript
import { IQCaptureControlsSection } from "@n-apt/components/sidebar/IQCaptureControlsSection";
import { ConnectionStatusSection } from "@n-apt/components/sidebar/ConnectionStatusSection";
```

## Benefits

- **Organization**: All sidebar-related code is centralized
- **Maintainability**: Easy to find and modify sidebar functionality
- **Reusability**: Section components can be used independently
- **Testing**: Smaller components are easier to unit test
- **Namespace Consistency**: Follows @n-apt namespace rules
