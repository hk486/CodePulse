#!/usr/bin/env bash
#
# CodePulse - start the complete stack with Docker.
#
#   ./start.sh          build if needed, start every container, wait until healthy
#   ./start.sh --rebuild   force a rebuild of every image
#   ./start.sh --stop      stop and remove the containers
#   ./start.sh --logs      follow the logs
#
set -euo pipefail

cd "$(dirname "$0")"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

COMPOSE="docker compose"

if ! docker compose version >/dev/null 2>&1; then
  if command -v docker-compose >/dev/null 2>&1; then
    COMPOSE="docker-compose"
  else
    echo -e "${RED}❌ Docker Compose is not installed.${NC}"
    echo "   Install Docker Desktop or the docker-compose plugin and try again."
    exit 1
  fi
fi

if ! command -v docker >/dev/null 2>&1; then
  echo -e "${RED}❌ Docker is not installed.${NC}"
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo -e "${RED}❌ The Docker daemon is not running.${NC}"
  echo "   Start Docker and try again."
  exit 1
fi

stop_stack () {
  echo "🛑 Stopping CodePulse..."
  $COMPOSE down
  echo -e "${GREEN}✓ Stopped.${NC}"
}

follow_logs () {
  $COMPOSE logs -f
}

case "${1:-}" in
  --stop)
    stop_stack
    exit 0
    ;;
  --logs)
    follow_logs
    exit 0
    ;;
  --rebuild)
    echo "🔨 Rebuilding every image..."
    $COMPOSE build
    ;;
  "")
    echo "🐳 Starting CodePulse..."
    ;;
  *)
    echo "Usage: ./start.sh [--rebuild|--stop|--logs]"
    exit 1
    ;;
esac

$COMPOSE up -d

echo ""
echo "⏳ Waiting for the services to become healthy..."
for _ in $(seq 1 60); do
  pending=$($COMPOSE ps --format '{{.Service}}:{{.Status}}' | grep -v -E 'healthy|running' | wc -l | tr -d ' ')
  if [ "$pending" = "0" ]; then
    break
  fi
  sleep 2
done

echo ""
$COMPOSE ps
echo ""

if ! curl -sf http://localhost:5000/api/health >/dev/null 2>&1; then
  echo -e "${YELLOW}⚠️  The backend is not answering yet. Check the logs with: ./start.sh --logs${NC}"
else
  echo -e "${GREEN}✅ CodePulse is up and running${NC}"
fi

cat <<'EOF'

────────────────────────────────────────────────────────────
  🌐  App        http://localhost:3000
  🔌  API        http://localhost:5000/api
  ❤️  Health     http://localhost:5000/api/health

  📁  How to use
     1. Create an account or sign in
     2. Projects → New Project → give it a name
     3. Open the project card and use "Choose Folder"
     4. Click "Upload N files"
     5. Click "Analyse Now"

────────────────────────────────────────────────────────────
EOF
