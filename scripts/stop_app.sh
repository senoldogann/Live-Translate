#!/usr/bin/env bash

# Stealth Subtitle Translator - App Stopper
# Gracefully terminates the Electron app and Python AI engine

set -uo pipefail

echo "[stop_app] Stopping Steath Subtitle Translator..."

# 1. Kill Electron processes
# Search for the product name or the main entry point
ELECTRON_PIDS=$(ps -axo pid=,command= | grep -E "Stealth Subtitle Translator|dist-electron/main.js" | grep -v grep | awk '{print $1}')

if [ -n "$ELECTRON_PIDS" ]; then
    echo "[stop_app] Terminating Electron processes: $ELECTRON_PIDS"
    echo "$ELECTRON_PIDS" | xargs kill -15
else
    echo "[stop_app] No Electron processes found."
fi

# 2. Kill Python AI engine
# Similar to the recovery logic in main.ts
PYTHON_PIDS=$(ps -axo pid=,command= | grep "python/engine.py" | grep -v grep | awk '{print $1}')

if [ -n "$PYTHON_PIDS" ]; then
    echo "[stop_app] Terminating Python AI engine processes: $PYTHON_PIDS"
    echo "$PYTHON_PIDS" | xargs kill -15
else
    echo "[stop_app] No Python AI engine processes found."
fi

echo "[stop_app] Cleanup complete."
