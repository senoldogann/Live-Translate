#!/usr/bin/env bash

# Stealth Subtitle Translator - Background Launcher
# Launches the app and redirects output to logs/launch.log

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
LOG_FILE="$LOG_DIR/launch.log"

# 1. Create logs directory
mkdir -p "$LOG_DIR"

echo "[launch_bg] Checking dependencies..."
# 2. Run setup only to ensure everything is ready
bash "$ROOT_DIR/scripts/run_open_source.sh" --setup-only

echo "[launch_bg] Starting app in background..."
echo "[launch_bg] Logs will be available at: $LOG_FILE"

# 3. Launch in background
# Use nohup so it persists after terminal closure
# Redirect both stdout and stderr to the log file
cd "$ROOT_DIR"
nohup npm run start > "$LOG_FILE" 2>&1 &

echo "[launch_bg] Launched! PID: $!"
echo "Uygulama arka planda baslatildi. 'bash scripts/stop_app.sh' ile durdurabilirsiniz."
