# Git Scripts

This folder contains git-related utility scripts for managing the n-apt repository.

## 🌳 Worktree Management

### **Worktree Manager**
- `worktree_manager.sh` - Full-featured git worktree management tool
- `setup_worktrees.sh` - Quick setup script for worktrees

### **Usage Examples**

```bash
# Setup all worktrees
./worktree_manager.sh setup

# List all worktrees
./worktree_manager.sh list

# Add new worktree
./worktree_manager.sh add feature-branch

# Navigate to worktree
./worktree_manager.sh goto encrypted-modules

# Remove worktree
./worktree_manager.sh remove ../worktrees/feature-branch

# Clean up stale worktrees
./worktree_manager.sh clean

# Show current status
./worktree_manager.sh status
```

## 🔐 Encrypted Modules

### **Commit Scripts**
- `commit_encrypted_modules.sh` - Script to commit encrypted modules with proper message

### **Usage**

```bash
# Commit encrypted modules
./commit_encrypted_modules.sh
```

## 🪝 Git Hooks

### **Pre-commit Hook**
- `pre-commit` - Pre-commit hook for security checks and module encryption

### **Features**
- Blocks commits with absolute file paths
- Prevents large files (>100MB) from being committed
- Automatically encrypts N-APT modules before commit
- Provides helpful error messages and solutions

### **Installation**

```bash
# Install the pre-commit hook
cp pre-commit ../../.git/hooks/
chmod +x ../../.git/hooks/pre-commit
```

### **Manual Testing**

```bash
# Test the hook manually
./pre-commit
```

## 📋 Worktree Structure

The worktree system provides isolated environments for:

| Worktree | Branch | Purpose | GitIgnore |
|----------|--------|---------|-----------|
| `../worktrees/encrypted-modules` | `encrypted-modules` | Sensitive algorithm work | tmp/ allowed |
| `../worktrees/main` | `main` | Regular development | tmp/ ignored |
| `../worktrees/try-analysis` | `try-analysis` | Analysis features & experiments | tmp/ ignored |

## 🚀 Quick Start

```bash
# Setup worktrees
./worktree_manager.sh setup

# Navigate to desired worktree
cd ../worktrees/try-analysis

# Work on your code...

# Switch to another worktree
cd ../worktrees/encrypted-modules
```

## 🛠️ Script Descriptions

### **worktree_manager.sh**
Full-featured worktree management tool with commands:
- `setup` - Create all standard worktrees
- `list` - List all worktrees
- `add <branch>` - Add new worktree
- `remove <path>` - Remove worktree
- `clean` - Clean up stale worktrees
- `goto <target>` - Navigate to worktree
- `status` - Show current worktree status

### **setup_worktrees.sh**
Quick setup script that creates:
- encrypted-modules worktree
- main worktree  
- try-analysis worktree

### **commit_encrypted_modules.sh**
Commits encrypted modules with proper security message and force-adds tmp/ files.

### **pre-commit**
Git pre-commit hook that performs security checks and automatically encrypts modules before commits.
