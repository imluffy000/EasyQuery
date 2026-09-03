# AI Database Copilot

Ask questions about your database in plain language. The system reads your
schema, asks for clarification when a question is genuinely ambiguous, writes
read-only SQL, validates it, checks what it will cost before running it,
executes it, and explains the result.

Built as a real product rather than a demo: multi-tenant, credential
encryption, two independent layers of SQL restriction, observability, an agent
benchmark, and a CI pipeline.

---

## Quick start

Requires Docker and Docker Compose. Nothing else — no local Python or Node.

```bash
git clone <this-repo> && cd ai-database-copilot
cp .env.example .env
make up
```

| Service    | URL                            |
| ---------- | ------------------------------ |
| App        | http://localhost:5173          |
| API        | http://localhost:8000/api/v1   |
| API docs   | http://localhost:8000/docs     |
| Metrics    | http://localhost:8000/metrics  |
| Prometheus | http://localhost:9090          |
| Grafana    | http://localhost:3001 (admin/admin) |

Then:

1. Open the app and create an account.
2. **Databases → Connect database.** A demo database is already seeded and
   waiting — use these values:

   | Field    | Value                  |
   | -------- | ---------------------- |
   | Host     | `postgres`             |
   | Port     | `5432`                 |
   | Database | `demo_analytics`       |
   | Username | `copilot_readonly`     |
   | Password | `copilot_readonly_pw`  |
   | SSL mode | `disable`              |

   That role is deliberately `SELECT`-only, so you can see the read-only layer
   working. It holds 2,000 customers, 18,000 orders, 36,000 line items and
   50,000 events, generated deterministically.
3. Finish the wizard (it tests the connection and imports the schema).
4. Go to **Chat** and ask something.

### Using a real model

Out of the box `LLM_PROVIDER=echo`, an offline provider that runs the entire
pipeline — schema retrieval, validation, `EXPLAIN`, execution — but returns a
placeholder query instead of calling a model. It exists so the project runs
and its tests pass with no API key and no network.

For actual natural-language answers, set in `.env`:

```bash
LLM_PROVIDER=anthropic
LLM_MODEL=claude-sonnet-5
LLM_API_KEY=sk-ant-...
```

then `make restart`.

---

## How a question becomes an answer

```
question
   │
   ├─ intent classification
   ├─ schema retrieval          ← only relevant tables, never the whole schema
   ├─ ambiguity check ──────────→ ask the user, stop here
   ├─ query plan                 ← structured IR, not SQL yet
   ├─ SQL generation
   ├─ validation (SQL guard) ───→ correction loop, max 2 attempts
   ├─ EXPLAIN + cost gate ──────→ ask for confirmation, stop here
   ├─ execution                  ← read-only transaction, timeout, row cap
   ├─ result analysis            ← statistics computed here, not by the model
   ├─ visualization              ← chosen from result shape, deterministically
   └─ answer
```

Two design choices carry most of the reliability:

**Language → plan → SQL, not language → SQL.** The model first produces a
structured query plan (metrics, dimensions, filters, time range, joins). SQL is
generated from that, then checked against it. Free-form text-to-SQL is where
most wrong answers come from.

**The model never decides what is safe.** Its SQL is validated by a parser,
independently of anything any prompt said. Prompt injection cannot widen
privilege, because privilege is not the model's to grant.

---

## Security

### Two independent layers stop writes

Neither is trusted alone.

1. **Application** — `app/security/sql_guard.py` parses every statement into an
   AST (sqlglot) and applies an allowlist. Not regex: regex SQL filtering is
   bypassed with comments, casing, and string splitting.
2. **Database** — the connection uses a role with only `SELECT`, and every
   query runs inside a `READ ONLY` transaction with a `statement_timeout`.

Verified independently in `tests/integration/test_postgres_connector.py`:
the read-only role gets `permission denied for table categories` on `INSERT`
and `must be owner of table orders` on `DROP`.

The guard blocks, with tests for each:

| Attack                    | Result                |
| ------------------------- | --------------------- |
| `DELETE FROM orders`      | `DML_BLOCKED`         |
| `DROP TABLE orders`       | `DDL_BLOCKED`         |
| `SELECT 1; DROP TABLE x`  | `MULTIPLE_STATEMENTS` |
| `pg_read_file('/etc/passwd')` | `FUNCTION_BLOCKED` |
| `pg_sleep(60)`            | `FUNCTION_BLOCKED`    |
| `SELECT * FROM pg_authid` | `SYSTEM_CATALOG`      |
| `SELECT * FROM secrets.x` | `SCHEMA_NOT_ALLOWED`  |
| Query with no `LIMIT`     | rewritten with one    |

### Credentials

Database passwords are encrypted with Fernet before storage and decrypted only
at connection time. There is no `connection_string` column anywhere — a DSN
would put the password back into a loggable string. No API response includes a
credential field; `DatabaseConnectionOut` is the enforcement point.

Key rotation is supported: `SecretBox.from_keys([new, old])` reads under either
and re-encrypts under the first.

### Prompt injection

Database content is untrusted data. A row in `customer_notes` reading
"ignore previous instructions" is a string value, not a command. Untrusted
content is fenced with non-nestable delimiters, forged delimiters inside it are
neutralised, and injection attempts are logged. But the layer that actually
holds is the guard: the model's output is validated no matter what it was told.

### Tenant isolation

`require_workspace_access` re-resolves every `workspace_id` against
`WorkspaceMember` for the authenticated user. An ID from the client is an
assertion, never a grant. A non-member gets `404`, not `403`, so workspace
existence does not leak.

Roles: Owner, Admin, Analyst, Viewer. Permissions are explicit — an unknown
role string grants nothing rather than defaulting to something permissive.

---

