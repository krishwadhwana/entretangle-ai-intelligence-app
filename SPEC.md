# Agent Canvas — Build Spec v1

A canvas dashboard where an entrepreneur types one brief, agent teams spawn as visible blocks, work independently, entangle with each other through typed conclusions, and converge into a queryable, forkable "business world model."

This spec is written for shot-by-shot execution in Claude Code. Build one shot at a time, verify acceptance criteria, then proceed. Do not build ahead of the current shot.

---

## 0. Product invariants (never violate these)

1. **Only the orchestrator spawns blocks and draws edges.** Blocks never communicate with each other directly. All inter-block influence flows through typed conclusions read by the orchestrator.
2. **Conclusions are typed objects, never prose.** Every block's output conforms to the `Conclusion` schema. Prose findings are logs (ephemeral UX), conclusions are data (the API).
3. **Concluded blocks are immutable.** Editing a parameter on a concluded block creates a fork (copy-on-write), never a mutation.
4. **Every event is persisted and replayable.** The canvas state is a pure function of the event log. Refreshing the page mid-run must reconstruct the exact canvas.
5. **Hard resource caps on every run.** Max blocks, max layers, max tokens. The orchestrator must be unable to runaway-spawn.
6. **The canvas is the report.** There is no separate document output. The terminal node is queryable and answers cite the nodes that produced them.

---

## 1. Stack

| Concern | Choice | Notes |
|---|---|---|
| Framework | Next.js 14+ (App Router), TypeScript strict | |
| Canvas | `@xyflow/react` (React Flow v12) | Do not hand-roll the node editor |
| DB | SQLite via Prisma for v0 | Schema written so a swap to Postgres is a connection-string change |
| LLM | `@anthropic-ai/sdk` | Model: `claude-sonnet-4-6` for blocks, same for orchestrator calls in v0 |
| Validation | Zod | Every LLM JSON output is parsed through a Zod schema; on failure, one retry with the error appended, then mark block `failed` |
| Streaming | SSE via App Router `ReadableStream` | No websockets in v0 |
| Styling | Tailwind | Light theme, flat, minimal — no gradients/shadows |

Env vars (`.env.example`):

```
ANTHROPIC_API_KEY=
MOCK_MODE=true            # true = no API calls, scripted run (see §8)
MAX_BLOCKS_PER_RUN=8
MAX_LAYERS=3
MAX_TOKENS_PER_RUN=150000
BLOCK_TIMEOUT_MS=90000
```

---

## 2. Domain model

All types live in `lib/schema.ts` as Zod schemas with inferred TS types.

```ts
// The atomic unit of inter-agent communication
Conclusion = {
  id: string,            // cuid
  blockId: string,
  claim: string,         // human-readable, <= 120 chars, e.g. "Best entry channel"
  value: string,         // the finding, e.g. "quickcommerce first, D2C site from month 4"
  confidence: number,    // 0–1, the block's own estimate
  entities: string[],    // normalized lowercase entity tags, e.g. ["blinkit","quickcommerce","mumbai"]
                         // THIS FIELD DRIVES ENTANGLEMENT — required, min 1
  sources: string[],     // v0: model-knowledge marker "llm:claude-sonnet-4-6"; later: URLs
}

BlockState = "spawning" | "working" | "concluded" | "failed"

Block = {
  id: string,
  runId: string,
  name: string,          // e.g. "Product research"
  mission: string,       // 1–3 sentence instruction the orchestrator wrote for this block
  layer: number,         // 1 = from brief, 2 = synthesis, 3 = terminal-adjacent
  state: BlockState,
  inputBlockIds: string[],   // empty for layer 1
  params: Record<string, number | string>,  // tweakable knobs, e.g. { budgetLakh: 20, riskTolerance: 0.5 }
  logs: string[],
  conclusions: Conclusion[],
}

EdgeKind = "entangle" | "feeds"
Edge = { id, runId, fromBlockId, toBlockId, kind: EdgeKind, reason: string }
// "entangle" = orchestrator detected a relationship between two concluded blocks (dashed, bidirectional rendering)
// "feeds"    = a block's conclusions are inputs to another block (solid, directional)

RunStatus = "interviewing" | "planning" | "running" | "complete" | "failed" | "capped"
Run = {
  id: string,
  brief: string,                 // the user's raw entry
  clientProfile: ClientProfile,  // from the intake interview, §4.1
  status: RunStatus,
  parentRunId: string | null,    // set on forks
  forkPointBlockId: string | null,
  tokensUsed: number,
  createdAt: Date,
}

ClientProfile = {
  ambitions: string,
  product: string,
  capitalInr: number | null,
  experience: string,
  scale: string,
  restrictions: string[],   // e.g. ["no USP yet", "budget 20 lakh INR"]
  goal: string,             // e.g. "Blinkit pan-india, amazon pan-india, offline at peak"
}
```

