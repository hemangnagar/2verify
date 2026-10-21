# Pharmacy Compliance Tracker — common tasks.
# Local (no Docker): copy .env.example to .env, point DATABASE_URL at a Postgres, set STORAGE_DRIVER=local.
# Docker:            `make dev` brings up app + postgres + minio + mailpit + cron.

.PHONY: help dev down migrate generate seed demo demo-reset seed-wipe test e2e lint typecheck nightly screening

help:
	@grep -E '^[a-zA-Z_-]+:.*?## ' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-14s %s\n", $$1, $$2}'

dev: ## docker compose up (app, postgres, minio, mailpit, cron)
	docker compose up --build

down: ## docker compose down (keeps volumes)
	docker compose down

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

e2e: ## playwright smoke test
	npx playwright test

lint: ## eslint
	npm run lint

typecheck: ## tsc --noEmit
	npx tsc --noEmit
