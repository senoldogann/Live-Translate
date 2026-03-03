#!/usr/bin/env python3
import subprocess
import os
import sys

# Add scripts dir to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from common_utils import print_header, print_success, print_fail, print_info

def run_script(script_name):
    print_info(f"Running {script_name}...")
    try:
        result = subprocess.run([sys.executable, f"scripts/{script_name}"], capture_output=True, text=True)
        print(result.stdout)
        if result.returncode == 0:
            print_success(f"{script_name} passed.")
            return True
        else:
            print_fail(f"{script_name} failed.")
            print(result.stderr)
            return False
    except Exception as e:
        print_fail(f"Error running {script_name}: {e}")
        return False

def main():
    print_header("MAESTRO FULL VERIFICATION SUITE")
    
    # First generate index to ensure it's fresh
    scripts_to_run = ["generate_skill_index.py", "checklist.py", "dependency_analyzer.py"]
    # In the future, we can add more: ["security_scan.py", "lint_runner.py"]
    
    all_success = True
    for script in scripts_to_run:
        if not run_script(script):
            all_success = False
            
    if all_success:
        print_header("FINAL VERIFICATION: SUCCESS")
        sys.exit(0)
    else:
        print_header("FINAL VERIFICATION: FAILED")
        sys.exit(1)

if __name__ == "__main__":
    main()