### SSE event protocol (`RunEvent`, discriminated union on `type`)

Every event has `{ runId, seq: number, ts: number }`. `seq` is a monotonic integer per run — the client uses it for replay/dedupe.

```
run_status        { status: RunStatus, phaseLabel: string }
block_spawned     { block: Block }                  // state = "spawning"
block_working     { blockId }
block_log         { blockId, line: string }
block_concluded   { blockId, conclusions: Conclusion[] }
block_failed      { blockId, error: string }
edge_added        { edge: Edge }
world_model_ready { conclusionCount: number, blockCount: number }
run_error         { message: string }
```

---

## 3. Database schema (Prisma)

Tables: `Run`, `Block`, `Conclusion`, `Edge`, `RunEvent`.

- `RunEvent`: `{ id, runId, seq, type, payload Json, ts }` with unique `(runId, seq)`. This is the source of truth for canvas replay.
- `Block.logs` as Json string[]. `Block.params` as Json.
- Indexes: `RunEvent(runId, seq)`, `Block(runId)`, `Conclusion(blockId)`.
- Use SQLite file `./dev.db`. No migrations gymnastics in v0 — `prisma db push` is fine.

---

## 4. Orchestrator (`lib/orchestrator.ts`)

The orchestrator is a single async function `executeRun(runId)` launched fire-and-forget after run creation. It is a deterministic state machine; LLM calls fill in content, never control flow structure.

### 4.1 Phase 0 — Intake (interview)

