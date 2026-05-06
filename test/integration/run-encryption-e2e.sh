#!/bin/bash

# N-APT Encryption E2E Test Orchestrator
# Bridges Rust backend and TypeScript frontend for full-cycle security validation.

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔐 Starting Encryption E2E Test Suite${NC}"
echo "======================================"

# Set environment variable for backend authentication consistency
export UNSAFE_LOCAL_USER_PASSWORD="test-password-123"

# Create a temporary .env.local for the backend to ensure it picks up the password
# even if started via 'bash -lc' which might lose inherited env vars.
printf "UNSAFE_LOCAL_USER_PASSWORD=test-password-123" > .env.local
trap 'rm -f .env.local' EXIT

# 1. Check Dependencies
echo -e "\n${BLUE}Step 1: Checking dependencies...${NC}"
command -v cargo >/dev/null 2>&1 || { echo -e "${RED}Error: cargo is not installed.${NC}"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo -e "${RED}Error: npm is not installed.${NC}"; exit 1; }

# 2. Build Backend Utility
echo -e "\n${BLUE}Step 2: Building backend test utility...${NC}"
cargo build --profile dev-fast --bin n-apt-backend

# 3. Generate Test Vectors (Rust)
echo -e "\n${BLUE}Step 3: Generating encrypted test vectors...${NC}"
# We'll run a specific rust test that dumps files
cargo test --test encryption_e2e_tests generate_test_artifacts -- --nocapture || {
    echo -e "${RED}❌ Failed to generate test artifacts.${NC}"
    exit 1
}
echo -e "${GREEN}✅ Test vectors generated successfully${NC}"

# 4. Setup Playwright (if needed)
if [ "$CI" = "true" ]; then
    echo -e "\n${BLUE}Step 4: Setting up Playwright for CI...${NC}"
    npx playwright install --with-deps chromium
else
    echo -e "\n${BLUE}Step 4: Checking Playwright...${NC}"
    # Just ensure browsers are present locally
    npx playwright install chromium
fi

# 5. Run Frontend Integration Tests (Vitest/Jest)
echo -e "\n${BLUE}Step 5: Running Frontend Encryption Integration Tests...${NC}"
npm run test:integration -- test/integration/EncryptionLifecycle.test.tsx || {
    echo -e "${RED}❌ Frontend integration tests failed.${NC}"
    exit 1
}

# 6. Run Playwright E2E Tests
echo -e "\n${BLUE}Step 6: Running Playwright E2E Tests...${NC}"
# We need the backend running in the background for a true E2E
# However, for now, we will run the playwright tests which might use mocks or start the backend itself
npx playwright test test/ts/VaultE2E.spec.ts || {
    echo -e "${RED}❌ Playwright E2E tests failed.${NC}"
    exit 1
}

echo -e "\n${GREEN}🎉 All Encryption E2E Tests Passed!${NC}"
echo "======================================"
