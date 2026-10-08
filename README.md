# Danfo Backend

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.2+-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

API and backend services for the Danfo economic trust protocol. Provides public trust querying, on-chain bond lifecycle tracking, dispute resolution, attestation records, and background event reconciliation with Stellar Horizon and Soroban smart contracts.

---

## Architecture & Monorepo Structure

The repository is structured as a modular TypeScript monorepo using npm workspaces:

```
danfo-Backend/
├── packages/
│   ├── core/              # @danfo/core: Database, domain models, cache, schemas, utilities
│   │   ├── src/db/        # PostgreSQL connection pool, queries, outbox repository
│   │   ├── src/services/  # Core business logic (bonds, analytics, attestations, key management)
│   │   ├── src/cache/     # Redis client, caching abstractions, invalidation bus
│   │   ├── src/schemas/   # Centralized Zod request & response validation schemas
│   │   └── src/lib/       # Error catalogs, retry policies, domain constants
│   └── api/               # @danfo/api: Express HTTP service, routes, middleware, jobs
│       ├── src/routes/    # REST API endpoints (health, trust, bond, admin, payouts, webhooks)
│       ├── src/middleware/# Rate limiting, security headers, metrics, tenant context
│       ├── src/jobs/      # Schedulers, sweepers, outbox publisher, reconcilers
│       └── src/index.ts   # HTTP listener and WebSocket subscription server entrypoint
├── src/                   # Root source entrypoint & compatibility layer
├── scripts/               # Migration checkers, integrity verification, drills, utilities
├── tests/                 # Integration, chaos, and end-to-end test suites
└── docs/                  # Architecture, API specs, runbooks, and operator manuals
```

### Key Capabilities

- **High-Performance Trust API**: Endpoints for trust scores, bond status, attestations, and analytics.
- **On-Chain Identity & Event Sync**: Horizon listener for bond events and real-time state reconciliation.
- **Enterprise Caching & Invalidation**: Redis L1/L2 multi-tier caching with PostgreSQL LISTEN/NOTIFY invalidation bus.
- **Reliable Outbox Pattern**: Transactional outbox event publishing with deduplication and lease-based distributed workers.
- **Resilient Retry & Circuit Breaker**: Exponential backoff with jitter and fail-fast circuit breakers across downstream dependencies.
- **Structured Observability**: Prometheus metrics, Grafana dashboards, OpenTelemetry distributed tracing, and audit logs.

---

## Prerequisites

- **Node.js**: 18.x or later (v20+ recommended)
- **npm** or **pnpm**
- **PostgreSQL**: 15+ (PostgreSQL 16 recommended)
- **Redis**: 7+ (for caching and rate limiting)
- **Docker & Docker Compose**: (optional, for local containerized environment)
- **Stellar Horizon**: Horizon server instance for on-chain event streams

---

## Getting Started

### 1. Installation

```bash
git clone https://github.com/DanfoOrg/danfo-Backend.git
cd danfo-Backend
npm install
```

### 2. Environment Configuration

Copy the example environment configuration file and update it with your credentials:

```bash
cp .env.example .env
```

Key environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP listener port |
| `NODE_ENV` | `development` | Runtime environment (`development`, `production`, `test`) |
| `DB_URL` | — | PostgreSQL connection string (`postgres://user:pass@host:5432/db`) |
| `REDIS_URL` | — | Redis connection URL (`redis://localhost:6379`) |
| `JWT_SECRET` | — | Secret string for JWT signing/verification (minimum 32 characters) |
| `HORIZON_URL` | — | Stellar Horizon API endpoint |
| `STELLAR_NETWORK_PASSPHRASE` | — | Network passphrase for Stellar / Soroban network |

Detailed configuration documentation with all available options is located in **[docs/CONFIG_TEMPLATE.md](docs/CONFIG_TEMPLATE.md)**.

---

## Running the Application

### Development Mode

Run the backend with file-watching and automated pending migration checks:

