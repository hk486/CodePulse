#!/bin/bash
# A project with a problem in every language CodePulse has a tool for.
set -e
DIR=${1:-/tmp/toolfixture}
rm -rf "$DIR"
mkdir -p "$DIR/src"

cat > "$DIR/src/bad.ts" <<'EOF'
export function add(a: number, b: number): number { return a + b; }
export function broken(a: string): number { return add(a, 1); }
const x: number = "not a number";
EOF

cat > "$DIR/src/app.py" <<'EOF'
import os


def run(cmd):
    os.system(cmd)
EOF

cat > "$DIR/src/query.sql" <<'EOF'
SELECT * FROM users WHERE id = 1
EOF

cat > "$DIR/src/run.sh" <<'EOF'
#!/bin/bash
DIR=$1
rm -rf $DIR
eval "$CMD"
EOF

cat > "$DIR/src/mem.c" <<'EOF'
#include <string.h>
void f(char *s) {
  char buf[10];
  strcpy(buf, s);
  int x = atoi(s);
}
EOF

cat > "$DIR/src/package-lock.json" <<'EOF'
{
  "name": "vuln",
  "version": "1.0.0",
  "lockfileVersion": 2,
  "requires": true,
  "packages": {
    "": { "name": "vuln", "version": "1.0.0", "dependencies": { "lodash": "4.17.4" } },
    "node_modules/lodash": { "version": "4.17.4", "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.4.tgz" }
  },
  "dependencies": {
    "lodash": { "version": "4.17.4", "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.4.tgz" }
  }
}
EOF

TOKEN=$(od -An -N18 -tx1 /dev/urandom | tr -d ' \n')
printf 'GITHUB_TOKEN=ghp_%s\n' "$TOKEN" > "$DIR/src/.env"

echo "  the fixture is at $DIR"
