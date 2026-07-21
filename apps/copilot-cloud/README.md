# @copilot/cloud · Copilot Cloud Server

> Phase 1 · stateless LLM proxy security boundary (Fastify + existing CloudBase lifecycle relay).

**Server = thin, stateless LLM relay.** Knowledge graph / KB / graph compute are NOT on the cloud.
The existing CloudBase lifecycle relay is not a remote-management or backup implementation.

---

## Routes

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET    | `/health`             | public  | Fixed liveness metadata only; no readiness or configuration posture |
| GET    | `/ready`              | Bearer  | Configuration readiness (`200` ready, `503` fail-closed) |
| GET    | `/`                   | public  | Service info + route advertisement |
| POST   | `/v1/chat`            | Bearer  | Bounded proxy to the configured LLM upstream; streaming + non-streaming |
| POST   | `/v1/embeddings`      | Bearer  | Bounded proxy to the configured embeddings upstream; no cloud KB storage |
| GET    | `/cloudbase-relay`    | public  | Capability advertisement for CloudBase container services |
| POST   | `/cloudbase-relay`    | Bearer  | Container lifecycle events (`ping`, `status`, `drain`, `rotate`) |

---

## Run locally

```bash
# Install (workspace-level — already in apps/copilot-cloud)
npm install

# Type-check
npm run check

# Run tests
npm run test

# Run with coverage
npm run test:coverage

# Dev mode (auto-restart on file change)
PORT=8788 COPILOT_CLOUD_TOKENS="dev-token-1,dev-token-2" \
  LLM_API_KEY="sk-your-real-key" \
  LLM_BASE_URL="http://127.0.0.1:45557/v1" \
  npm run dev

# Production build + start
npm run build
NODE_ENV=production PORT=8788 COPILOT_CLOUD_TOKENS="<prod-tokens>" \
  LLM_API_KEY="<key>" LLM_BASE_URL="https://llm.example/v1" \
  CORS_ORIGINS="https://desktop.example" TRUST_PROXY_HOPS=1 \
  npm run start
```

---

## Environment Variables

| Var | Default | Required | Description |
|-----|---------|----------|-------------|
| `PORT` | `8788` | no | HTTP listen port; exact integer `1..65535` or startup fails |
| `HOST` | `0.0.0.0` | no | Listen address |
| `NODE_ENV` | `development` | no | Exact `development`, `test`, or `production`; unknown/case/whitespace variants fail startup |
| `LOG_LEVEL` | `info` (prod) / `debug` (dev) | no | Pino log level |
| `LLM_BASE_URL` | `http://127.0.0.1:45557/v1` | **yes in prod** | Upstream LLM endpoint; production requires HTTPS without credentials |
| `LLM_API_KEY` | (empty) | **yes in prod** | Upstream LLM bearer token |
| `LLM_CHAT_PATH` | `/chat/completions` | no | LLM chat completions path |
| `LLM_EMBEDDINGS_PATH` | `/embeddings` | no | LLM embeddings path |
| `LLM_TIMEOUT_MS` | `60000` | no | Upstream LLM timeout |
| `COPILOT_CLOUD_TOKENS` | (empty in prod) | **yes in prod** | Comma-separated Bearer tokens accepted from clients |
| `COPILOT_CLOUD_AUTH_TOKEN` | (empty) | no | Legacy single-token fallback |
| `AUTH_DISABLED` | `0` | no | Set `1` only in dev/test; production refuses to start |
| `CORS_ORIGINS` | (empty) | **yes in prod** | Exact comma-separated HTTPS origins; empty and `*` fail production startup |
| `TRUST_PROXY_HOPS` | (empty) | conditional | Explicit trusted hop count (`1..10`); mutually exclusive with CIDRs |
| `TRUST_PROXY_CIDRS` | (empty) | conditional | Explicit trusted proxy CIDRs; mutually exclusive with hops |
| `RATE_LIMIT_MAX` | `60` | no | Max requests per window per IP |
| `RATE_LIMIT_WINDOW_MS` | `60000` | no | Rate-limit window |
| `CLOUDBASE_RELAY_ENABLED` | `1` | no | Set `0` to disable `/cloudbase-relay` |
| `CLOUDBASE_RELAY_PATH` | `/cloudbase-relay` | no | Relay mount path |

---

## Docker

```bash
# Build image (build context = repo root)
docker build -t copilot-cloud:dev -f Dockerfile ../..

# Run locally
docker run --rm -p 8788:8788 \
  -e LLM_API_KEY=sk-your-real-key \
  -e COPILOT_CLOUD_TOKENS=test-tok-1 \
  copilot-cloud:dev

# Verify
curl http://localhost:8788/health
curl -X POST http://localhost:8788/v1/chat \
  -H "Authorization: Bearer test-tok-1" \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"hi"}]}'
```

