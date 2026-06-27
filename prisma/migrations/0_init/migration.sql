-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "interview_transcript" JSONB NOT NULL DEFAULT '{"messages":[],"pending":null,"done":false}',
    "venture_profile" JSONB,
    "audience_config" JSONB,
    "simulation_runs" JSONB NOT NULL DEFAULT '[]',
    "owner_dashboard" JSONB,
    "website_analysis" JSONB,
    "market_data" JSONB,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_nodes" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "project_id" TEXT,
    "parent_id" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "ref_project_id" TEXT,
    "module_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "char_count" INTEGER NOT NULL,
    "chunk_count" INTEGER NOT NULL,
    "emb_model" TEXT NOT NULL,
    "chunks" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Run" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "brief" TEXT NOT NULL,
    "clientProfile" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "parentRunId" TEXT,
    "forkPointBlockId" TEXT,
    "focusQuestion" TEXT,
    "additionalContext" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'full',
    "sourceRunId" TEXT,
    "targetMarket" TEXT,
    "targetAudienceSize" INTEGER,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Run_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "run_jobs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT,
    "project_id" TEXT,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "priority" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 1,
    "locked_by" TEXT,
    "locked_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "cancel_requested" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "payload" JSONB,
    "result" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "run_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mission" TEXT NOT NULL,
    "layer" INTEGER NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'research',
    "domain" TEXT NOT NULL DEFAULT 'market',
    "state" TEXT NOT NULL,
    "inputBlockIds" TEXT NOT NULL,
    "params" TEXT NOT NULL,
    "logs" TEXT NOT NULL,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conclusion" (
    "id" TEXT NOT NULL,
    "blockId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "entities" TEXT NOT NULL,
    "sources" TEXT NOT NULL,

    CONSTRAINT "Conclusion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Edge" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "fromBlockId" TEXT NOT NULL,
    "toBlockId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,

    CONSTRAINT "Edge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Cohort" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "locality" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "segment" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "weightPct" DOUBLE PRECISION NOT NULL,
    "size" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "stats" TEXT,
    "summary" TEXT,

    CONSTRAINT "Cohort_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Persona" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "age" INTEGER NOT NULL,
    "gender" TEXT NOT NULL,
    "occupation" TEXT NOT NULL,
    "incomeBand" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "intent" DOUBLE PRECISION NOT NULL,
    "wtp" DOUBLE PRECISION NOT NULL,
    "wtpCurrency" TEXT NOT NULL,
    "channelPref" TEXT NOT NULL,
    "platforms" TEXT NOT NULL,
    "objection" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "lifestyle" TEXT NOT NULL DEFAULT '',
    "lifeStage" TEXT NOT NULL DEFAULT '',
    "values" TEXT NOT NULL DEFAULT '[]',
    "shoppingHabits" TEXT NOT NULL DEFAULT '',
    "priceSensitivity" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "reasoning" TEXT NOT NULL DEFAULT '',
    "personality" TEXT NOT NULL DEFAULT '',
    "personalityTraits" TEXT NOT NULL DEFAULT '[]',
    "intentOriginal" DOUBLE PRECISION,
    "voteChangedAt" TIMESTAMP(3),
    "chatLog" TEXT NOT NULL DEFAULT '[]',

    CONSTRAINT "Persona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "persona_conversations" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "participant_ids" TEXT NOT NULL DEFAULT '[]',
    "persona_a_id" TEXT NOT NULL,
    "persona_b_id" TEXT NOT NULL,
    "topic" TEXT NOT NULL DEFAULT '',
    "messages" TEXT NOT NULL DEFAULT '[]',
    "conclusion" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "persona_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launch_simulations" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "project_id" TEXT,
    "name" TEXT NOT NULL DEFAULT 'Scenario',
    "inputs" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "follow_up" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "launch_simulations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "launch_outcomes" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "project_id" TEXT,
    "label" TEXT NOT NULL DEFAULT 'Outcome',
    "source" TEXT NOT NULL DEFAULT 'founder-reported',
    "horizon_label" TEXT,
    "notes" TEXT,
    "inputs" JSONB NOT NULL,
    "audience" JSONB NOT NULL,
    "actual" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "launch_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RunEvent" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "ts" BIGINT NOT NULL,

    CONSTRAINT "RunEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "industry_knowledge" (
    "id" TEXT NOT NULL,
    "industry_key" TEXT NOT NULL,
    "industry" TEXT NOT NULL,
    "pack" JSONB NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "built_model" TEXT NOT NULL DEFAULT '',
    "built_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "industry_knowledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "companies" (
    "id" TEXT NOT NULL,
    "canonical_name" TEXT NOT NULL,
    "legal_name" TEXT,
    "country" TEXT,
    "website" TEXT,
    "investor_website" TEXT,
    "cik" TEXT,
    "lei" TEXT,
    "crunchbase_uuid" TEXT,
    "crunchbase_permalink" TEXT,
    "sic" TEXT,
    "sic_description" TEXT,
    "sector" TEXT,
    "description" TEXT NOT NULL DEFAULT '',
    "story" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "founders" (
    "id" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "crunchbase_uuid" TEXT,
    "crunchbase_permalink" TEXT,
    "linkedin" TEXT,
    "website" TEXT,
    "bio" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "founders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "founder_company_roles" (
    "id" TEXT NOT NULL,
    "founder_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'founder',
    "source" TEXT NOT NULL,
    "started_on" TIMESTAMP(3),
    "ended_on" TIMESTAMP(3),
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "founder_company_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "founder_story_snapshots" (
    "id" TEXT NOT NULL,
    "founder_id" TEXT,
    "company_id" TEXT,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT NOT NULL,
    "narrative" TEXT NOT NULL DEFAULT '',
    "raw" JSONB,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "fingerprint" TEXT NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "founder_story_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "exchange_listings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "mic" TEXT,
    "ticker" TEXT NOT NULL,
    "currency" TEXT,
    "isin" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "exchange_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "company_profile_snapshots" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "as_of" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "title" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "raw" JSONB NOT NULL,
    "sources" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_profile_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "corporate_filings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "listing_id" TEXT,
    "regulator" TEXT NOT NULL,
    "form_type" TEXT NOT NULL,
    "accession_no" TEXT,
    "filing_date" TIMESTAMP(3) NOT NULL,
    "report_date" TIMESTAMP(3),
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "primary_document" TEXT,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "corporate_filings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_metrics" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "taxonomy" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "fiscal_year" INTEGER,
    "fiscal_period" TEXT,
    "form" TEXT,
    "filed_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "accession_no" TEXT,
    "frame" TEXT,
    "fingerprint" TEXT NOT NULL,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_snapshots" (
    "id" TEXT NOT NULL,
    "listing_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL,
    "currency" TEXT,
    "open" DOUBLE PRECISION,
    "high" DOUBLE PRECISION,
    "low" DOUBLE PRECISION,
    "close" DOUBLE PRECISION,
    "volume" DOUBLE PRECISION,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "price_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_items" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "published_at" TIMESTAMP(3),
    "summary" TEXT NOT NULL DEFAULT '',
    "event_type" TEXT,
    "sentiment" TEXT,
    "impact_score" DOUBLE PRECISION,
    "raw" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "source_records" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "source" TEXT NOT NULL,
    "source_type" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "retrieved_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fingerprint" TEXT NOT NULL,
    "raw_meta" JSONB,

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "workspace_nodes_scope_project_id_idx" ON "workspace_nodes"("scope", "project_id");

-- CreateIndex
CREATE INDEX "workspace_nodes_parent_id_idx" ON "workspace_nodes"("parent_id");

-- CreateIndex
CREATE INDEX "workspace_nodes_ref_project_id_idx" ON "workspace_nodes"("ref_project_id");

-- CreateIndex
CREATE INDEX "documents_project_id_idx" ON "documents"("project_id");

-- CreateIndex
CREATE INDEX "Run_projectId_idx" ON "Run"("projectId");

-- CreateIndex
CREATE INDEX "run_jobs_status_priority_created_at_idx" ON "run_jobs"("status", "priority", "created_at");

-- CreateIndex
CREATE INDEX "run_jobs_run_id_status_idx" ON "run_jobs"("run_id", "status");

-- CreateIndex
CREATE INDEX "run_jobs_project_id_status_idx" ON "run_jobs"("project_id", "status");

-- CreateIndex
CREATE INDEX "Block_runId_idx" ON "Block"("runId");

-- CreateIndex
CREATE INDEX "Conclusion_blockId_idx" ON "Conclusion"("blockId");

-- CreateIndex
CREATE INDEX "Edge_runId_idx" ON "Edge"("runId");

-- CreateIndex
CREATE INDEX "Cohort_runId_idx" ON "Cohort"("runId");

-- CreateIndex
CREATE INDEX "Persona_cohortId_idx" ON "Persona"("cohortId");

-- CreateIndex
CREATE INDEX "persona_conversations_run_id_idx" ON "persona_conversations"("run_id");

-- CreateIndex
CREATE INDEX "launch_simulations_run_id_created_at_idx" ON "launch_simulations"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "launch_outcomes_run_id_created_at_idx" ON "launch_outcomes"("run_id", "created_at");

-- CreateIndex
CREATE INDEX "RunEvent_runId_seq_idx" ON "RunEvent"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "RunEvent_runId_seq_key" ON "RunEvent"("runId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "industry_knowledge_industry_key_key" ON "industry_knowledge"("industry_key");

-- CreateIndex
CREATE UNIQUE INDEX "companies_cik_key" ON "companies"("cik");

-- CreateIndex
CREATE UNIQUE INDEX "companies_crunchbase_uuid_key" ON "companies"("crunchbase_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "companies_crunchbase_permalink_key" ON "companies"("crunchbase_permalink");

-- CreateIndex
CREATE INDEX "companies_canonical_name_idx" ON "companies"("canonical_name");

-- CreateIndex
CREATE INDEX "companies_country_idx" ON "companies"("country");

-- CreateIndex
CREATE UNIQUE INDEX "founders_crunchbase_uuid_key" ON "founders"("crunchbase_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "founders_crunchbase_permalink_key" ON "founders"("crunchbase_permalink");

-- CreateIndex
CREATE INDEX "founders_full_name_idx" ON "founders"("full_name");

-- CreateIndex
CREATE INDEX "founder_company_roles_company_id_idx" ON "founder_company_roles"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "founder_company_roles_founder_id_company_id_role_source_key" ON "founder_company_roles"("founder_id", "company_id", "role", "source");

-- CreateIndex
CREATE UNIQUE INDEX "founder_story_snapshots_fingerprint_key" ON "founder_story_snapshots"("fingerprint");

-- CreateIndex
CREATE INDEX "founder_story_snapshots_founder_id_company_id_idx" ON "founder_story_snapshots"("founder_id", "company_id");

-- CreateIndex
CREATE INDEX "exchange_listings_company_id_idx" ON "exchange_listings"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "exchange_listings_exchange_ticker_key" ON "exchange_listings"("exchange", "ticker");

-- CreateIndex
CREATE UNIQUE INDEX "company_profile_snapshots_fingerprint_key" ON "company_profile_snapshots"("fingerprint");

-- CreateIndex
CREATE INDEX "company_profile_snapshots_company_id_source_as_of_idx" ON "company_profile_snapshots"("company_id", "source", "as_of");

-- CreateIndex
CREATE INDEX "corporate_filings_company_id_filing_date_idx" ON "corporate_filings"("company_id", "filing_date");

-- CreateIndex
CREATE INDEX "corporate_filings_listing_id_idx" ON "corporate_filings"("listing_id");

-- CreateIndex
CREATE UNIQUE INDEX "corporate_filings_regulator_accession_no_key" ON "corporate_filings"("regulator", "accession_no");

-- CreateIndex
CREATE UNIQUE INDEX "financial_metrics_fingerprint_key" ON "financial_metrics"("fingerprint");

-- CreateIndex
CREATE INDEX "financial_metrics_company_id_metric_end_date_idx" ON "financial_metrics"("company_id", "metric", "end_date");

-- CreateIndex
CREATE INDEX "price_snapshots_listing_id_observed_at_idx" ON "price_snapshots"("listing_id", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "price_snapshots_listing_id_source_observed_at_key" ON "price_snapshots"("listing_id", "source", "observed_at");

-- CreateIndex
CREATE UNIQUE INDEX "news_items_url_key" ON "news_items"("url");

-- CreateIndex
CREATE INDEX "news_items_company_id_published_at_idx" ON "news_items"("company_id", "published_at");

-- CreateIndex
CREATE UNIQUE INDEX "source_records_fingerprint_key" ON "source_records"("fingerprint");

-- CreateIndex
CREATE INDEX "source_records_company_id_source_idx" ON "source_records"("company_id", "source");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Run" ADD CONSTRAINT "Run_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_jobs" ADD CONSTRAINT "run_jobs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "run_jobs" ADD CONSTRAINT "run_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conclusion" ADD CONSTRAINT "Conclusion_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "Block"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Edge" ADD CONSTRAINT "Edge_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Cohort" ADD CONSTRAINT "Cohort_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Persona" ADD CONSTRAINT "Persona_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "Cohort"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_simulations" ADD CONSTRAINT "launch_simulations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "launch_outcomes" ADD CONSTRAINT "launch_outcomes_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "Run"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RunEvent" ADD CONSTRAINT "RunEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "founder_company_roles" ADD CONSTRAINT "founder_company_roles_founder_id_fkey" FOREIGN KEY ("founder_id") REFERENCES "founders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "founder_company_roles" ADD CONSTRAINT "founder_company_roles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "founder_story_snapshots" ADD CONSTRAINT "founder_story_snapshots_founder_id_fkey" FOREIGN KEY ("founder_id") REFERENCES "founders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "founder_story_snapshots" ADD CONSTRAINT "founder_story_snapshots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "exchange_listings" ADD CONSTRAINT "exchange_listings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "company_profile_snapshots" ADD CONSTRAINT "company_profile_snapshots_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_filings" ADD CONSTRAINT "corporate_filings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "corporate_filings" ADD CONSTRAINT "corporate_filings_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "exchange_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_metrics" ADD CONSTRAINT "financial_metrics_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_snapshots" ADD CONSTRAINT "price_snapshots_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "exchange_listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

