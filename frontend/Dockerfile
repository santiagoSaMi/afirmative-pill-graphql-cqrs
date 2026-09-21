# ── Dependencias ───────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

# ── Build (las NEXT_PUBLIC_* se incrustan en el bundle del navegador) ──
FROM node:22-alpine AS builder
WORKDIR /app
ARG NEXT_PUBLIC_GRAPHQL_HTTP_URL=http://localhost:4000/graphql
ARG NEXT_PUBLIC_GRAPHQL_WS_URL=ws://localhost:4000/graphql
ENV NEXT_PUBLIC_GRAPHQL_HTTP_URL=$NEXT_PUBLIC_GRAPHQL_HTTP_URL \
    NEXT_PUBLIC_GRAPHQL_WS_URL=$NEXT_PUBLIC_GRAPHQL_WS_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ── Runtime mínimo (salida standalone de Next.js) ──────────
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S app && adduser -S app -G app
COPY --from=builder /app/public ./public
COPY --from=builder --chown=app:app /app/.next/standalone ./
COPY --from=builder --chown=app:app /app/.next/static ./.next/static
USER app
EXPOSE 3000
CMD ["node", "server.js"]