Image uses multi-stage build: `node:24-alpine` builder + `gcr.io/distroless/nodejs24-debian12` runtime.

---

## CloudBase Deployment (Tencent Cloud)

Prerequisites (NJX domain — rules.md §1.3):
- `tcb` CLI logged in (`tcb login`)
- CloudBase env ID + quota
- `LLM_API_KEY` + `COPILOT_CLOUD_TOKENS` as env secrets
- An operator-verified `TRUST_PROXY_HOPS` or `TRUST_PROXY_CIDRS` contract for the deployment topology

```bash
# 1. Set env
export CLOUDBASE_ENV_ID="your-env-1234"
export LLM_API_KEY="sk-..."
export COPILOT_CLOUD_TOKENS="prod-tok-1,prod-tok-2"
export CORS_ORIGINS="https://your-copilot-app.example"
export TRUST_PROXY_HOPS="1" # Example only; verify the actual CloudBase proxy chain.

# 2. Deploy (uses cloudbaserc.json in this dir)
cd apps/copilot-cloud
tcb framework deploy

# 3. Verify remote health
curl https://${CLOUDBASE_ENV_ID}.ap-shanghai.tcb-api.tencentcloud.com/health
```

`cloudbaserc.json` wires:
- Image build from `./Dockerfile` with build context `../..` (repo root)
- Port `8788`
- 0.5 CPU / 1 GB RAM / 0-5 instances (cold start friendly)
- All env vars from `${env.X}` placeholders (resolved by tcb from local env or secret store)
- Custom log set `copilot-cloud-logs` + topic `copilot-cloud-app`

---

## Architecture Notes

### Goal.md v6.1 决策 2 alignment
- **No KB / KG / graph compute on cloud.** This server is stateless and stores nothing beyond process memory.
- Embeddings proxy exists for future remote-RAG use, but actual KB storage remains on the desktop app.
- CloudBase container is auto-scaled 0-5 instances (cold start OK because no shared state).

### Streaming
- Streaming uses `text/event-stream` with `Readable.fromWeb(upstream.body)` so chunks flow back to the
  client as the upstream produces them.
- `x-accel-buffering: no` prevents nginx-style buffering on CloudBase.

### Auth
- Bearer token per-device — desktop app syncs token at startup from user config.
- Multiple tokens supported via `COPILOT_CLOUD_TOKENS` (comma-separated).
- In dev/test, a default `dev-local-test-token` is used to make curl trivial. Production REQUIRES
  explicit tokens.

### Request and error boundary
- Request bodies are capped at 1 MiB.
- Chat accepts only `model`, `messages`, `stream`, `temperature`, and `max_tokens`; tool/function/action
  fields are rejected because the proxy can suggest or answer but cannot expand caller authority.
- Embeddings accepts only `model` and bounded string/string-array `input`.
- Upstream status, body, URL, key, exception, and stack are never returned. Responses and logs use only
  stable reason codes plus a request ID.

### Rate limit
- 60 rpm / IP default (configurable).
- `/health` and `/` are exempt (CloudBase probes).
- Limiter-store errors fail protected routes closed (`skipOnError: false`).
- `trustProxy` defaults to `false`; production accepts only an explicit hop-count or CIDR contract.

---

## Project Structure

```
apps/copilot-cloud/
├── package.json          # @copilot/cloud workspace
├── tsconfig.json         # ES2024 + NodeNext
├── vitest.config.ts      # vitest + v8 coverage (≥ 70% threshold)
├── Dockerfile            # multi-stage, distroless final
├── cloudbaserc.json      # Tencent CloudBase deploy spec
├── .dockerignore
├── src/
│   ├── index.ts          # Fastify boot + listen
│   ├── config.ts         # env loader
│   ├── routes/
│   │   ├── health.ts
│   │   ├── v1-chat.ts    # LLM proxy (streaming + non-streaming)
│   │   └── v1-embeddings.ts
│   ├── middleware/
│   │   ├── cors.ts
│   │   ├── rate-limit.ts
│   │   └── auth.ts
│   └── relay/
│       └── cloudbase-handler.ts
└── tests/
    ├── helpers.ts
    ├── app-boot.test.ts
    ├── config.test.ts
    ├── health.test.ts
    ├── v1-chat.test.ts
    ├── v1-embeddings.test.ts
    ├── cloudbase-relay.test.ts
    └── auth-rate-limit.test.ts
```

---

## Verification

- `npm run check` — TypeScript clean
- `npm run test` — full cloud suite, including production security and stateless-boundary integration
- `npm run test:coverage` — coverage gate
- `node dist/index.js` + `curl /health` → 200 OK
- See `SELF-VERIFY-T-1.1.3.md` for full self-verify report
