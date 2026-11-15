#!/bin/bash
# Verification for the established tools.
#
# The tools find the things CodePulse's own rules do not: the types, the
# shape of a language, the memory mistakes in C, and the dependencies
# that are known to be broken. A tool that is not installed has to say so
# rather than pretend to have run.
API=http://localhost:5000/api
. "$(dirname "$0")/lib.sh"
pass=0; fail=0
chk () { if [ "$2" = "$3" ]; then echo "  ✅ $1"; pass=$((pass+1)); else echo "  ❌ $1 (expected '$3', got '$2')"; fail=$((fail+1)); fi }
has () { if echo "$2" | grep -q "$3"; then echo "  ✅ $1"; pass=$((pass+1)); else echo "  ❌ $1 (no '$3' in: $(echo "$2" | head -c 200))"; fail=$((fail+1)); fi }

REPO=/home/harmeet/codePulse
CLI_DIR=$REPO/cli

echo "=== The fixture ==="
WORK=$(mktemp -d /tmp/codepulse-tools.XXXXXX)
NAME=toolcheck-$$
TARGET="$REPO/uploads/$NAME"
TOKEN=
P=
cleanup () {
  if [ -n "$P" ] && [ -n "$TOKEN" ]; then
    curl -s -X DELETE "$API/projects/$P" -H "Authorization: Bearer $TOKEN" > /dev/null
  fi
  if [ -n "$TOKEN" ]; then
    curl -s -X DELETE "$API/auth/account" -H "Authorization: Bearer $TOKEN" > /dev/null
  fi
  rm -rf "$WORK" "$TARGET"
}
trap cleanup EXIT
mkdir -p "$TARGET"
bash "$REPO/test/fixtures/tools.sh" "$TARGET" > /dev/null
chk "the fixture was made" "$([ -d "$TARGET/src" ] && echo yes)" "yes"
TEST_TOKEN=$(sed -n 's/^GITHUB_TOKEN=//p' "$TARGET/src/.env")

EMAIL="tools$(date +%s)@test.com"
TOKEN=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"fullName\":\"Tool Check\",\"email\":\"$EMAIL\",\"password\":\"SecurePass1\"}" \
  | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
chk "test account registered" "$([ -n "$TOKEN" ] && echo yes)" "yes"

P=$(curl -s -X POST "$API/projects" -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name":"External Tool Check","path":"","languages":["auto"]}' \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
chk "test project created" "$([ -n "$P" ] && echo yes)" "yes"

args=()
while IFS= read -r file; do
  args+=( -F "files=@$TARGET/$file;filename=$file" )
done < <(cd "$TARGET" && find . -type f | sed 's|^\./||')
UPLOAD=$(curl -s -X POST "$API/projects/$P/upload" \
  -H "Authorization: Bearer $TOKEN" "${args[@]}")
chk "fixture uploaded" "$(echo "$UPLOAD" | grep -o '"count":[0-9]*' | cut -d: -f2)" "7"

echo ""
echo "=== The scanner runs the tools ==="
RES=$(run_analysis "$P" "$TOKEN")
AID=$(echo "$RES" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
REPORT=$(curl -s "$API/analysis/$AID" -H "Authorization: Bearer $TOKEN")
printf '%s\n' "$REPORT" > "$WORK/report.json"
chk "the scan finished" "$([ -n "$AID" ] && echo yes)" "yes"

echo ""
echo "=== Each tool says what it found ==="
tool_found () {
  local tool="$1"
  local count
  count=$(python3 -c "
import json
d = json.load(open('$WORK/report.json'))
print(sum(1 for f in d.get('findings', []) if f.get('tool') == '$tool'))
")
  chk "$tool found something" "$([ "$count" -ge 1 ] && echo yes)" "yes"
}

tool_found "TypeScript Compiler"
tool_found "Ruff"
tool_found "SQLFluff"
tool_found "ShellCheck"
tool_found "Cppcheck"
tool_found "Gitleaks"

echo ""
echo "=== The compiler knows the types ==="
has "the type error is reported" "$REPORT" 'TS2345'
has "and it says what is wrong" "$REPORT" 'not assignable'
CONFIRMED=$(python3 -c "
import json
d = json.load(open('$WORK/report.json'))
print('yes' if any(
    f.get('ruleId') == 'TS2345' and f.get('validation') == 'confirmed'
    for f in d.get('findings', [])
) else 'no')
")
chk "and it is confirmed, not a guess" "$CONFIRMED" "yes"

echo ""
echo "=== The dependency scanner finds the known vulnerabilities ==="
has "the CVE is named" "$REPORT" 'CVE-2020-28500'
has "the package is named" "$REPORT" 'lodash'
has "the lock file is the place" "$REPORT" 'package-lock.json'

echo ""
echo "=== The secret scanner does not repeat the secret ==="
has "the token is found" "$REPORT" 'github-pat'
if printf '%s' "$REPORT" | grep -Fq -- "$TEST_TOKEN"; then
  echo "  ❌ the secret was written into the report"
  fail=$((fail+1))
else
  echo "  ✅ the secret was not written into the report"
  pass=$((pass+1))
fi

echo ""
echo "=== Every tool is recorded, with its status ==="
EXECUTIONS=$(python3 -c "
import json
d = json.load(open('$WORK/report.json'))
tools = [a for a in (d.get('pipeline') or {}).get('analyzers', []) if a['id'].startswith('tool-')]
print(len(tools))
for t in tools:
    print('   ', t['name'], t['status'], t.get('findingCount'))
")
echo "$EXECUTIONS" | sed 's/^/  /'
TOOL_COUNT=$(echo "$EXECUTIONS" | head -1)
chk "every tool is recorded" "$([ "$TOOL_COUNT" -ge 7 ] && echo yes)" "yes"
has "the tools that ran say so" "$EXECUTIONS" "completed"

echo ""
echo "=== A tool that is not installed says so ==="
MISSING=$(cd "$CLI_DIR" && node -e "
const { ToolRunner } = require('./dist/services/tools/runner.js');
const runner = new ToolRunner();
const fake = { id: 'not-a-tool', name: 'Not A Tool', command: 'definitely-not-installed', args: () => [], parse: () => [] };
runner.analyze(fake, { projectPath: '.', files: [], languageOf: () => undefined }).then(r => {
  console.log(r.run.status + '|' + (r.run.reason || ''));
});
" 2>/dev/null | tail -1)
chk "a missing tool is unavailable" "$(echo "$MISSING" | cut -d'|' -f1)" "unavailable"
has "and it says why" "$MISSING" "not installed"

echo ""
echo "════════════════════════════════════"
echo "  PASSED: $pass    FAILED: $fail"
echo "════════════════════════════════════"
exit "$([ "$fail" = "0" ] && echo 0 || echo 1)"
