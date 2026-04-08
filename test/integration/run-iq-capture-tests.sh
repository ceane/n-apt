#!/bin/bash

# I/Q Capture Integration Test Runner
# Runs comprehensive tests for I/Q capture functionality with 3.2MHz sample rate validation

set -e

echo "🎯 Running I/Q Capture Integration Tests"
echo "======================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to run tests and check results
run_test() {
    local test_name=$1
    local test_command=$2
    
    echo -e "\n${BLUE}Running: ${test_name}${NC}"
    echo "Command: ${test_command}"
    
    if eval $test_command; then
        echo -e "${GREEN}✅ ${test_name} PASSED${NC}"
        return 0
    else
        echo -e "${RED}❌ ${test_name} FAILED${NC}"
        return 1
    fi
}

# Function to check if dependencies are available
check_dependencies() {
    echo -e "${BLUE}Checking dependencies...${NC}"
    
    if ! command -v npm &> /dev/null; then
        echo -e "${RED}❌ npm not found${NC}"
        exit 1
    fi
    
    if ! command -v cargo &> /dev/null; then
        echo -e "${RED}❌ cargo not found${NC}"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Dependencies found${NC}"
}

# Function to install test dependencies
install_dependencies() {
    echo -e "${BLUE}Installing test dependencies...${NC}"
    
    # Install Node.js test dependencies
    npm install --save-dev @testing-library/react @testing-library/jest-dom @testing-library/user-event jest jest-environment-jsdom
    
    # Ensure Rust test dependencies are available
    cargo check --tests
    
    echo -e "${GREEN}✅ Dependencies installed${NC}"
}

# Main test execution
main() {
    local failed_tests=0
    local total_tests=0
    
    # Check dependencies
    check_dependencies
    
    # Install dependencies if needed
    if [ "$1" = "--install" ]; then
        install_dependencies
    fi
    
    echo -e "\n${YELLOW}🚀 Starting I/Q Capture Test Suite${NC}"
    echo "Focus: 3.2MHz sample rate validation and end-to-end workflows"
    
    # 1. Frontend Integration Tests
    echo -e "\n${BLUE}📱 Frontend Integration Tests${NC}"
    total_tests=$((total_tests + 1))
    if ! run_test "Frontend I/Q Capture Integration" "npm test -- test/integration/iq-capture-integration.test.tsx --verbose"; then
        failed_tests=$((failed_tests + 1))
    fi
    
    # 2. Backend Integration Tests (Rust)
    echo -e "\n${BLUE}🦀 Backend Integration Tests${NC}"
    total_tests=$((total_tests + 1))
    if ! run_test "Backend I/Q Capture Integration" "cargo test iq_capture_integration_tests --lib -- --nocapture"; then
        failed_tests=$((failed_tests + 1))
    fi
    
    # 3. Rust Capture/Stitching Tests
    echo -e "\n${BLUE}🧪 Rust Capture/Stitching Tests${NC}"
    total_tests=$((total_tests + 1))
    if ! run_test "Rust Capture/Stitching" "cargo test capture_stitch --lib -- --nocapture"; then
        failed_tests=$((failed_tests + 1))
    fi
    
    # 4. Frontend Component Tests
    echo -e "\n${BLUE}⚛️ Frontend Component Tests${NC}"
    total_tests=$((total_tests + 1))
    if ! run_test "Frontend Components" "npm test -- test/ts/IQCaptureControlsSection.test.tsx --verbose"; then
        failed_tests=$((failed_tests + 1))
    fi
    
    # 5. Sample Rate Validation Tests (specific focus)
    echo -e "\n${BLUE}📏 Sample Rate Validation Tests${NC}"
    total_tests=$((total_tests + 1))
    if ! run_test "Sample Rate Validation" "cargo test sample_rate --lib -- --nocapture"; then
        failed_tests=$((failed_tests + 1))
    fi
    
    # 7. Frequency Validation Tests (NEW)
    echo -e "\n${BLUE}📏 Frequency Validation Tests${NC}"
    total_tests=$((total_tests + 1))
    if ! run_test "Frequency Validation" "npm test -- test/integration/frequency-validation-integration.test.tsx --verbose"; then
        failed_tests=$((failed_tests + 1))
    fi
    
    # 8. Backend Frequency Tests (NEW)
    echo -e "\n${BLUE}🦀 Backend Frequency Tests${NC}"
    total_tests=$((total_tests + 1))
    if ! run_test "Backend Frequency Validation" "cargo test frequency_validation --lib -- --nocapture"; then
        failed_tests=$((failed_tests + 1))
    fi
    
    # Summary
    echo -e "\n${YELLOW}📊 Test Summary${NC}"
    echo "======================================"
    echo "Total tests: ${total_tests}"
    echo "Passed: $((total_tests - failed_tests))"
    echo "Failed: ${failed_tests}"
    
    if [ $failed_tests -eq 0 ]; then
        echo -e "\n${GREEN}🎉 All tests passed! I/Q capture integration is working correctly.${NC}"
        echo -e "${GREEN}✅ 3.2MHz sample rate validation is enforced${NC}"
        echo -e "${GREEN}✅ No negative frequencies are captured${NC}"
        echo -e "${GREEN}✅ Frontend-backend frequency synchronization verified${NC}"
        exit 0
    else
        echo -e "\n${RED}💥 ${failed_tests} test(s) failed. Please review the errors above.${NC}"
        echo -e "${YELLOW}💡 Make sure sample rate and frequency validation are properly implemented${NC}"
        exit 1
    fi
}

# Help message
show_help() {
    echo "I/Q Capture Integration Test Runner"
    echo "=================================="
    echo ""
    echo "Usage: $0 [OPTIONS]"
    echo ""
    echo "Options:"
    echo "  --install    Install test dependencies before running"
    echo "  --help       Show this help message"
    echo ""
    echo "Tests covered:"
    echo "  • Frontend-backend integration"
    echo "  • 3.2MHz sample rate validation"
    echo "  • Negative frequency prevention"
    echo "  • Frontend-backend frequency synchronization"
    echo "  • End-to-end capture workflows"
    echo "  • Error handling and edge cases"
    echo "  • File format validation"
    echo "  • Mock vs real device testing"
}

# Parse command line arguments
case "$1" in
    --help)
        show_help
        exit 0
        ;;
    *)
        main "$@"
        ;;
esac