```bash
# Start root development server
npm run dev

# Or start the @danfo/api workspace directly
npm run dev:api
```

The server boots on [http://localhost:3000](http://localhost:3000).

### Production Build

```bash
# Build TypeScript artifacts
npm run build

# Start production server
npm start
```

### Workspace Commands

```bash
# Typecheck @danfo/core
npm run build:core

# Typecheck @danfo/api
npm run build:api
```

---

## Docker Deployment (Local Stack)

Run the complete stack (API, PostgreSQL, Redis, Prometheus, Grafana) with Docker Compose:

```bash
# Launch all services
docker compose up --build

# Verify health status
curl http://localhost:3000/api/health
```

To stop containers and clean up data volumes:

```bash
docker compose down -v
```

---

## Database Migrations

Database migrations are powered by [node-pg-migrate](https://salsita.github.io/node-pg-migrate/) with SHA-256 checksum validation to prevent schema drift.

```bash
# Apply pending migrations locally
npm run migrate:dev

# Create a new migration file
npm run migrate:create my_new_migration

# Rollback previous migration
npm run migrate:down

# Preview migration execution (dry run)
npm run migrate:dry-run

# Reset local test database
npm run test:db:reset
```

---

## API Overview

| Method | Endpoint | Description | Auth / Scope |
|---|---|---|---|
| `GET` | `/api/health` | Comprehensive readiness probe (DB, Redis, dependencies) | Public |
| `GET` | `/api/health/live` | Process liveness probe | Public |
| `GET` | `/api/version` | Service build information, git commit SHA, and node version | Public |
| `GET` | `/.well-known/jwks.json` | Public JSON Web Key Set for token verification | Public |
| `GET` | `/api/trust/:address` | Retrieve trust score for a Stellar address | Public |
| `GET` | `/api/bond/:address` | Retrieve on-chain bond status and parameters | Public |
| `GET` | `/api/attestations/:address`| List active attestations for address | Public |
| `POST`| `/api/attestations` | Create a new attestation record | Authenticated |
| `POST`| `/api/payouts` | Submit settlement payout (idempotent with `Idempotency-Key`) | `payouts:write` |
| `GET` | `/api/analytics/summary` | Aggregated analytics summary from materialized views | Authenticated |
| `GET` | `/api/reports/top-talkers` | Top tenant request volume in the trailing hour | Admin |
| `GET` | `/metrics` | Prometheus metrics scrape endpoint | Restricted |

Detailed API specifications, sample payloads, and cURL examples can be found in **[docs/api.md](docs/api.md)** and the OpenAPI specification at **`docs/openapi.yaml`**.

---

## Testing & Quality Assurance

Run the test suite via [Vitest](https://vitest.dev/):

```bash
# Run unit & integration tests
npm test

# Run tests with coverage report
npm run test:coverage

# Run chaos tests (fault injection)
npm run test:chaos

# Run code linter
npm run lint

# Auto-fix linting violations
npm run lint:fix
```

Detailed testing instructions and guides are available in **[docs/CONTRIBUTING-TESTING.md](docs/CONTRIBUTING-TESTING.md)**.

---

## Observability & Operations

- **Prometheus Metrics**: Scraped via `/metrics`. Metric documentation in **[docs/OBSERVABILITY.md](docs/OBSERVABILITY.md)**.
- **Grafana Dashboards**: Dashboards mapped directly to SLOs/SLIs. Guide in **[docs/METRICS_DASHBOARDS.md](docs/METRICS_DASHBOARDS.md)**.
- **Alert Routing**: Pipeline setup in **[docs/alert-routing.md](docs/alert-routing.md)**.
- **Graceful Shutdown**: Ordered drain of HTTP, WebSocket, background schedulers, and connection pools. Reference in **[docs/graceful-shutdown.md](docs/graceful-shutdown.md)**.
- **Read-Only Degradation**: Pass header `X-Read-Only: true` during maintenance. Details in **[docs/graceful-degrade.md](docs/graceful-degrade.md)**.

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.
