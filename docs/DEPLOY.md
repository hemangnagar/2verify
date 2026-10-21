# Deploying 2Verify with Docker and a Cloudflare Tunnel

Runs the whole stack on one machine (your laptop or a VPS) and publishes it through a Cloudflare
Tunnel, so there are no open inbound ports and the demo is reachable at a real hostname with TLS.

Requirements: Docker Desktop (or Docker Engine) with Compose v2, a Cloudflare account with a zone
you control, outbound internet.

## 1. Clone and configure

```bash
git clone <repo> 2verify && cd 2verify
cp .env.example .env
```

Edit `.env`:

| Key | Set to |
|---|---|
| `APP_URL` | `https://2verify.example.com` — the public hostname you will give the tunnel. Must be set before the first build. |
| `SESSION_SECRET` | `openssl rand -base64 32` |
| `SEED_OPERATOR_EMAIL` / `SEED_OPERATOR_PASSWORD` | your operator login |
| `SEED_ORG_ADMIN_PASSWORD` | password for the three demo org admins |
| `CLOUDFLARE_TUNNEL_TOKEN` | from step 2 |
| `MAIL_DRIVER` | `smtp` (goes to Mailpit inside Compose; nothing leaves the box) |
| `NPPES_MODE` / `SCREENING_MODE` | `fixture` for the demo (no network), `live` to hit the real sources |
| `BOARD_ADAPTERS` | `on` |

Leave the S3 and SMTP host settings alone; Compose points them at the MinIO and Mailpit containers.

## 2. Create the tunnel (Cloudflare dashboard)

1. Zero Trust → Networks → Tunnels → **Create a tunnel** → Cloudflared → name it `2verify`.
2. Copy the token from the install command (the long string after `--token`) into `CLOUDFLARE_TUNNEL_TOKEN`.
3. **Public hostname** tab → add: subdomain `2verify`, your domain, type `HTTP`, URL `app:3000`.
   (`app` is the Compose service name; cloudflared runs on the same Docker network.)
4. Optional but recommended for a login-only demo: Zero Trust → Access → Applications → add
   `2verify.example.com` with a policy that allows only the founder's email. That puts a Cloudflare
   login in front of the app's own login.

## 3. Build and start

```bash
make tunnel          # docker compose -f docker-compose.yml -f docker-compose.tunnel.yml up -d --build
make logs            # wait for "[app] applying migrations" then "Ready"
make docker-demo     # plans, catalog, operator user, then the three demo orgs (about 30 s)
```

Open `https://2verify.example.com`. Sign in as the operator → `/ops`.

Without a tunnel (local only): `make up` and open http://localhost:3000. `APP_URL` must then be
`http://localhost:3000`.

## 4. What is running

| Container | Purpose | Port on host |
|---|---|---|
| `app` | Next.js app; applies migrations on start | 3000 |
| `cron` | supercronic running the nightly and monthly jobs | — |
| `postgres` | database, named volume `pgdata` | — |
| `minio` + `minio-init` | private evidence bucket, named volume `miniodata` | — |
| `mailpit` | catches every email the app sends; open http://localhost:8025 | 8025 |
| `cloudflared` | the tunnel (tunnel override only) | — |

File links go through the app (`/api/files`, HMAC-signed, 10-minute expiry) so MinIO never needs to
be reachable from the browser.

## 5. Useful commands

```bash
make docker-demo-reset        # wipe the demo orgs and reload
make docker-nightly           # run the nightly job now (alerts land in Mailpit)
make docker-live-board-test   # live Texas adapter smoke test (needs outbound internet)
docker compose exec app npx tsx jobs/screening.ts --source sam --org sierra --mode live
docker compose exec postgres psql -U postgres compliance
docker compose down           # stop; volumes (data) are kept
docker compose down -v        # stop and delete all data
```

Rebuild after pulling code: `make tunnel` again (Compose rebuilds the image). Changing `APP_URL`
also needs a rebuild.

## 6. Checks after first start

1. `/ops` lists Sierra, Harbor, Prairie.
2. Switch into Prairie → Verify → the CVS Pharmacy #11306 permit shows **Automated** → Verify
   automatically. With outbound internet this records a real Texas verification and debits one credit.
3. Mailpit shows the alert emails after `make docker-nightly`.
4. Reports → Survey pack PDF downloads through the tunnel.

## 7. Production notes (beyond the demo)

- Backups: `docker compose exec postgres pg_dump -U postgres compliance > backup.sql` nightly, plus
  the `miniodata` volume. Not automated yet.
- Email for real alerts: set `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` to SES or
  Resend in `.env`; Compose passes `SMTP_HOST`/`SMTP_PORT` through when set.
- Object storage: to use R2 or S3 instead of MinIO, set the `S3_*` keys in `.env` and remove the
  `S3_ENDPOINT` override from `docker-compose.yml`.
- The Docker image downloads Chromium (~170 MB) at build time for the board adapter.
