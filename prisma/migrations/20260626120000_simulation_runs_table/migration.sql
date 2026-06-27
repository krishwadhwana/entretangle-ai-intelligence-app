-- Expand stage (see prisma/MIGRATIONS_RUNBOOK.md §3): add the child table that
-- Project.simulationRuns (append-only JSONB) is being moved into. Purely
-- additive — no existing column is touched, so this is safe to deploy while the
-- JSONB array remains the read source of truth.

-- CreateTable
CREATE TABLE "project_simulation_runs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "record" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_simulation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_simulation_runs_run_id_key" ON "project_simulation_runs"("run_id");

-- CreateIndex
CREATE INDEX "project_simulation_runs_project_id_timestamp_idx" ON "project_simulation_runs"("project_id", "timestamp");

-- AddForeignKey
ALTER TABLE "project_simulation_runs" ADD CONSTRAINT "project_simulation_runs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
