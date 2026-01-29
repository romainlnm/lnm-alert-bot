FROM node:22-alpine AS builder
WORKDIR /app

# Install build dependencies for native modules
RUN apk add --no-cache python3 make g++

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-alpine
WORKDIR /app

# Install runtime dependencies for better-sqlite3
RUN apk add --no-cache libstdc++

RUN corepack enable

COPY package.json pnpm-lock.yaml ./

# Install with build tools for native module
RUN apk add --no-cache python3 make g++ \
    && pnpm install --frozen-lockfile --prod \
    && apk del python3 make g++

COPY --from=builder /app/dist ./dist

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DATABASE_PATH=/app/data/alerts.db

CMD ["node", "dist/index.js"]
