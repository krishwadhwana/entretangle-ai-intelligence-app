-- Manufacturer sourcing table (see prisma/MIGRATIONS_RUNBOOK.md). Purely
-- additive — one new table, no existing column touched, safe to deploy live.

-- CreateTable
CREATE TABLE "manufacturers" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "products" TEXT,
    "region" TEXT,
    "country" TEXT,
    "website" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_url" TEXT,
    "contact_name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "moq" INTEGER,
    "moq_unit" TEXT NOT NULL DEFAULT 'units',
    "sample_price" DOUBLE PRECISION,
    "unit_price" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lead_time_days" INTEGER,
    "payment_terms" TEXT,
    "status" TEXT NOT NULL DEFAULT 'lead',
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "rating" INTEGER,
    "notes" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "manufacturers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "manufacturers_project_id_status_idx" ON "manufacturers"("project_id", "status");

-- CreateIndex
CREATE INDEX "manufacturers_project_id_sort_order_idx" ON "manufacturers"("project_id", "sort_order");

-- AddForeignKey
ALTER TABLE "manufacturers" ADD CONSTRAINT "manufacturers_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
