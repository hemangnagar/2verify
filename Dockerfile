# Multi-stage build. The same image serves the app and the cron container.
# Debian (not Alpine) because the Texas board adapter runs headless Chromium through Playwright.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# ---- dependencies (dev deps included: prisma CLI and tsx run the migrations and jobs at runtime)
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

# ---- build
FROM base AS build
ARG APP_URL=http://localhost:3000
ENV APP_URL=$APP_URL NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

# ---- runtime
FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
# Headless Chromium + its system libraries for the board adapters. Same Playwright version as package.json.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
RUN npx playwright-core install --with-deps chromium && rm -rf /var/lib/apt/lists/*
# supercronic: a cron runner built for containers (env inherited, logs to stdout). Used by the cron service only.
ARG SUPERCRONIC_VERSION=v0.2.33
RUN ARCH=$(dpkg --print-architecture) && case "$ARCH" in amd64) SC=supercronic-linux-amd64;; arm64) SC=supercronic-linux-arm64;; *) echo "unsupported arch $ARCH" && exit 1;; esac \
    && curl -fsSL -o /usr/local/bin/supercronic "https://github.com/aptible/supercronic/releases/download/${SUPERCRONIC_VERSION}/${SC}" \
    && chmod +x /usr/local/bin/supercronic
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY tsconfig.json next.config.ts ./
COPY prisma ./prisma
COPY jobs ./jobs
COPY src ./src
COPY docker ./docker
RUN chmod +x docker/cron/entrypoint.sh docker/app/entrypoint.sh
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=5 CMD curl -fsS http://localhost:3000/login > /dev/null || exit 1
ENTRYPOINT ["/app/docker/app/entrypoint.sh"]
CMD ["node", "server.js"]
