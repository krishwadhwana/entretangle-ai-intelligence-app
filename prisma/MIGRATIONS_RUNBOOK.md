# Prisma migrations runbook

This project historically used `prisma db push` (see `package.json` →
`db:migrate`). `db push` keeps no migration history and resolves schema drift by
**dropping and recreating** columns when types are incompatible — which is
exactly what a JSON-string → relational conversion is. Running that against a
database with real rows can silently lose data.

We have switched to versioned migrations. `prisma/migrations/0_init/` is the
baseline captured from the current schema. Follow this runbook for every schema
change from now on.

---

## 1. One-time: baseline existing databases

The baseline migration (`0_init`) describes the schema **as it already exists**
in dev/prod. It must be marked "already applied" so Prisma never tries to run it
against a populated database.

For each environment (run against that env's `DATABASE_URL`/`DIRECT_URL`):

```bash
# Marks 0_init as applied WITHOUT executing its SQL (the tables already exist).
npx prisma migrate resolve --applied 0_init
```

Verify:

```bash
npx prisma migrate status   # should report "Database schema is up to date"
```

> A brand-new/empty database instead gets the baseline executed normally via
> `npx prisma migrate deploy`.

After baselining, stop using `prisma db push` against shared databases. Replace
the `db:migrate` script's usage in deploy with `prisma migrate deploy`.

---

## 2. Day-to-day: making a schema change

```bash
# 1. Edit prisma/schema.prisma
# 2. Generate + apply a migration locally (creates prisma/migrations/<ts>_<name>/)
npx prisma migrate dev --name add_something

# 3. Commit the generated migration folder alongside the schema change
# 4. Deploy applies pending migrations non-destructively:
npx prisma migrate deploy
```

Never hand-edit an already-applied migration. To change course, add a new one.

---

## 3. Converting a JSON-string column to relational/typed (the #3 work)

Do NOT change a column's type in a single migration on a populated table — that
is the data-loss path. Use **expand → backfill → dual-read → contract**, each a
separate migration that deploys independently:

Take `Conclusion.entities` (currently `String` holding a JSON array) → a real
`String[]` (or a child `ConclusionEntity` table) as the worked example.

### Stage 1 — Expand (additive, safe)
Add the new column/table **alongside** the old one. Nothing reads it yet.

```prisma
model Conclusion {
  entities    String   // legacy JSON string — keep
  entitiesArr String[] @default([])  // new typed column
}
```

`prisma migrate dev --name expand_conclusion_entities`. Deploy. No reads/writes
of the new column in app code yet → zero risk.

### Stage 2 — Backfill (idempotent script, batched)
Populate the new column from the old one. Run as a one-off script (a `RunJob`
type or `tsx scripts/...`), batched and resumable:

```ts
// for each Conclusion in pages of N:
//   const arr = safeJsonArray(row.entities)   // tolerate bad/empty JSON
//   update { where:{id}, data:{ entitiesArr: arr } }
```

Backfill is re-runnable; never let it throw the whole batch on one bad row.

### Stage 3 — Dual-write + read-new
Update app code to **write both** columns and **read the new** one. Ship it.
Watch logs/metrics. The old column is now a live fallback you can roll back to.

### Stage 4 — Contract (drop the old column)
Only after the new path has been healthy in prod for a while, and a backfill
verification query confirms parity:

```prisma
model Conclusion {
  entitiesArr String[] @default([])   // now the source of truth (rename later)
  // entities removed
}
```

`prisma migrate dev --name contract_conclusion_entities`. Deploy.

### Candidate fields, in priority order (search/filter/analytics value first)
- `Conclusion.entities`, `Conclusion.sources`  → `String[]`
- `Block.inputBlockIds`                          → `String[]`
- `Persona.platforms`, `Persona.values`, `Persona.personalityTraits` → `String[]`
- `Block.params`, `Cohort.stats`                → typed `Json` (Zod-validated)

Lower-value blobs (`Block.logs`, chat transcripts) can stay JSON.

---

## 4. Guardrails
- Every migration is committed with the schema change that produced it.
- Deploys run `prisma migrate deploy` (never `db push`).
- No type change on a populated column outside the expand/backfill/contract flow.
- Back up (or snapshot) prod before a contract-stage migration.
