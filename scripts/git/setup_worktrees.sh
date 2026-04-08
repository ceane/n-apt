#!/bin/bash

# Git Worktree Setup for Encrypted Modules
# This script creates separate worktrees for different branches

echo "🌳 Setting up Git Worktrees for Encrypted Modules..."

# Create worktrees directory
mkdir -p ../worktrees

# Create worktree for encrypted-modules branch
echo "📁 Creating worktree for encrypted-modules branch..."
git worktree add ../worktrees/encrypted-modules encrypted-modules

# Create worktree for main branch (if not already the main directory)
echo "📁 Creating worktree for main branch..."
git worktree add ../worktrees/main main

# Create worktree for try-analysis branch
echo "📁 Creating worktree for try-analysis branch..."
git worktree add ../worktrees/try-analysis try-analysis

# List all worktrees
echo "📋 Current worktrees:"
git worktree list

echo "✅ Worktree setup complete!"
echo ""
echo "🚀 Usage:"
echo "  cd ../worktrees/encrypted-modules  # Work on encrypted modules"
echo "  cd ../worktrees/main               # Work on main branch"
echo "  cd ../worktrees/try-analysis       # Work on try-analysis branch"
echo "  git worktree list                  # List all worktrees"
