#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON_DIR="$ROOT_DIR/python"
VENV_DIR="$PYTHON_DIR/.venv"
VENV_PYTHON="$VENV_DIR/bin/python"
REQUIREMENTS_FILE="$PYTHON_DIR/requirements.txt"
REQUIREMENTS_STAMP="$VENV_DIR/.requirements.synced"

print_usage() {
    cat <<'EOF'
Usage: scripts/run_open_source.sh [--setup-only] [--help]

Bootstraps the open-source development environment and launches the app.

Options:
  --setup-only   Install missing Node/Python dependencies, then exit.
  --help         Show this help text.
EOF
}

find_python() {
    if command -v python3.11 >/dev/null 2>&1; then
        echo "python3.11"
        return
    fi

    if command -v python3 >/dev/null 2>&1; then
        echo "python3"
        return
    fi

    echo "Python 3 is required but was not found in PATH." >&2
    exit 1
}

ensure_node_dependencies() {
    if [ -d "$ROOT_DIR/node_modules" ]; then
        return
    fi

    echo "[run_open_source] Installing Node dependencies..."
    (cd "$ROOT_DIR" && npm install)
}

ensure_python_environment() {
    if [ ! -x "$VENV_PYTHON" ]; then
        local python_bin
        python_bin="$(find_python)"

        echo "[run_open_source] Creating Python virtual environment with $python_bin..."
        (cd "$ROOT_DIR" && "$python_bin" -m venv "$VENV_DIR")

        echo "[run_open_source] Upgrading pip..."
        (cd "$ROOT_DIR" && "$VENV_PYTHON" -m pip install --upgrade pip)
    fi

    if [ ! -f "$REQUIREMENTS_STAMP" ] || [ "$REQUIREMENTS_FILE" -nt "$REQUIREMENTS_STAMP" ]; then
        echo "[run_open_source] Syncing Python dependencies..."
        (cd "$ROOT_DIR" && "$VENV_PYTHON" -m pip install -r "$REQUIREMENTS_FILE")
        touch "$REQUIREMENTS_STAMP"
    fi
}

main() {
    local setup_only="false"

    while [ "$#" -gt 0 ]; do
        case "$1" in
            --setup-only)
                setup_only="true"
                ;;
            --help|-h)
                print_usage
                exit 0
                ;;
            *)
                echo "Unknown option: $1" >&2
                print_usage >&2
                exit 1
                ;;
        esac
        shift
    done

    ensure_node_dependencies
    ensure_python_environment

    if [ "$setup_only" = "true" ]; then
        echo "[run_open_source] Dependencies are ready."
        exit 0
    fi

    echo "[run_open_source] Starting Stealth Subtitle Translator..."
    cd "$ROOT_DIR"
    exec npm run start
}

main "$@"
