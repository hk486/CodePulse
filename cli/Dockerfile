# ============================================================================
# CodePulse CLI Dockerfile
# TypeScript/Node.js Command-Line Interface
# ============================================================================

FROM node:20-alpine

WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

# Build the shared package first (CLI depends on @codepulse/shared)
COPY shared/ ./shared/
RUN cd shared && npm install && npm run build

# Copy CLI package files
COPY cli/package.json* ./

# Install the local shared package first (it is not published on npm),
# then install the remaining CLI dependencies (chalk, commander, glob, ora).
RUN npm install file:./shared \
    && npm install \
    && npm cache clean --force

# Copy source code
COPY cli/src/ ./src/
COPY cli/tsconfig.json ./

# Build the CLI
RUN npx tsc && test -d node_modules/commander && test -f dist/cli.js && echo "CLI built OK"

# Set default command to show help
CMD ["sh", "-c", "echo 'CodePulse CLI is ready.' && echo 'Usage: docker exec -it codepulse-cli node dist/cli.js scan /app/workspace/<your-project-path>' && echo '       docker exec -it codepulse-cli node dist/cli.js compare report1.json report2.json' && tail -f /dev/null"]
