# ============================================================================
# CodePulse Frontend Dockerfile
# React + Vite (built, served by nginx)
# ============================================================================

# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Build the shared package (frontend imports its types)
COPY shared/ ./shared/
RUN cd shared && npm install && npm run build

# Copy frontend source code
COPY frontend/ ./frontend/

# Install the local shared package first (it is not published on npm),
# then install the frontend dependencies and build.
RUN cd frontend \
    && npm install file:../shared \
    && npm install \
    && npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built assets from builder
COPY --from=builder /app/frontend/dist /usr/share/nginx/html

# Copy custom nginx config
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 3000

# Health check (use 127.0.0.1 - busybox wget resolves localhost to IPv6)
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3000/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