v0 keeps this minimal: the run-creation form has structured fields (brief + capital + experience + goal + restrictions). No conversational interview yet (that's Shot 8). The form output is the `ClientProfile`.

### 4.2 Phase 1 — Plan

One LLM call (`PLANNER`) → returns 2–4 layer-1 teams `{ name, mission, params }`. Validate with Zod; clamp to `MAX_BLOCKS_PER_RUN`. Emit `block_spawned` for each, then execute all layer-1 blocks **in parallel** (`Promise.allSettled`).

### 4.3 Phase 2 — Block execution (`lib/blocks.ts → executeBlock`)

Per block:
1. Emit `block_working`.
2. One LLM call (`BLOCK_EXECUTOR`) returning `{ logs: string[] (4–8 short lines), conclusions: Conclusion[] (2–5) }`.
3. Emit each log line with a 400–700ms artificial delay between emissions (UX pacing; the call itself is single-shot in v0 — true token streaming is Shot 7).
4. Emit `block_concluded`. Persist conclusions.
5. On timeout (`BLOCK_TIMEOUT_MS`) or double Zod failure → `block_failed`. A failed block is excluded from entanglement; the run continues if ≥1 sibling concluded, else run fails.

### 4.4 Phase 3 — Entangle

When all layer-1 blocks settle, one LLM call (`ENTANGLER`) receives **only the conclusions** (not logs) of all concluded blocks and returns:

```ts
{
  edges: { fromBlockId, toBlockId, reason, trigger: "shared_entity" | "contradiction" | "dependency" }[],
  synthesisBlocks: { name, mission, inputBlockIds: string[] }[]   // 0–2 blocks
}
```

Before accepting an edge, the orchestrator **verifies the trigger mechanically**:
- `shared_entity`: the two blocks' conclusions must share ≥1 entity tag. If not, drop the edge.
- `contradiction` / `dependency`: accepted on the entangler's word in v0, logged with reason.

Emit `edge_added` (kind `entangle`) for verified edges. Spawn synthesis blocks at layer 2 with `feeds` edges from each input block. Execute them with `BLOCK_EXECUTOR`, whose prompt now includes the input blocks' conclusions as context.

Layer 2 conclusions may trigger one more entangle round producing layer-3 blocks, but **only if** total blocks < cap and current layer < `MAX_LAYERS`. Otherwise skip to converge.

### 4.5 Phase 4 — Converge

No LLM call. The world model is the assembled object: all conclusions, all edges, the client profile, token spend. Persist, emit `world_model_ready`, set run `complete`.

### 4.6 Caps

Track `tokensUsed` from every API response's usage block. If a call would exceed `MAX_TOKENS_PER_RUN`, stop spawning, converge with whatever has concluded, set status `capped`, and surface that on the terminal node. Never silently truncate.

---

## 5. LLM prompts (`lib/prompts.ts`)

All calls use: temperature 0.7 for executor, 0.2 for planner/entangler/query. All demand **JSON only, no markdown fences** and are parsed with Zod. Include the JSON schema literally in each prompt.

### PLANNER (system)

```
You are the orchestrator of a business-research agent platform. Given an
entrepreneur's profile, define 2–4 specialist research teams whose combined
output would let a strategist plan this launch.

Rules:
- Each team gets a name (2–3 words) and a mission (1–3 sentences, specific
  to THIS client, naming concrete questions to answer).
- Teams must not overlap in scope.
- Always include one product/competition team and one market/demand team.
- Output JSON only: {"teams":[{"name":"...","mission":"...","params":{}}]}
```

User message: the serialized `ClientProfile`.

### BLOCK_EXECUTOR (system)

```
You are the "{name}" team inside a business-research platform.
Mission: {mission}
Client profile: {clientProfile}
{if inputs: "Upstream conclusions you must build on:\n{inputConclusions}"}

Produce:
1. "logs": 4–8 short lines (max 60 chars) describing what you are
   investigating, written as live status updates.
2. "conclusions": 2–5 findings. Each must be specific, decision-ready, and
   honest about confidence. Schema:
   {"claim": "<=120 chars", "value": "the finding", "confidence": 0-1,
    "entities": ["lowercase","tags"], "sources": ["llm:knowledge"]}
- entities: 2–6 tags naming the channels, places, products, segments the
  conclusion is about. These are used to connect your work to other teams,
  so tag consistently (e.g. always "quickcommerce", not "q-commerce").
- If you do not know a number, give a range and lower the confidence.
  Never invent precise figures.
Output JSON only: {"logs":[...],"conclusions":[...]}
```

### ENTANGLER (system)

```
You are the orchestrator reviewing concluded research teams. Input: each
team's id, name, and conclusions.

1. Find relationships between teams. Allowed triggers ONLY:
   - shared_entity: both teams concluded something about the same entity
   - contradiction: their conclusions conflict
   - dependency: one team's conclusion needs another's number/finding
2. Decide 0–2 synthesis teams that should be spawned to combine specific
   teams' outputs into a higher-order answer (e.g. product-market fit,
   go-to-market plan). Each names its inputBlockIds and gets a mission
   referencing the specific conclusions to reconcile.

Do not invent teams unrelated to the existing conclusions.
Output JSON only:
{"edges":[{"fromBlockId":"...","toBlockId":"...","trigger":"shared_entity",
"reason":"<=100 chars"}],
"synthesisBlocks":[{"name":"...","mission":"...","inputBlockIds":[...]}]}
```

### QUERY (Shot 5, system)

```
You answer questions about a completed research run. You are given the full
world model: client profile and every conclusion with its blockId.
Answer concisely. After the answer, list "citedConclusionIds": the ids of
the conclusions your answer relied on. If the world model cannot answer,
say so and suggest which new team could.
Output JSON only: {"answer":"...","citedConclusionIds":[...]}
```

---

## 6. API contracts (App Router route handlers)

```
POST /api/runs
  body: { brief, clientProfile }
  → 201 { runId }
  Side effect: creates run, launches executeRun(runId) without awaiting.

GET /api/runs/:id/events            (SSE)
  → replays all persisted RunEvents in seq order, then live-subscribes.
  Heartbeat comment every 15s. Client reconnect with Last-Event-ID → resume from seq.

GET /api/runs/:id
  → full snapshot { run, blocks, edges } (fallback/refresh path)

POST /api/runs/:id/query            (Shot 5)
  body: { question } → { answer, citedConclusionIds }

POST /api/runs/:id/fork             (Shot 6)
  body: { blockId, params }         // new params for that block
  → 201 { runId: newRunId }
```

Live subscription: in-process `EventEmitter` keyed by runId (`lib/bus.ts`). Acceptable for v0 single-instance; note in code that multi-instance needs Redis pub/sub.

---

## 7. Frontend

### Pages
- `/` — entry form: one large brief textarea + the four profile fields (capital ₹, experience, goal, restrictions). Submit → `POST /api/runs` → redirect `/runs/:id`.
- `/runs/:id` — the canvas.

### Canvas (`/runs/:id`)
- `useRunEvents(runId)` hook: opens EventSource, reduces events into `{ blocks, edges, status, phaseLabel }`. The reducer must be pure and idempotent on `seq` (replay-safe).
- Map to React Flow nodes/edges. **Layout is computed, not force-directed**: layer = row (y = layer * 280), index within layer = column, centered. Terminal node pinned bottom-center.
- Custom node `AgentBlockNode`:
  - Header: icon (lucide), name, state indicator (amber pulse = working, green check = concluded, red = failed).
  - Body: last 3 log lines, fading in.
  - Footer: conclusion chips — pill per conclusion showing `claim: value` truncated, full content + confidence + entities in a popover on click.
  - Concluded blocks show a small params strip (sliders disabled until Shot 6, where changing one triggers fork).
- Edge styles: `entangle` = dashed, animated, with `reason` as edge label; `feeds` = solid.
- `WorldModelNode` (terminal): dark card, conclusion/block counts, status badge if `capped`, query input (Shot 5), fork history breadcrumb (Shot 6).
- Top bar: the brief, phase label, token spend counter, replay button (re-reduces persisted events with original delays — pure client-side).

### Visual rules
Flat white cards, 1px borders, 8–12px radius, no shadows/gradients. Working = subtle amber left border; concluded = default; failed = red left border. Single accent color (indigo) reserved for synthesis blocks and the terminal node.

---

## 8. Mock mode

`MOCK_MODE=true` replaces the three LLM call sites with canned fixtures (`lib/fixtures/protein-bars.ts`) reproducing the Krish protein-bar scenario: 2 layer-1 teams → 1 entangle edge + 1 synthesis team → 2 layer-2 teams → converge. Fixtures must pass the same Zod schemas as real output. All delays, events, persistence and UI paths identical to real mode. This is the harness for Shots 1, 4, 5, 6 without burning tokens.

---

## 9. Shot plan

Execute strictly in order. Each shot ends with `npm run build` passing and the acceptance criteria demonstrable in the browser.

**Shot 1 — Skeleton + event spine (mock).**
Scaffold Next.js + Prisma + schemas + bus + SSE route + orchestrator running fully from fixtures. Bare canvas: default React Flow nodes only.
✅ Submitting the form plays the entire mock run live on the canvas; hard-refreshing mid-run reconstructs identical state from the event log.

**Shot 2 — Canvas polish.**
Custom `AgentBlockNode`, `WorldModelNode`, edge styles, layered layout, top bar, log pacing, chip popovers.
✅ Mock run is visually legible end-to-end; conclusion popover shows confidence + entities; statuses render per spec.

**Shot 3 — Real planner + executor.**
Wire PLANNER and BLOCK_EXECUTOR with Zod parse + single retry + timeout + token accounting.
✅ With `MOCK_MODE=false` and a real key, a novel brief (not protein bars) produces 2–4 sensible teams with real conclusions; a forced Zod failure path marks the block failed without killing the run.

**Shot 4 — Entanglement + synthesis.**
ENTANGLER call, mechanical shared-entity verification, synthesis spawning with `feeds` edges, layer/cap enforcement.
✅ A run produces ≥1 verified entangle edge with a visible reason and a synthesis block that references upstream conclusions in its own output; an entangler hallucinated edge (no shared entity) is provably dropped (log line).

**Shot 5 — Queryable world model.**
QUERY endpoint + query bar on terminal node; cited conclusions' blocks highlight on the canvas when an answer arrives.
✅ Asking "why that channel first?" returns an answer and visually highlights the path of blocks that produced it.

**Shot 6 — Forking (copy-on-write).**
Fork endpoint: clone run, copy all blocks **upstream of and sibling to** the fork point as already-concluded (replay their events instantly), re-execute only the forked block and everything downstream of it. Params sliders on concluded blocks become live; changing one prompts "Fork run from here?". Fork breadcrumb on terminal node links between branches.
✅ Forking a layer-1 block re-runs only that block + downstream; upstream conclusions are byte-identical across branches; both runs remain independently queryable.

**Shot 7 — True streaming.**
Switch executor to the streaming API; log lines stream as generated instead of replayed with fake delays.
✅ Logs appear during generation; total wall time per block drops accordingly.

**Shot 8 — Conversational intake.**
Replace the form with a short chat interview (max 5 questions) that emits a `ClientProfile`, mirroring Layer 0 of the concept deck.
✅ Interview produces a valid profile and hands off to the same `POST /api/runs` path.

---

## 10. Guardrails & failure policy

- Never exceed `MAX_BLOCKS_PER_RUN`, `MAX_LAYERS`, `MAX_TOKENS_PER_RUN`. On breach → graceful `capped` convergence.
- Every LLM JSON parse: 1 retry with the Zod error message appended; then fail the unit, not the run.
- Per-block timeout via `Promise.race`.
- `tokensUsed` shown live in the top bar — this product will later need per-user spend metering identical to the Journal Club pattern; keep accounting in one place (`lib/usage.ts`).
- The executor prompt's anti-fabrication clause (ranges + lowered confidence instead of fake precision) is load-bearing. Do not remove it. Real grounding (web search tools per block) is deliberately out of scope for v1 and is the first post-v1 milestone.

## 11. Non-goals for v1

Auth/multi-user, payments, deployment, web-search grounding, synthetic-audience panels at scale, PDF export (never — the canvas is the report), websockets, Postgres, mobile layout.