## Architecture

```
frontend/          React 18, TypeScript, Vite, Tailwind, TanStack Query, Zustand
backend/
  app/
    api/v1/        REST endpoints; deps.py is the authorization choke point
    agents/        LangGraph pipeline, prompts, LLM provider abstraction
    database/      Connector interface + PostgreSQL/Supabase implementation
    retrieval/     Schema RAG: lexical scoring + FK relationship expansion
    security/      SQL guard, encryption, RBAC, PII, audit, trust boundary
    services/      Chat orchestration, schema sync
    models/        SQLAlchemy 2.x, multi-tenant
  evaluation/      Agent benchmark
infra/             Postgres init + seed, Prometheus, OTel, Grafana
```

Two abstractions keep the system extensible:

- **`DatabaseConnector`** — everything above it is vendor-neutral. Adding MySQL
  means one subclass and one registry entry; no changes to the agent, services,
  or API.
- **`LLMProvider`** — Anthropic, OpenAI, and the offline echo provider today.
  Every pipeline decision goes through `structured_generate`, which returns a
  validated Pydantic model, so no branch depends on parsing model prose.

### Schema retrieval

Sending an entire schema to a model is the main driver of cost and
wrong-table errors. Retrieval scores tables lexically against the question
(with the business glossary folded in), then expands along foreign keys —
"revenue by city" scores `orders` and `customers` but *needs* the join between
them, so any table reachable by an FK is pulled in even when its own score is
low. A vector backend can be added via the `Embedder` protocol; pgvector is
already in the compose image.

### Business glossary

Per-database definitions the planner treats as authoritative — `revenue =
orders.total_amount for completed orders`. Defining a handful of terms for your
schema is the cheapest available accuracy improvement. Settings → Business
glossary.

---

## Development

```bash
make help              # list every task
make dev               # dependencies only, run the apps yourself
make test              # unit + integration
make eval              # agent benchmark
make check             # everything CI runs
make migration m="..."  # create a migration
make psql-demo         # psql into the demo database
make clean             # stop and delete volumes
```

Every task runs in Docker, so the toolchain is identical everywhere.

### Tests

| Suite         | Count | What it covers |
| ------------- | ----- | -------------- |
| SQL guard     | 39    | Adversarial: stacked statements, dangerous functions, catalogs, LIMIT rewriting |
| Pipeline      | 16    | Real graph and guard: routing, bounded correction loop, cost gate, chart choice |
| Security      | 49    | Encryption, key rotation, bcrypt truncation, JWT confusion, RBAC, PII, injection |
| Integration   | 11    | Real PostgreSQL: introspection, type coercion, timeouts, both write-blocking layers |

115 tests. Integration tests need `make dev` first.

### Agent evaluation

`make eval` grades 15 cases by **execution accuracy** — did the SQL that
actually ran return the right number — not by string-matching SQL, since two
correct queries can be written many ways. Expected values are resolved from
reference queries at run time so the benchmark cannot drift from the data.

Security cases fail the build. Functional misses are reported as a quality
signal. With the echo provider functional accuracy is 0% by construction; the
report says so rather than implying the pipeline is broken.

---

## Configuration

Everything in `.env.example`. The ones that matter:

| Variable | Notes |
| -------- | ----- |
| `ENCRYPTION_KEY` | Protects stored database passwords. Rotating without re-encrypting makes existing connections unreadable. |
| `JWT_SECRET` | Must be ≥32 chars in production; startup fails otherwise. |
| `LLM_PROVIDER` | `anthropic`, `openai`, or `echo` (offline). |
| `CORS_ORIGINS` | Comma-separated or a JSON array. A wildcard is rejected in production. |
| `QUERY__MAX_ROWS` | Ceiling. A workspace or connection may tighten it, never widen it. |

Production startup validates its own configuration and refuses to boot on
debug mode, a short JWT secret, a wildcard CORS origin, or a missing API key.

---

## Observability

- **Logs** — structured JSON with a redaction processor that scrubs
  credentials, bearer tokens, and inline DSN passwords on every event.
- **Metrics** — Prometheus at `/metrics`: request duration, model latency and
  spend, guard rejections by code, query latency and timeouts, clarification
  rate. HTTP metrics are labelled by route template, not raw path, to keep
  cardinality bounded.
- **Tracing** — OpenTelemetry to the collector in the compose stack.
- **Audit** — append-only log of connections, schema syncs, executions,
  blocks, and permission changes. Forbidden keys are scrubbed before write, and
  an audit failure never rolls back the action it was recording.

---

## Known limitations

Stated plainly rather than left to be discovered:

- **MySQL and SQLite are interface-only.** `DatabaseConnector` supports them
  and the wizard lists them, but only PostgreSQL and Supabase have connectors
  registered. The wizard disables the others.
- **Schema retrieval is lexical.** The `Embedder` protocol and pgvector are in
  place, but no embedding backend is wired up, so retrieval is keyword scoring
  plus FK expansion. On a very large schema with unhelpful table names this
  will pick the wrong tables more often than a vector index would.
- **Conversation memory is a rolling summary plus recent turns.** Follow-ups
  like "only Hyderabad" work; very long conversations will lose earlier
  context.
- **The cost gate depends on `EXPLAIN`.** If `EXPLAIN` fails the query still
  runs, bounded by the statement timeout and row cap rather than by a plan
  estimate.
- **Rate limiting is a fixed window**, so it permits a burst at a window
  boundary. A sliding window would be stricter.
- **No deployment manifests.** Docker images and compose are production-shaped
  (gunicorn, non-root user, health checks, multi-stage builds), and CI builds
  and smoke-tests them, but there are no Kubernetes or Terraform manifests and
  no staging/production environments provisioned.

---

## License

MIT
