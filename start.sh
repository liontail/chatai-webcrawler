#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Ragnarok Classic GGT — AI Chat Stack    ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ── 1. FlareSolverr ──────────────────────────────────────────────────────────
echo "▶  Checking FlareSolverr (Docker)..."
if ! docker ps --format '{{.Names}}' | grep -q "flaresolverr"; then
  echo "   Starting FlareSolverr container..."
  docker run -d \
    --name flaresolverr \
    -p 8191:8191 \
    -e LOG_LEVEL=info \
    --restart unless-stopped \
    ghcr.io/flaresolverr/flaresolverr:latest > /dev/null
  echo "   FlareSolverr started on :8191"
else
  echo "   FlareSolverr already running ✓"
fi

# ── 2. Qdrant ────────────────────────────────────────────────────────────────
echo "▶  Checking Qdrant (Docker)..."
if ! docker ps --format '{{.Names}}' | grep -q "qdrant"; then
  echo "   Starting Qdrant container..."
  docker run -d \
    --name qdrant \
    -p 6333:6333 \
    -v "$(pwd)/qdrant_storage:/qdrant/storage" \
    --restart unless-stopped \
    qdrant/qdrant > /dev/null
  echo "   Qdrant started on :6333"
else
  echo "   Qdrant already running ✓"
fi

# ── 3. Wait for Qdrant to be ready ───────────────────────────────────────────
echo "▶  Waiting for Qdrant to be ready..."
for i in $(seq 1 20); do
  if curl -sf http://localhost:6333/healthz > /dev/null 2>&1; then
    echo "   Qdrant ready ✓"
    break
  fi
  sleep 1
done

# ── 4. Chatbot server ────────────────────────────────────────────────────────
echo "▶  Starting chatbot server..."
mkdir -p logs

# Kill any existing server on the port
PORT="${PORT:-3200}"
lsof -ti :$PORT | xargs kill -9 2>/dev/null || true
sleep 1

node ai/server.js >> logs/chatbot.log 2>&1 &
SERVER_PID=$!
echo "   Server PID: $SERVER_PID"

# Wait for server to respond
for i in $(seq 1 15); do
  if curl -sf http://localhost:$PORT/health > /dev/null 2>&1; then
    echo "   Chatbot server ready ✓"
    break
  fi
  sleep 1
done

echo ""
echo "══════════════════════════════════════════════"
echo "  ✅ All services running!"
echo "  🌐 Web client : http://localhost:$PORT"
echo "  📡 API health : http://localhost:$PORT/health"
echo "  📊 API stats  : http://localhost:$PORT/stats"
echo "══════════════════════════════════════════════"
echo ""
echo "  Press Ctrl+C to stop the chatbot server"
echo "  (Docker containers keep running separately)"
echo ""

# Keep script alive so Ctrl+C kills the server
wait $SERVER_PID
