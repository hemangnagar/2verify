# Multi-stage build. The same image serves the app and the cron container.
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat openssl
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
# Full node_modules so prisma CLI, tsx and the job scripts work in the cron container too.
COPY --from=deps /app/node_modules ./node_modules
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
