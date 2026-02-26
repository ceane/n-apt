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
- Relative imports should only be used for very local, same-directory files
- External packages (React, styled-components, etc.) use their normal import syntax
