#!/bin/bash

# =============================================================================
# Yama CLI Installer
# =============================================================================
# Usage:
#   curl -sSL https://cdn.jsdelivr.net/gh/mycodedstuff/yama@main/install.sh | bash
#
# Environment Variables:
#   INSTALL_DIR   - Installation directory (default: ~/.yama)
#   YAMA_BRANCH   - Git branch to install (default: main)
#   YAMA_REPO     - Repository URL (default: https://github.com/mycodedstuff/yama.git)
# =============================================================================

set -e

# =============================================================================
# Configuration
# =============================================================================

INSTALL_DIR="${INSTALL_DIR:-$HOME/.yama}"
YAMA_BRANCH="${YAMA_BRANCH:-main}"
YAMA_REPO="${YAMA_REPO:-https://github.com/mycodedstuff/yama.git}"

MIN_NODE_MAJOR=20

# =============================================================================
# Colors
# =============================================================================

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# =============================================================================
# Helper Functions
# =============================================================================

info() {
    echo -e "${BLUE}ℹ${NC} $1"
}

success() {
    echo -e "${GREEN}✓${NC} $1"
}

error() {
    echo -e "${RED}✗${NC} $1" >&2
}

fail() {
    error "$1"
    exit 1
}

# =============================================================================
# Prerequisite Checks
# =============================================================================

check_node() {
    if ! command -v node &> /dev/null; then
        fail "Node.js not found. Please install Node.js v${MIN_NODE_MAJOR}+"
    fi

    NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)

    if [[ "$NODE_MAJOR" -lt "$MIN_NODE_MAJOR" ]]; then
        fail "Node.js v${NODE_VERSION} found. Yama requires v${MIN_NODE_MAJOR}+"
    fi

    success "Node.js v${NODE_VERSION} found"
}

check_npm() {
    if ! command -v npm &> /dev/null; then
        fail "npm not found. Please install npm"
    fi

    NPM_VERSION=$(npm -v 2>/dev/null)
    success "npm v${NPM_VERSION} found"
}

check_git() {
    if ! command -v git &> /dev/null; then
        fail "git not found. Please install git"
    fi

    GIT_VERSION=$(git --version 2>/dev/null | awk '{print $3}')
    success "git v${GIT_VERSION} found"
}

# =============================================================================
# Installation Steps
# =============================================================================

clean_installation() {
    if [[ -d "$INSTALL_DIR" ]]; then
        info "Removing previous installation..."
        rm -rf "$INSTALL_DIR"
    fi
}

clone_repository() {
    info "Cloning repository (branch: ${YAMA_BRANCH})..."
    mkdir -p "$INSTALL_DIR"
    git clone --depth 1 --branch "$YAMA_BRANCH" "$YAMA_REPO" "$INSTALL_DIR"
}

install_dependencies() {
    info "Installing dependencies..."
    cd "$INSTALL_DIR"
    npm install --silent
}

build_project() {
    info "Building..."
    npm run build
}

make_executable() {
    info "Making CLI executable..."
    chmod +x "${INSTALL_DIR}/dist/cli/v2.cli.js"
}

link_global() {
    info "Linking globally..."
    npm link --silent
}

# =============================================================================
# Main
# =============================================================================

main() {
    echo ""
    echo -e "${YELLOW}⚔️  Yama CLI Installer${NC}"
    echo ""

    check_node
    check_npm
    check_git
    echo ""

    info "Install directory: ${INSTALL_DIR}"
    info "Branch: ${YAMA_BRANCH}"
    info "Repository: ${YAMA_REPO}"
    echo ""

    clean_installation
    clone_repository
    install_dependencies
    build_project
    make_executable
    link_global

    echo ""
    echo -e "${GREEN}✅ Yama installed successfully!${NC}"
    echo ""
    echo "   Run 'yama --help' to get started."
    echo ""
    echo "   To uninstall:"
    echo "     npm unlink -g @juspay/yama"
    echo "     rm -rf ${INSTALL_DIR}"
    echo ""
}

main "$@"
