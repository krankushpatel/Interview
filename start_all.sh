#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "======================================================================"
echo "  Starting Interview Platform (Backend + Frontend + Ngrok Tunnel)"
echo "======================================================================"

# 1. Pre-flight checks
if [ ! -f "$SCRIPT_DIR/backend/.venv/bin/activate" ]; then
    echo "[ERROR] Python virtual environment not found at backend/.venv"
    echo "        Run setup first: cd backend && python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    exit 1
fi

if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "[ERROR] node_modules not found in root folder."
    echo "        Run setup first: npm install"
    exit 1
fi

if [ ! -f "$SCRIPT_DIR/backend/.env" ]; then
    echo "[ERROR] backend/.env not found."
    echo "        Run: cp .env.example backend/.env  and configure your keys."
    exit 1
fi

# 2. Read PUBLIC_BASE_URL from backend/.env (handles quotes, spaces, and CRLF)
PUBLIC_BASE_URL=""
while IFS='=' read -r key val; do
    key="${key//$'\r'/}"
    val="${val//$'\r'/}"
    # Trim leading/trailing whitespace from key
    key="$(echo "$key" | xargs)"
    if [ "$key" = "PUBLIC_BASE_URL" ]; then
        val="$(echo "$val" | xargs)"
        val="${val#\"}"
        val="${val%\"}"
        val="${val#\'}"
        val="${val%\'}"
        PUBLIC_BASE_URL="${val%/}"
        break
    fi
done < "$SCRIPT_DIR/backend/.env"

BACKEND_CMD="cd \"$SCRIPT_DIR/backend\" && source .venv/bin/activate && uvicorn main:app --reload --host 0.0.0.0 --port 8001"
FRONTEND_CMD="cd \"$SCRIPT_DIR\" && npm run dev"
TUNNEL_CMD=""

if [ -n "$PUBLIC_BASE_URL" ]; then
    if command -v ngrok >/dev/null 2>&1; then
        TUNNEL_CMD="ngrok http 8001 --url \"$PUBLIC_BASE_URL\""
    else
        echo "[WARN] PUBLIC_BASE_URL is set, but 'ngrok' is not installed. Skipping Tunnel."
    fi
else
    echo "[INFO] PUBLIC_BASE_URL is empty in backend/.env. Skipping Ngrok Tunnel."
fi

# 3. Launch in separate gnome-terminal tabs if available on desktop, else run together with Ctrl+C cleanup
if command -v gnome-terminal >/dev/null 2>&1 && [ -n "${DISPLAY:-}" ]; then
    echo "[1/3] Launching Backend on http://localhost:8001 ..."
    gnome-terminal --title="Backend (8001)" -- bash -c "$BACKEND_CMD; exec bash"

    echo "[2/3] Launching Frontend on http://localhost:3000 ..."
    gnome-terminal --title="Frontend (3000)" -- bash -c "$FRONTEND_CMD; exec bash"

    if [ -n "$TUNNEL_CMD" ]; then
        echo "[3/3] Launching Ngrok Tunnel for $PUBLIC_BASE_URL ..."
        gnome-terminal --title="Ngrok Tunnel (8001)" -- bash -c "$TUNNEL_CMD; exec bash"
    fi

    echo "======================================================================"
    echo "  All terminals launched!"
    echo "  Frontend : http://localhost:3000"
    echo "  Backend  : http://localhost:8001"
    [ -n "$PUBLIC_BASE_URL" ] && echo "  Tunnel   : $PUBLIC_BASE_URL"
    echo "======================================================================"
else
    echo "[INFO] Running all services in this terminal (press Ctrl+C to stop all)."
    PIDS=()

    cleanup() {
        echo ""
        echo "Stopping all services..."
        for pid in "${PIDS[@]:-}"; do
            kill "$pid" 2>/dev/null || true
        done
        wait 2>/dev/null || true
        echo "All services stopped."
    }
    trap cleanup INT TERM EXIT

    echo "[1/3] Starting Backend on http://localhost:8001 ..."
    bash -c "$BACKEND_CMD" &
    PIDS+=($!)

    echo "[2/3] Starting Frontend on http://localhost:3000 ..."
    bash -c "$FRONTEND_CMD" &
    PIDS+=($!)

    if [ -n "$TUNNEL_CMD" ]; then
        echo "[3/3] Starting Ngrok Tunnel for $PUBLIC_BASE_URL ..."
        bash -c "$TUNNEL_CMD" &
        PIDS+=($!)
    fi

    wait
fi
