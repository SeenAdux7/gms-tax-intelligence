CREATE TYPE "public"."affected_population" AS ENUM('expatriates', 'business_travelers', 'remote_workers', 'domestic_state_workers', 'employers', 'other');--> statement-breakpoint
CREATE TYPE "public"."assignment_status" AS ENUM('planned', 'active', 'ended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."assignment_type" AS ENUM('long_term', 'short_term', 'commuter', 'business_traveler', 'remote_worker', 'domestic_transfer');--> statement-breakpoint
CREATE TYPE "public"."compliance_status" AS ENUM('open', 'under_review', 'completed', 'overdue');--> statement-breakpoint
CREATE TYPE "public"."confidence_level" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."development_status" AS ENUM('discussion', 'proposed', 'enacted', 'official_guidance', 'effective');--> statement-breakpoint
CREATE TYPE "public"."interpretation_kind" AS ENUM('learn_summary', 'professional_summary', 'employee_effect', 'employer_effect', 'gms_effect', 'review_actions', 'uncertainty');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_kind" AS ENUM('country', 'us_state', 'supranational');--> statement-breakpoint
CREATE TYPE "public"."jurisdiction_role" AS ENUM('affected', 'home', 'host');--> statement-breakpoint
CREATE TYPE "public"."match_reason" AS ENUM('jurisdiction', 'population', 'date_range', 'topic', 'payroll_location');--> statement-breakpoint
CREATE TYPE "public"."question_kind" AS ENUM('multiple_choice', 'select_all', 'matching', 'scenario');--> statement-breakpoint
CREATE TYPE "public"."review_state" AS ENUM('pending', 'needs_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."source_feed_kind" AS ENUM('rss', 'atom', 'govuk_content_api', 'json', 'html_scrape');--> statement-breakpoint
CREATE TYPE "public"."source_tier" AS ENUM('primary_official', 'professional', 'press', 'other');--> statement-breakpoint
CREATE TYPE "public"."topic" AS ENUM('individual_income_tax', 'tax_residency', 'withholding', 'payroll', 'compensation', 'benefits', 'social_security', 'tax_treaty', 'reporting', 'immigration_tax', 'assignment_policy');--> statement-breakpoint
CREATE TYPE "public"."verification_level" AS ENUM('unverified', 'single_source', 'corroborated', 'official_confirmed');--> statement-breakpoint
CREATE TYPE "public"."vocab_category" AS ENUM('tax', 'payroll', 'assignments', 'treaties', 'residency', 'social_security', 'benefits', 'policy', 'compliance', 'other');--> statement-breakpoint
CREATE TABLE "assignment_deadlines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"assignment_id" uuid NOT NULL,
	"label" text NOT NULL,
	"due_date" date NOT NULL,
	"status" "compliance_status" DEFAULT 'open' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_ref" text NOT NULL,
	"home_jurisdiction" text NOT NULL,
	"host_jurisdiction" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"type" "assignment_type" NOT NULL,
	"status" "assignment_status" NOT NULL,
	"payroll_locations" text[] DEFAULT '{}' NOT NULL,
	"compensation_categories" text[] DEFAULT '{}' NOT NULL,
	"benefits" text[] DEFAULT '{}' NOT NULL,
	"is_synthetic" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT 'local' NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"field" text NOT NULL,
	"old_value" text,
	"new_value" text,
	"note" text,
	"corrected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "development_assignment_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_id" uuid NOT NULL,
	"assignment_id" uuid NOT NULL,
	"reasons" "match_reason"[] NOT NULL,
	"explanation" text NOT NULL,
	"review_status" "compliance_status" DEFAULT 'open' NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "development_assignment_matches_key" UNIQUE("development_id","assignment_id")
);
--> statement-breakpoint
CREATE TABLE "development_jurisdictions" (
	"development_id" uuid NOT NULL,
	"jurisdiction_code" text NOT NULL,
	"role" "jurisdiction_role" DEFAULT 'affected' NOT NULL,
	"evidence_id" uuid,
	CONSTRAINT "development_jurisdictions_key" UNIQUE("development_id","jurisdiction_code","role")
);
--> statement-breakpoint
CREATE TABLE "development_populations" (
	"development_id" uuid NOT NULL,
	"population" "affected_population" NOT NULL,
	"evidence_id" uuid,
	CONSTRAINT "development_populations_key" UNIQUE("development_id","population")
);
--> statement-breakpoint
CREATE TABLE "development_sources" (
	"development_id" uuid NOT NULL,
	"raw_document_id" uuid NOT NULL,
	"role" text DEFAULT 'primary' NOT NULL,
	"dedupe_score" numeric(4, 3),
	CONSTRAINT "development_sources_key" UNIQUE("development_id","raw_document_id")
);
--> statement-breakpoint
CREATE TABLE "development_terms" (
	"development_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	CONSTRAINT "development_terms_key" UNIQUE("development_id","term_id")
);
--> statement-breakpoint
CREATE TABLE "development_topics" (
	"development_id" uuid NOT NULL,
	"topic" "topic" NOT NULL,
	"evidence_id" uuid,
	CONSTRAINT "development_topics_key" UNIQUE("development_id","topic")
);
--> statement-breakpoint
CREATE TABLE "developments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"headline" text NOT NULL,
	"headline_evidence_id" uuid,
	"status" "development_status",
	"status_evidence_id" uuid,
	"published_at" date,
	"published_at_evidence_id" uuid,
	"effective_at" date,
	"effective_at_evidence_id" uuid,
	"action_deadline_at" date,
	"action_deadline_evidence_id" uuid,
	"primary_topic" "topic",
	"primary_topic_evidence_id" uuid,
	"verification" "verification_level" DEFAULT 'unverified' NOT NULL,
	"confidence" "confidence_level" DEFAULT 'low' NOT NULL,
	"uncertainty_note" text,
	"review_state" "review_state" DEFAULT 'pending' NOT NULL,
	"relevance_score" numeric(3, 2),
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"is_seed_data" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sample_id" uuid NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actual" jsonb NOT NULL,
	"field_scores" jsonb NOT NULL,
	"passed" boolean NOT NULL,
	"cost_usd" numeric(10, 6)
);
--> statement-breakpoint
CREATE TABLE "eval_samples" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"label" text NOT NULL,
	"raw_document_id" uuid,
	"expected_relevant" boolean NOT NULL,
	"expected" jsonb NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_spans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"raw_document_id" uuid NOT NULL,
	"quote" text NOT NULL,
	"char_start" integer,
	"char_end" integer,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interpretation_evidence" (
	"interpretation_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	CONSTRAINT "interpretation_evidence_key" UNIQUE("interpretation_id","evidence_id")
);
--> statement-breakpoint
CREATE TABLE "interpretations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_id" uuid NOT NULL,
	"kind" "interpretation_kind" NOT NULL,
	"body" text NOT NULL,
	"model" text,
	"prompt_version" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"cost_usd" numeric(10, 6),
	"is_uncertain" boolean DEFAULT false NOT NULL,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "interpretations_key" UNIQUE("development_id","kind")
);
--> statement-breakpoint
CREATE TABLE "jurisdictions" (
	"code" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" "jurisdiction_kind" NOT NULL,
	"parent_code" text,
	"enabled" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lesson_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"question_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"label" text NOT NULL,
	"is_correct" boolean DEFAULT false NOT NULL,
	"evidence_id" uuid,
	"is_insufficient_info" boolean DEFAULT false NOT NULL,
	"why_weaker" text,
	CONSTRAINT "lesson_options_key" UNIQUE("question_id","ordinal")
);
--> statement-breakpoint
CREATE TABLE "lesson_questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"stage" integer DEFAULT 2 NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" "question_kind" NOT NULL,
	"prompt" text NOT NULL,
	"explanation" text NOT NULL,
	CONSTRAINT "lesson_questions_key" UNIQUE("lesson_id","stage","ordinal")
);
--> statement-breakpoint
CREATE TABLE "lesson_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lesson_id" uuid NOT NULL,
	"stage" integer NOT NULL,
	"body" text NOT NULL,
	"is_synthetic_scenario" boolean DEFAULT false NOT NULL,
	CONSTRAINT "lesson_stages_key" UNIQUE("lesson_id","stage")
);
--> statement-breakpoint
CREATE TABLE "lessons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"development_id" uuid NOT NULL,
	"model" text,
	"prompt_version" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"validated" boolean DEFAULT false NOT NULL,
	"validation_notes" text
);
--> statement-breakpoint
CREATE TABLE "processing_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"trigger" text DEFAULT 'scheduled' NOT NULL,
	"items_seen" integer DEFAULT 0 NOT NULL,
	"items_new" integer DEFAULT 0 NOT NULL,
	"items_relevant" integer DEFAULT 0 NOT NULL,
	"items_published" integer DEFAULT 0 NOT NULL,
	"not_modified" boolean DEFAULT false NOT NULL,
	"cost_usd" numeric(10, 6),
	"error" text
);
--> statement-breakpoint
CREATE TABLE "question_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT 'local' NOT NULL,
	"question_id" uuid NOT NULL,
	"was_correct" boolean NOT NULL,
	"selected_option_ids" uuid[] DEFAULT '{}' NOT NULL,
	"attempted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" uuid NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text,
	"title" text,
	"publisher" text,
	"published_at" timestamp with time zone,
	"retrieved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"raw_text" text,
	"translated_text" text,
	"translation_model" text,
	"content_hash" text,
	"http_status" integer,
	"fetch_error" text
);
--> statement-breakpoint
CREATE TABLE "saved_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text DEFAULT 'local' NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"marked_difficult" boolean DEFAULT false NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_items_key" UNIQUE("user_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"publisher" text NOT NULL,
	"jurisdiction_code" text,
	"tier" "source_tier" NOT NULL,
	"feed_kind" "source_feed_kind" NOT NULL,
	"feed_url" text NOT NULL,
	"homepage_url" text,
	"language" text DEFAULT 'en' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_etag" text,
	"last_modified" text,
	"last_fetched_at" timestamp with time zone,
	"last_success_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"access_unrestricted" boolean DEFAULT true NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "term_review_state" (
	"user_id" text DEFAULT 'local' NOT NULL,
	"term_id" uuid NOT NULL,
	"correct_streak" integer DEFAULT 0 NOT NULL,
	"incorrect_count" integer DEFAULT 0 NOT NULL,
	"due_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "term_review_state_key" UNIQUE("user_id","term_id")
);
--> statement-breakpoint
CREATE TABLE "vocab_relations" (
	"term_id" uuid NOT NULL,
	"related_term_id" uuid NOT NULL,
	CONSTRAINT "vocab_relations_key" UNIQUE("term_id","related_term_id")
);
--> statement-breakpoint
CREATE TABLE "vocab_terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"term" text NOT NULL,
	"definition" text NOT NULL,
	"why_it_matters" text NOT NULL,
	"example" text NOT NULL,
	"common_misunderstanding" text,
	"formal_definition" text,
	"formal_definition_source_url" text,
	"category" "vocab_category" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_deadlines" ADD CONSTRAINT "assignment_deadlines_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_home_jurisdiction_jurisdictions_code_fk" FOREIGN KEY ("home_jurisdiction") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "assignments" ADD CONSTRAINT "assignments_host_jurisdiction_jurisdictions_code_fk" FOREIGN KEY ("host_jurisdiction") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_assignment_matches" ADD CONSTRAINT "development_assignment_matches_development_id_developments_id_fk" FOREIGN KEY ("development_id") REFERENCES "public"."developments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_assignment_matches" ADD CONSTRAINT "development_assignment_matches_assignment_id_assignments_id_fk" FOREIGN KEY ("assignment_id") REFERENCES "public"."assignments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_jurisdictions" ADD CONSTRAINT "development_jurisdictions_development_id_developments_id_fk" FOREIGN KEY ("development_id") REFERENCES "public"."developments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_jurisdictions" ADD CONSTRAINT "development_jurisdictions_jurisdiction_code_jurisdictions_code_fk" FOREIGN KEY ("jurisdiction_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_jurisdictions" ADD CONSTRAINT "development_jurisdictions_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_populations" ADD CONSTRAINT "development_populations_development_id_developments_id_fk" FOREIGN KEY ("development_id") REFERENCES "public"."developments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_populations" ADD CONSTRAINT "development_populations_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_sources" ADD CONSTRAINT "development_sources_development_id_developments_id_fk" FOREIGN KEY ("development_id") REFERENCES "public"."developments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_sources" ADD CONSTRAINT "development_sources_raw_document_id_raw_documents_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_terms" ADD CONSTRAINT "development_terms_development_id_developments_id_fk" FOREIGN KEY ("development_id") REFERENCES "public"."developments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_terms" ADD CONSTRAINT "development_terms_term_id_vocab_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."vocab_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_topics" ADD CONSTRAINT "development_topics_development_id_developments_id_fk" FOREIGN KEY ("development_id") REFERENCES "public"."developments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "development_topics" ADD CONSTRAINT "development_topics_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developments" ADD CONSTRAINT "developments_headline_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("headline_evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developments" ADD CONSTRAINT "developments_status_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("status_evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developments" ADD CONSTRAINT "developments_published_at_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("published_at_evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developments" ADD CONSTRAINT "developments_effective_at_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("effective_at_evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developments" ADD CONSTRAINT "developments_action_deadline_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("action_deadline_evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "developments" ADD CONSTRAINT "developments_primary_topic_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("primary_topic_evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_sample_id_eval_samples_id_fk" FOREIGN KEY ("sample_id") REFERENCES "public"."eval_samples"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_samples" ADD CONSTRAINT "eval_samples_raw_document_id_raw_documents_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_spans" ADD CONSTRAINT "evidence_spans_raw_document_id_raw_documents_id_fk" FOREIGN KEY ("raw_document_id") REFERENCES "public"."raw_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretation_evidence" ADD CONSTRAINT "interpretation_evidence_interpretation_id_interpretations_id_fk" FOREIGN KEY ("interpretation_id") REFERENCES "public"."interpretations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretation_evidence" ADD CONSTRAINT "interpretation_evidence_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interpretations" ADD CONSTRAINT "interpretations_development_id_developments_id_fk" FOREIGN KEY ("development_id") REFERENCES "public"."developments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_options" ADD CONSTRAINT "lesson_options_question_id_lesson_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."lesson_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_options" ADD CONSTRAINT "lesson_options_evidence_id_evidence_spans_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_spans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_questions" ADD CONSTRAINT "lesson_questions_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lesson_stages" ADD CONSTRAINT "lesson_stages_lesson_id_lessons_id_fk" FOREIGN KEY ("lesson_id") REFERENCES "public"."lessons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lessons" ADD CONSTRAINT "lessons_development_id_developments_id_fk" FOREIGN KEY ("development_id") REFERENCES "public"."developments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_runs" ADD CONSTRAINT "processing_runs_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_attempts" ADD CONSTRAINT "question_attempts_question_id_lesson_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."lesson_questions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw_documents" ADD CONSTRAINT "raw_documents_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_jurisdiction_code_jurisdictions_code_fk" FOREIGN KEY ("jurisdiction_code") REFERENCES "public"."jurisdictions"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "term_review_state" ADD CONSTRAINT "term_review_state_term_id_vocab_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."vocab_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocab_relations" ADD CONSTRAINT "vocab_relations_term_id_vocab_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."vocab_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocab_relations" ADD CONSTRAINT "vocab_relations_related_term_id_vocab_terms_id_fk" FOREIGN KEY ("related_term_id") REFERENCES "public"."vocab_terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "assignment_deadlines_due_idx" ON "assignment_deadlines" USING btree ("due_date");--> statement-breakpoint
CREATE UNIQUE INDEX "assignments_employee_ref_key" ON "assignments" USING btree ("employee_ref");--> statement-breakpoint
CREATE INDEX "assignments_corridor_idx" ON "assignments" USING btree ("home_jurisdiction","host_jurisdiction");--> statement-breakpoint
CREATE INDEX "corrections_entity_idx" ON "corrections" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "developments_slug_key" ON "developments" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "developments_review_idx" ON "developments" USING btree ("review_state");--> statement-breakpoint
CREATE INDEX "developments_effective_idx" ON "developments" USING btree ("effective_at");--> statement-breakpoint
CREATE INDEX "developments_status_idx" ON "developments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "eval_runs_sample_idx" ON "eval_runs" USING btree ("sample_id","ran_at");--> statement-breakpoint
CREATE UNIQUE INDEX "eval_samples_label_key" ON "eval_samples" USING btree ("label");--> statement-breakpoint
CREATE INDEX "evidence_spans_doc_idx" ON "evidence_spans" USING btree ("raw_document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lessons_development_key" ON "lessons" USING btree ("development_id");--> statement-breakpoint
CREATE INDEX "processing_runs_started_idx" ON "processing_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "question_attempts_user_idx" ON "question_attempts" USING btree ("user_id","attempted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_documents_url_key" ON "raw_documents" USING btree ("url");--> statement-breakpoint
CREATE INDEX "raw_documents_hash_idx" ON "raw_documents" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "raw_documents_source_idx" ON "raw_documents" USING btree ("source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sources_feed_url_key" ON "sources" USING btree ("feed_url");--> statement-breakpoint
CREATE INDEX "sources_enabled_idx" ON "sources" USING btree ("enabled");--> statement-breakpoint
CREATE UNIQUE INDEX "vocab_terms_slug_key" ON "vocab_terms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "vocab_terms_cat_idx" ON "vocab_terms" USING btree ("category");