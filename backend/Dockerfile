# ============================================================================
# CodePulse Backend Dockerfile
# Express.js + SQLite REST API
# ============================================================================

FROM node:20-alpine

WORKDIR /app

# Install build dependencies for native modules (sqlite3, etc.)
RUN apk add --no-cache python3 py3-pip make g++ git curl ca-certificates

# ---------------------------------------------------------------------------
# The established analyzers.
#
# CodePulse's own rules find the problems it knows about. These tools find
# the ones it does not: the TypeScript compiler knows the types, Ruff
# knows Python, SQLFluff knows the SQL dialects, ShellCheck knows the
# shell, Cppcheck knows the memory mistakes in C, Gitleaks knows what a
# secret looks like, and OSV-Scanner asks the vulnerability database
# whether a dependency is known to be broken.
#
# Each one is optional. When a tool is missing the report says it was
# skipped; nothing is ever pretended.
#
# The sizes are what they are because the tools are what they are. The
# Java, Go and Rust toolchains are deliberately not here: they would add
# well over a gigabyte, and the engines that need them are reported as
# unavailable rather than left out quietly.
# ---------------------------------------------------------------------------
RUN apk add --no-cache shellcheck cppcheck unzip

RUN pip3 install --break-system-packages --no-cache-dir ruff sqlfluff \
    && rm -rf /root/.cache/pip

# Gitleaks and OSV-Scanner are single programs, so they are fetched
# rather than built.
ARG GITLEAKS_VERSION=8.24.3
ARG OSV_SCANNER_VERSION=2.0.2
RUN curl -sL -o /tmp/gitleaks.tar.gz \
      "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz" \
    && tar -xzf /tmp/gitleaks.tar.gz -C /usr/local/bin gitleaks \
    && rm -f /tmp/gitleaks.tar.gz \
    && curl -sL -o /usr/local/bin/osv-scanner \
      "https://github.com/google/osv-scanner/releases/download/v${OSV_SCANNER_VERSION}/osv-scanner_linux_amd64" \
    && chmod +x /usr/local/bin/osv-scanner \
    && gitleaks version \
    && osv-scanner --version \
    && ruff --version \
    && sqlfluff --version \
    && shellcheck --version | head -2 \
    && cppcheck --version

# Copy backend package files first for better layer caching
COPY backend/package.json* ./

# Install all backend dependencies
RUN npm install && npm cache clean --force

# Copy backend source code
COPY backend/src/ ./src/
COPY .env* ./

# ---------------------------------------------------------------------------
# Build the shared package (used by the CLI analyzers)
# ---------------------------------------------------------------------------
COPY shared/ ./shared/
RUN cd shared && npm install && npm run build

# ---------------------------------------------------------------------------
# Build the CLI so the backend can run analyses over uploaded projects
#
# NOTE: cli/package.json depends on "@codepulse/shared": "*", which does not
# exist on the public npm registry. Installing it as a local file dependency
# FIRST rewrites package.json to a file: reference so the remaining
# `npm install` can resolve every other dependency (chalk, commander, glob...).
# ---------------------------------------------------------------------------
COPY cli/package.json* ./cli/
COPY cli/src/ ./cli/src/
COPY cli/tsconfig.json ./cli/

RUN cd cli \
    && npm install file:../shared \
    && npm install \
    && npx tsc \
    && test -d node_modules/commander \
    && test -f dist/cli.js \
    && node -e "require('@codepulse/shared'); require('commander'); console.log('CLI built OK')"

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:5000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start the server
CMD ["node", "src/index.js"]
