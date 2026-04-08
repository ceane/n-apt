---
trigger: manual
---

# Namespace Rules for N-APT Project

## @n-apt Namespace Requirement

All internal imports and references should use the "@n-apt" namespace for consistency and maintainability.

### Examples:

✅ **Correct:**

```typescript
import { FFTCanvas } from "@n-apt/components";
import { useWebSocket } from "@n-apt/hooks";
import { decryptPayloadBytes } from "@n-apt/crypto/webcrypto";
```

❌ **Incorrect:**

```typescript
import { FFTCanvas } from "./components/FFTCanvas";
import { useWebSocket } from "../hooks/useWebSocket";
import { decryptPayloadBytes } from "../crypto/webcrypto";
```

### Benefits:

- **Consistency**: All imports follow the same pattern
- **Maintainability**: Easy to identify internal vs external dependencies
- **Refactoring**: Namespace changes can be managed centrally
- **Readability**: Clear distinction between project modules and external packages

### Enforcement:

- Use absolute imports with "@n-apt" prefix for all internal modules
- **Same-directory relative imports** are allowed and preferred for local files
- External packages (React, styled-components, etc.) use their normal import syntax

### Same-Folder Import Rules

✅ **Safe Same-Folder Patterns:**

```typescript
// Within the same directory - use relative imports
import { MyComponent } from "./MyComponent";
import { helperFunction } from "./utils";
import { types } from "./types";

// Index files in same folder can re-export from siblings
export { MyComponent } from "./MyComponent";
export { helperFunction } from "./utils";
export * from "./types"; // Safe within same folder
```

✅ **Same-Folder Circular Dependencies:**

```typescript
// components/index.ts - can safely re-export from same folder
export { Button } from "./Button";
export { Input } from "./Input"; 
export { Modal } from "./Modal";

// Button.tsx - can import from same folder
import { Input } from "./Input"; // Safe - same directory
import { Modal } from "./Modal"; // Safe - same directory
```

❌ **Cross-Folder Circular Dependencies:**

```typescript
// AVOID: Cross-folder circular imports
// validation/index.ts -> redux/middleware.ts -> validation/index.ts

// AVOID: Index files importing from other folders' index files
// components/index.ts -> hooks/index.ts -> components/index.ts
```

## Safari Compatibility Rules

### Circular Dependency Prevention

**CRITICAL**: Circular dependencies can cause Safari to fail during module resolution. Follow these rules:

✅ **Safe Dependencies:**

```typescript
// Validation can import from consts (safe)
import { SpectrumFrame } from "@n-apt/consts/schemas/websocket";

// Redux can import from validation (safe)
import { validateStatusMessage } from "@n-apt/validation";

// Components can import from both (safe)
import { validateStatusMessage } from "@n-apt/validation";
import { setFrequencyRange } from "@n-apt/redux";
```

❌ **Dangerous Circular Patterns:**

```typescript
// AVOID: Validation importing from Redux
// import { store } from "@n-apt/redux"; // DANGEROUS

// AVOID: Consts importing from validation
// import { validateSpectrumFrame } from "@n-apt/validation"; // DANGEROUS

// AVOID: Cross-module circular imports
// validation/index.ts -> redux/middleware.ts -> validation/index.ts

// AVOID: Cross-folder index file circular dependencies
// components/index.ts -> hooks/index.ts -> components/index.ts
```

### Export Barrel Safeguards

**CRITICAL**: Export barrels can cause Safari to hang with deep re-exports. Follow these rules:

✅ **Safe Barrel Exports:**

```typescript
// Named exports only - safe for Safari
export { validateStatusMessage, validateSpectrumFrame } from "./middleware";
export type { SpectrumFrame, CaptureRequest } from "./types";

// Limited re-exports (max 2 levels deep)
export { setFrequencyRange, setActiveSignalArea } from "@n-apt/redux/slices/spectrumSlice";
```

❌ **Dangerous Barrel Patterns:**

```typescript
// AVOID: Wildcard re-exports from barrel files across folders
// export * from "@n-apt/validation"; // DANGEROUS for Safari
// export * from "@n-apt/redux/thunks"; // DANGEROUS for Safari

// AVOID: Deep nested re-exports (3+ levels)
// export * from "@n-apt/validation/guards"; // DANGEROUS

// AVOID: Cross-folder wildcard re-exports
// components/index.ts: export * from "../hooks"; // DANGEROUS
```

✅ **Safe Same-Folder Wildcard Exports:**

```typescript
// SAFE: Wildcard exports within the same directory
// types/index.ts: export * from "./userTypes"; // SAFE
// components/index.ts: export * from "./Button"; // SAFE
// utils/index.ts: export * from "./helpers"; // SAFE

// SAFE: Same-folder circular dependencies with wildcard exports
// Button.tsx -> Input.tsx -> Button.tsx (same folder)
// index.ts: export * from "./Button" (same folder)
```

### Module Dependency Hierarchy

Follow this strict hierarchy to prevent circular dependencies:

1. **Level 1 (Foundation)**: `@n-apt/consts` - No internal imports
2. **Level 2 (Types)**: `@n-apt/validation/types` - Can only import from Level 1
3. **Level 3 (Logic)**: `@n-apt/validation/*` - Can import from Levels 1-2
4. **Level 4 (State)**: `@n-apt/redux` - Can import from Levels 1-3
5. **Level 5 (UI)**: `@n-apt/components`, `@n-apt/hooks` - Can import from Levels 1-4

### Safari-Specific Rules

- **No wildcard re-exports** from barrel index files
- **Maximum 2-level deep** re-export chains
- **Explicit named exports** preferred over wildcard
- **Avoid circular dependencies** at all costs
- **Test in Safari** after any namespace changes

### Detection Commands

```bash
# Check for potential circular dependencies
npm run lint:check:circularity

# Check for dangerous wildcard exports
grep -r "export \*" src/ts/ --exclude-dir=node_modules

# Validate namespace compliance
npm run lint:namespace
```
