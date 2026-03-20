# Scripts Directory

This directory contains all utility scripts for the n-apt project, organized by function.

## 📁 Directory Structure

```
scripts/
├── README.md               # Main scripts documentation
├── git/                    # Git and worktree management 
│   ├── README.md
│   ├── worktree_manager.sh
│   ├── setup_worktrees.sh
│   ├── commit_encrypted_modules.sh
│   └── pre-commit
├── build/                  # Build and development scripts 
│   ├── README.md
│   ├── build_orchestrator.sh
│   ├── build_orchestrator_fast.sh
│   ├── build_wasm.sh
│   ├── build-orchestrator.tsx     # New ink-based TUI orchestrator
│   ├── dev.sh
│   ├── dev_fast.sh
│   ├── NaptLogo.tsx
├── data/                   # Data processing and database scripts 
│   ├── README.md
│   ├── setup_redis.sh
│   ├── redis_persistent_manager.sh
│   ├── download_opencellid_cached.cjs
│   ├── load_towers_to_redis.cjs
│   ├── load_sample_states.cjs
│   ├── cleanEntities.cjs
│   ├── decode_raw.py
│   ├── extract_ongoing.cjs
│   ├── tower_db_manager.cjs
│   ├── load_all_towers_to_redis.cjs
│   ├── load_local_radius_towers.cjs
│   ├── load_region_towers.cjs
│   ├── process_opencellid.cjs
│   └── test_load_sample.cjs
├── utils/                  # Utility scripts 
│   ├── README.md
│   ├── env.sh
│   ├── dev.sh
│   └── dev_fast.sh
├── encrypted-modules/      # Cryptographic and encrypted module utilities
│   ├── README.md
│   └── crypt.ts
├── processing/             # Data processing utilities
│   ├── README.md
│   ├── check_changes.sh
│   ├── ci_timing.sh
│   ├── indent_output.sh
│   ├── kill_blockers.sh
│   ├── test_npm_width.sh
│   └── test_term.sh
├── visualization/          # Visualization and graphics
│   ├── README.md
│   ├── iq_to_svg.py
│   ├── rtl_sdr_capture.py
│   ├── simple_visual_build.sh
│   └── test_visual_output.sh
└── deployment/             # Deployment and server management
    ├── README.md
    ├── start_backend.sh
    ├── start_server.sh
    └── dev_server.sh
```

## 🚀 Quick Start

### **Git Worktree Management**
```bash
cd scripts/git
./worktree_manager.sh setup
./worktree_manager.sh list
```

### **Building the Project**
```bash
cd scripts/build
./build_orchestrator.sh
# or for development
./dev.sh
# or fast development
./dev_fast.sh
```

### **Running Tests**
```bash
# Backend agent tests
cd test/agents
./test-backend-agents.sh

# Integration tests
cd test/integration
./run-iq-capture-tests.sh
```

### **Data Management**
```bash
cd scripts/data
./setup_redis.sh start
./redis_persistent_manager.sh status
```

### **Environment Setup**
```bash
cd scripts/utils
source env.sh
```

### **Encrypted Modules**
```bash
cd scripts/git
./commit_encrypted_modules.sh
```

### **Cryptographic Utilities**
```bash
cd scripts/encrypted-modules
npx ts-node crypt.ts
```

### **Git Hooks**
```bash
cd scripts/git
# Install pre-commit hook
cp pre-commit ../../.git/hooks/
chmod +x ../../.git/hooks/pre-commit
```

### **Processing Utilities**
```bash
cd scripts/processing
./check_changes.sh
./ci_timing.sh
```

### **Visualization**
```bash
cd scripts/visualization
./simple_visual_build.sh
./iq_to_svg.py input.iq output.svg
./test_visual_output.sh
```

### **Deployment**
```bash
cd scripts/deployment
./start_server.sh
./dev_server.sh
```

## 📋 Script Categories

| Category | Location | Purpose | Status |
|----------|----------|---------|--------|
| **Git** | `git/` | Worktree management, encrypted modules | Complete |
| **Build** | `build/` | Build processes, development servers | Complete |
| **Test** | `test/` | Test execution, validation | Complete |
| **Data** | `data/` | Database operations, data processing | Complete |
| **Utils** | `utils/` | General utilities, environment setup | Complete |
| **Encrypted Modules** | `encrypted-modules/` | Cryptographic utilities, module encryption | Complete |
| **Processing** | `processing/` | Data processing utilities, CI/CD | Complete |
| **Visualization** | `visualization/` | Graphics, SVG generation, IQ processing | Complete |
| **Deployment** | `deployment/` | Server management, backend deployment | Complete |

## 🔧 Git Scripts Highlights

### **Worktree Manager**
Full-featured worktree management for multi-branch development:
```bash
./scripts/git/worktree_manager.sh setup
./scripts/git/worktree_manager.sh goto try-analysis
./scripts/git/worktree_manager.sh status
```

### **Encrypted Modules**
Secure commit workflow for sensitive code:
```bash
./scripts/git/commit_encrypted_modules.sh
```

## 🏗️ Build Scripts Highlights

### **Main Build**
Comprehensive build orchestrator:
```bash
./scripts/build/build_orchestrator.sh
```

### **Development**
Quick development server:
```bash
./scripts/build/dev.sh
```

### **Fast Development**
Optimized build with timeout protection:
```bash
./scripts/build/dev_fast.sh
```

### **Ink-based TUI Build**
Modern terminal UI build orchestrator with real-time status:
```bash
npm run dev:ink
```
Or run directly:
```bash
npm run build_orchestrator:ink
```

## 🧪 Test Scripts Highlights

### **Backend Testing**
Test backend agent functionality:
```bash
./test/agents/test-backend-agents.sh
```

### **Integration Testing**
Test IQ capture and processing:
```bash
./test/integration/run-iq-capture-tests.sh
```

## 🗄️ Data Scripts Highlights

### **Redis Management**
Setup and manage Redis data:
```bash
./scripts/data/setup_redis.sh start
./scripts/data/setup_redis.sh status
```

### **OpenCellID Processing**
Process cell tower data:
```bash
./scripts/data/process_opencellid.cjs
```

## 🔧 Utils Scripts Highlights

### **Environment Setup**
Load environment variables:
```bash
source ./scripts/utils/env.sh
```

## 🪝 Git Hooks Highlights

### **Pre-commit Hook**
Security checks and module encryption:
```bash
./scripts/git/pre-commit
```

## 🎉 Organization Status

**✅ All Categories Completed:**
- Git/Worktree management
- Build and development scripts
- Testing scripts
- Data processing scripts
- Utility scripts
- Encrypted modules and cryptographic utilities
- Processing utilities
- Visualization and graphics
- Deployment and server management

**✅ Cleanup Complete:**
- All scripts moved to appropriate subdirectories
- README files updated with new structure
- Script paths documented for each category
- Dead Rezi variants removed
- No remaining scripts in root directory

## 📝 Notes

- All scripts are executable (`chmod +x`)
- Scripts use relative paths from the project root
- Environment variables should be set in `.env` files
- Check individual README files in each subdirectory for detailed usage
- Ink-based CLI system available for modern TUI implementations
- New ink-based build orchestrator provides real-time visual feedback
