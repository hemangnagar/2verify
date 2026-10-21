# Multi-stage build. The same image serves the app and the cron container.
# Debian (not Alpine) because the Texas board adapter runs headless Chromium through Playwright.
FROM node:22-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --no-audit --no-fund

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npx prisma generate && npm run build

FROM base AS runner
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000
# Headless Chromium + system deps for the board adapters; PW_CHROMIUM_PATH points the app at it.
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
COPY --from=deps /app/node_modules ./node_modules
RUN npx playwright-core install --with-deps chromium 2>/dev/null || npx --yes playwright@1.56.1 install --with-deps chromium
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY package.json tsconfig.json ./
COPY prisma ./prisma
COPY jobs ./jobs
COPY src ./src
COPY docker ./docker
RUN chmod +x docker/cron/entrypoint.sh
EXPOSE 3000
CMD ["node", "server.js"]
