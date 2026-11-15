#!/bin/bash
# Shared helpers for the checks.
#
# A scan is a job on the server now: the request answers straight away and
# the work happens in the background. So a check that wants the result
# asks for the scan and then waits for it, exactly as a person watching
# the browser would.

API=${API:-http://localhost:5000/api}

# The fixtures live in the repository, so the checks work on a fresh
# clone and not only on the machine they were written on.
FIXTURES=${FIXTURES:-"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fixtures"}

# A scratch folder for the files a check writes.
WORK=${WORK:-$(mktemp -d /tmp/codepulse-check.XXXXXX)}
export FIXTURES WORK

# Ask for a scan and wait for it to finish.
#
#   run_analysis <projectId> <token> [json body]
#
# Prints the finished analysis as JSON. Returns 1 if the scan failed or
# did not finish in time.
run_analysis () {
  local project_id="$1"
  local token="$2"
  local body="${3:-}"

  local response id
  if [ -n "$body" ]; then
    response=$(curl -s -X POST "$API/analysis/run/$project_id" \
      -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' \
      -d "$body")
  else
    response=$(curl -s -X POST "$API/analysis/run/$project_id" \
      -H "Authorization: Bearer $token")
  fi

  id=$(echo "$response" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -z "$id" ]; then
    echo "could not start the scan: $response"
    return 1
  fi

  # How long a scan may take.
  local waited=0
  while [ "$waited" -lt 180 ]; do
    local out
    out=$(curl -s "$API/analysis/$id" -H "Authorization: Bearer $token")
    case "$out" in
      *'"status":"completed"'*)
        echo "$out"
        return 0
        ;;
      *'"status":"failed"'*)
        echo "$out"
        return 1
        ;;
    esac
    sleep 0.5
    waited=$((waited + 1))
  done

  echo "the scan did not finish in time"
  return 1
}

# Ask for a scan without waiting for it. Prints the job id.
start_analysis () {
  local project_id="$1"
  local token="$2"
  local body="${3:-}"

  if [ -n "$body" ]; then
    curl -s -X POST "$API/analysis/run/$project_id" \
      -H "Authorization: Bearer $token" \
      -H 'Content-Type: application/json' \
      -d "$body"
  else
    curl -s -X POST "$API/analysis/run/$project_id" \
      -H "Authorization: Bearer $token"
  fi
}
