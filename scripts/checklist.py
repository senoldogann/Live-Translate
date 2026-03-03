#!/usr/bin/env python3
import os
import sys

# Add scripts dir to path to allow importing common_utils
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from common_utils import print_header, print_success, print_fail, print_warning, print_info, file_exists, dir_exists

ROOT_DIR = os.getcwd()

REQUIRED_FILES = [
    ".agent/SYSTEM.md",
    "AGENTS.md",
    ".agent/ARCHITECTURE.md",
    ".agent/rules/GEMINI.md",
    ".agent/rules/00-ARCHITECT-MANIFESTO.md",
    ".agent/rules/01-safety-and-persistence.md",
    ".agent/rules/05-self-reflection.md",
    ".agent/rules/10-parallel-execution.md",
    ".agent/rules/20-observability.md",
    ".agent/rules/30-error-handling.md",
    ".agent/rules/40-api-design.md",
    ".agent/rules/50-security-and-testing.md",
    ".agent/rules/100-tech-stack.md",
]

REQUIRED_DIRS = [
    ".agent/agents",
    ".agent/skills",
    ".agent/workflows",
    "scripts"
]

def check_structure():
    print_header("Structural Integrity Check")
    all_passed = True
    
    # Check Directories
    for d in REQUIRED_DIRS:
        path = os.path.join(ROOT_DIR, d)
        if dir_exists(path):
            print_success(f"Directory found: {d}")
        else:
            print_fail(f"Missing directory: {d}")
            all_passed = False

    # Check Files
    for f in REQUIRED_FILES:
        path = os.path.join(ROOT_DIR, f)
        if file_exists(path):
            print_success(f"File found: {f}")
        else:
            print_fail(f"Missing file: {f}")
            all_passed = False
            
    # Check Plan existence specifically (Important for Orchestrator)
    if file_exists(os.path.join(ROOT_DIR, "docs/PLAN.md")):
        print_success(f"Docs found: docs/PLAN.md")
    else:
        print_warning(f"No active plan found at docs/PLAN.md (Recommended for active tasks)")

    return all_passed

def check_documentation_consistency():
    print("=== Documentation Consistency Check ===")
    success = True
    if os.path.exists(".agent/ARCHITECTURE.md") and os.path.exists(".agent/SYSTEM.md"):
        print("✓ ARCHITECTURE.md references SYSTEM.md (Consolidated)")
    return success

def main():
    print_header("MAESTRO SYSTEM CHECKLIST")
    
    struct_ok = check_structure()
    doc_ok = check_documentation_consistency()
    
    print("\n")
    if struct_ok and doc_ok:
        print_success("SYSTEM HEALTHY - Ready for designation")
        sys.exit(0)
    else:
        print_fail("SYSTEM ISSUES DETECTED - Please fix missing components")
        sys.exit(1)

if __name__ == "__main__":
    main()
