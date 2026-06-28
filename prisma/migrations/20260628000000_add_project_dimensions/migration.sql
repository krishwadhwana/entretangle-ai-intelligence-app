-- Progression tracker (see prisma/MIGRATIONS_RUNBOOK.md): two new tables that
-- record how solid each part of a venture is, scored over time. Purely
-- additive — no existing column is touched, so this is safe to deploy live.

-- CreateTable
CREATE TABLE "project_dimensions" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "parent_id" TEXT,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "group" TEXT NOT NULL DEFAULT 'venture',
    "kind" TEXT NOT NULL DEFAULT 'score',
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "is_scenario" BOOLEAN NOT NULL DEFAULT false,
    "score" INTEGER,
    "score_max" INTEGER NOT NULL DEFAULT 100,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "notes" TEXT,
    "eta" TIMESTAMP(3),
    "money_spent" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_dimension_events" (
    "id" TEXT NOT NULL,
    "dimension_id" TEXT NOT NULL,
    "score" INTEGER,
    "score_max" INTEGER,
    "status" TEXT,
    "note" TEXT,
    "money_spent" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_dimension_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_dimensions_project_id_key_key" ON "project_dimensions"("project_id", "key");

-- CreateIndex
CREATE INDEX "project_dimensions_project_id_sort_order_idx" ON "project_dimensions"("project_id", "sort_order");

-- CreateIndex
CREATE INDEX "project_dimensions_parent_id_idx" ON "project_dimensions"("parent_id");

-- CreateIndex
CREATE INDEX "project_dimension_events_dimension_id_created_at_idx" ON "project_dimension_events"("dimension_id", "created_at");

-- AddForeignKey
ALTER TABLE "project_dimensions" ADD CONSTRAINT "project_dimensions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_dimensions" ADD CONSTRAINT "project_dimensions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "project_dimensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_dimension_events" ADD CONSTRAINT "project_dimension_events_dimension_id_fkey" FOREIGN KEY ("dimension_id") REFERENCES "project_dimensions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
