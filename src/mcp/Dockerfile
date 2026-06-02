# Stage 1 — build TypeScript
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2 — minimal runtime image
FROM node:22-alpine AS runtime
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/build ./build

# Non-root user for security
RUN addgroup -S eligraph && adduser -S eligraph -G eligraph \
    && mkdir -p /var/log/eligraph \
    && chown -R eligraph:eligraph /var/log/eligraph
USER eligraph

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/healthz || exit 1

CMD ["node", "build/main.js"]
