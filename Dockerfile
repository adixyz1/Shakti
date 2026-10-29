# Multi-stage Dockerfile for SHAKTI MVP
# Stage 1: Build frontend assets
FROM node:22-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
COPY apps ./apps

RUN npm run build

# Stage 2: Production runner with glibc (node:22-slim, supports linux/arm64 & linux/amd64) and non-root user
FROM node:22-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV SERVE_STATIC=true
ENV PORT=3000
ENV DATABASE_URL=file:/data/shakti.db

# Create SQLite storage directory and app directory owned by non-root node user
RUN mkdir -p /data /app && chown -R node:node /data /app

COPY --chown=node:node package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/public ./public
COPY --chown=node:node data ./data
COPY --chown=node:node apps ./apps
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node server.ts ./

# Run container as non-root user that can write to /data
USER node

EXPOSE 3000

# Built-in health check against unauthenticated /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "start"]

