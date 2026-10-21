# Pharmacy Compliance Tracker — common tasks.
# Local (no Docker): copy .env.example to .env, point DATABASE_URL at a Postgres, set STORAGE_DRIVER=local.
# Docker:            `make dev` brings up app + postgres + minio + mailpit + cron.

.PHONY: help dev up tunnel down logs docker-seed docker-demo docker-demo-reset docker-nightly docker-live-board-test migrate generate seed demo demo-reset seed-wipe test test-int e2e lint typecheck nightly screening

help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

dev: ## docker compose up (app, postgres, minio, mailpit, cron)
	docker compose up --build

up: ## docker compose up -d --build (detached)
	docker compose up -d --build

tunnel: ## up -d with the Cloudflare Tunnel override (needs CLOUDFLARE_TUNNEL_TOKEN and APP_URL in .env)
	docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build

down: ## docker compose down (keeps volumes)
	docker compose down

logs: ## follow app + cron logs
	docker compose logs -f app cron

docker-seed: ## inside the running app container: plans, catalog, operator user
	docker compose exec app npx tsx prisma/seed-catalog.ts

docker-demo: ## inside the running app container: seed + the three demo orgs
	docker compose exec app npx tsx prisma/seed-catalog.ts
	docker compose exec app npx tsx prisma/seed-demo.ts

docker-demo-reset: ## inside the running app container: wipe demo orgs and reload
	docker compose exec -e CONFIRM_WIPE=yes app npx tsx prisma/seed-wipe.ts
	docker compose exec app npx tsx prisma/seed-demo.ts

docker-nightly: ## run the nightly job once inside the running cron container
	docker compose exec cron npx tsx jobs/nightly.ts

docker-live-board-test: ## live Texas adapter smoke test inside the app container
	docker compose exec -e RUN_LIVE_BOARD=1 app npx vitest run src/lib/boards

generate: ## prisma generate
	npx prisma generate

migrate: ## apply migrations
	npx prisma migrate deploy

seed: migrate ## catalog (credential types, board lookups) + env admin user; idempotent
	npx tsx prisma/seed-catalog.ts

demo: seed ## load the Sierra Specialty Pharmacy demo data on top of the catalog
	npx tsx prisma/seed-demo.ts

demo-reset: ## wipe demo rows + files, then reload the demo
	CONFIRM_WIPE=yes npx tsx prisma/seed-wipe.ts
	$(MAKE) demo

seed-wipe: ## remove all demo rows and files before importing real data (needs CONFIRM_WIPE=yes)
	npx tsx prisma/seed-wipe.ts

nightly: ## run the nightly job once now
	npx tsx jobs/nightly.ts

screening: ## run both monthly screening jobs now
	npx tsx jobs/screening.ts --source oig_leie
	npx tsx jobs/screening.ts --source sam

test: ## unit tests (vitest)
	npx vitest run

test-int: ## integration tests against DATABASE_URL (org isolation, ledger invariant)
	npx vitest run --config vitest.int.config.mts

e2e: ## playwright smoke test
	npx playwright test

lint: ## eslint
	npm run lint

typecheck: ## tsc --noEmit
	npx tsc --noEmit
