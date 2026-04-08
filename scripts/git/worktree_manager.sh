#!/bin/bash

# Git Worktree Manager for Encrypted Modules
# Easy commands for worktree management

SCRIPT_NAME="worktree_manager.sh"
WORKTREES_DIR="../worktrees"

show_help() {
    echo "🌳 Git Worktree Manager"
    echo ""
    echo "Usage: ./$SCRIPT_NAME <command> [options]"
    echo ""
    echo "Commands:"
    echo "  setup                    - Setup initial worktrees"
    echo "  list                     - List all worktrees"
    echo "  add <branch> [path]      - Add new worktree for branch"
    echo "  remove <path>            - Remove worktree"
    echo "  clean                    - Clean up stale worktrees"
    echo "  goto <branch|path>       - Quick navigation to worktree"
    echo "  status                   - Show current worktree status"
    echo "  help                     - Show this help"
    echo ""
    echo "Examples:"
    echo "  ./$SCRIPT_NAME setup"
    echo "  ./$SCRIPT_NAME add feature-auth"
    echo "  ./$SCRIPT_NAME goto encrypted-modules"
    echo "  ./$SCRIPT_NAME remove ../worktrees/feature-auth"
}

setup_worktrees() {
    echo "🚀 Setting up worktrees..."
    
    # Create worktrees directory
    mkdir -p "$WORKTREES_DIR"
    
    # Add encrypted-modules worktree
    if ! git worktree list | grep -q "encrypted-modules"; then
        echo "📁 Adding encrypted-modules worktree..."
        git worktree add "$WORKTREES_DIR/encrypted-modules" encrypted-modules
    else
        echo "✅ encrypted-modules worktree already exists"
    fi
    
    # Add main worktree (if not current directory)
    if ! git worktree list | grep -q "$WORKTREES_DIR/main"; then
        echo "📁 Adding main worktree..."
        git worktree add "$WORKTREES_DIR/main" main
    else
        echo "✅ main worktree already exists"
    fi
    
    # Add try-analysis worktree
    if ! git worktree list | grep -q "try-analysis"; then
        echo "📁 Adding try-analysis worktree..."
        git worktree add "$WORKTREES_DIR/try-analysis" try-analysis
    else
        echo "✅ try-analysis worktree already exists"
    fi
    
    echo ""
    echo "📋 Current worktrees:"
    git worktree list
}

list_worktrees() {
    echo "📋 Git Worktrees:"
    git worktree list
}

add_worktree() {
    local branch="$1"
    local path="$2"
    
    if [ -z "$branch" ]; then
        echo "❌ Error: Branch name required"
        echo "Usage: ./$SCRIPT_NAME add <branch> [path]"
        return 1
    fi
    
    if [ -z "$path" ]; then
        path="$WORKTREES_DIR/$branch"
    fi
    
    echo "📁 Adding worktree for branch '$branch' at '$path'..."
    git worktree add "$path" "$branch"
    
    echo "✅ Worktree added successfully!"
    echo "📋 Updated worktrees:"
    git worktree list
}

remove_worktree() {
    local path="$1"
    
    if [ -z "$path" ]; then
        echo "❌ Error: Path required"
        echo "Usage: ./$SCRIPT_NAME remove <path>"
        return 1
    fi
    
    echo "🗑️  Removing worktree at '$path'..."
    git worktree remove "$path"
    
    echo "✅ Worktree removed successfully!"
    echo "📋 Remaining worktrees:"
    git worktree list
}

clean_worktrees() {
    echo "🧹 Cleaning up stale worktrees..."
    git worktree prune
    echo "✅ Cleanup complete!"
    echo "📋 Active worktrees:"
    git worktree list
}

goto_worktree() {
    local target="$1"
    
    if [ -z "$target" ]; then
        echo "❌ Error: Target required"
        echo "Usage: ./$SCRIPT_NAME goto <branch|path>"
        return 1
    fi
    
    # Check if target is a branch name
    if git worktree list | grep -q "$target"; then
        local path=$(git worktree list | grep "$target" | head -1 | awk '{print $1}')
        echo "🔄 Switching to worktree: $path"
        cd "$path" || echo "❌ Failed to change directory"
    else
        # Check if target is a path
        if [ -d "$target" ]; then
            echo "🔄 Switching to worktree: $target"
            cd "$target" || echo "❌ Failed to change directory"
        else
            echo "❌ Error: '$target' is not a valid worktree branch or path"
            echo "📋 Available worktrees:"
            git worktree list
        fi
    fi
}

show_status() {
    echo "📊 Worktree Status:"
    echo ""
    
    # Current directory
    local current_dir=$(pwd)
    echo "📍 Current Directory: $current_dir"
    
    # Current branch
    local current_branch=$(git branch --show-current 2>/dev/null || echo "detached")
    echo "🌿 Current Branch: $current_branch"
    
    # Worktree info
    local worktree_root=$(git rev-parse --show-toplevel 2>/dev/null)
    echo "🌳 Worktree Root: $worktree_root"
    
    echo ""
    echo "📋 All Worktrees:"
    git worktree list
}

# Main command handler
case "${1:-help}" in
    "setup")
        setup_worktrees
        ;;
    "list")
        list_worktrees
        ;;
    "add")
        add_worktree "$2" "$3"
        ;;
    "remove")
        remove_worktree "$2"
        ;;
    "clean")
        clean_worktrees
        ;;
    "goto")
        goto_worktree "$2"
        ;;
    "status")
        show_status
        ;;
    "help"|*)
        show_help
        ;;
esac
