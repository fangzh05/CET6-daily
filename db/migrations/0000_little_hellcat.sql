CREATE TABLE "annotations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"passage_id" text NOT NULL,
	"paragraph_id" text NOT NULL,
	"selected_text" text NOT NULL,
	"note" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "answer_keys" (
	"question_id" text PRIMARY KEY NOT NULL,
	"correct_answer" text NOT NULL,
	"source" text NOT NULL,
	"verification_status" text NOT NULL,
	"verified_at" timestamp with time zone,
	"answer_version" text NOT NULL,
	CONSTRAINT "verified_answer_timestamp" CHECK ("answer_keys"."verification_status" <> 'verified' or "answer_keys"."verified_at" is not null)
);
--> statement-breakpoint
CREATE TABLE "attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"submitted_answer" text,
	"correct_answer" text NOT NULL,
	"is_correct" boolean NOT NULL,
	"uncertain" boolean NOT NULL,
	"response_duration" integer NOT NULL,
	"practice_type" text NOT NULL,
	"answer_version" text NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	CONSTRAINT "duration_positive" CHECK ("attempts"."response_duration" >= 0)
);
--> statement-breakpoint
CREATE TABLE "explanations" (
	"question_id" text PRIMARY KEY NOT NULL,
	"explanation" text NOT NULL,
	"keyword_relation" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"distractors" jsonb NOT NULL,
	"skill_tags" jsonb NOT NULL,
	"verification_status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository" text NOT NULL,
	"commit" text NOT NULL,
	"source_hash" text NOT NULL,
	"status" text NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "papers" (
	"id" text PRIMARY KEY NOT NULL,
	"year" integer NOT NULL,
	"month" integer NOT NULL,
	"set" integer NOT NULL,
	CONSTRAINT "paper_month" CHECK ("papers"."month" in (6,12))
);
--> statement-breakpoint
CREATE TABLE "passage_paragraphs" (
	"id" text PRIMARY KEY NOT NULL,
	"passage_id" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"text" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "passages" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"title" text NOT NULL,
	"version" text NOT NULL,
	"word_bank" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "practice_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"group_id" text NOT NULL,
	"practice_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"choices" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"cursor" integer DEFAULT 0 NOT NULL,
	"scroll" integer DEFAULT 0 NOT NULL,
	"elapsed_ms" integer DEFAULT 0 NOT NULL,
	"question_ids" jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"grading_snapshot" jsonb NOT NULL,
	"explanation_snapshot" jsonb NOT NULL,
	"submission_id" uuid,
	"score" integer,
	"total" integer,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "session_type" CHECK ("practice_sessions"."practice_type" in ('new','retry','review')),
	CONSTRAINT "session_status" CHECK ("practice_sessions"."status" in ('active','paused','submitted'))
);
--> statement-breakpoint
CREATE TABLE "question_groups" (
	"id" text PRIMARY KEY NOT NULL,
	"paper_id" text NOT NULL,
	"passage_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"content_status" text NOT NULL,
	"question_status" text NOT NULL,
	"version" text NOT NULL,
	"eligible" boolean DEFAULT false NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	CONSTRAINT "group_kind" CHECK ("question_groups"."kind" in ('careful','matching','cloze'))
);
--> statement-breakpoint
CREATE TABLE "questions" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"number" integer NOT NULL,
	"stem" text NOT NULL,
	"options" jsonb NOT NULL,
	"paragraph_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"version" text NOT NULL,
	"archived" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_states" (
	"user_id" uuid NOT NULL,
	"question_id" text NOT NULL,
	"first_wrong_at" timestamp with time zone,
	"last_reviewed_at" timestamp with time zone,
	"review_due_at" timestamp with time zone NOT NULL,
	"wrong_count" integer DEFAULT 0 NOT NULL,
	"review_count" integer DEFAULT 0 NOT NULL,
	"step" integer DEFAULT 0 NOT NULL,
	"mastery_state" text DEFAULT 'learning' NOT NULL,
	"error_category" text,
	CONSTRAINT "review_states_user_id_question_id_pk" PRIMARY KEY("user_id","question_id"),
	CONSTRAINT "review_step" CHECK ("review_states"."step" between 0 and 3)
);
--> statement-breakpoint
CREATE TABLE "source_references" (
	"group_id" text PRIMARY KEY NOT NULL,
	"repository" text NOT NULL,
	"path" text NOT NULL,
	"commit" text NOT NULL,
	"hash" text NOT NULL,
	"batch_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"daily_goal" integer DEFAULT 5 NOT NULL,
	CONSTRAINT "daily_goal_bounds" CHECK ("user_settings"."daily_goal" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"identity" text NOT NULL,
	"email" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_identity_unique" UNIQUE("identity")
);
--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "annotations" ADD CONSTRAINT "annotations_paragraph_id_passage_paragraphs_id_fk" FOREIGN KEY ("paragraph_id") REFERENCES "public"."passage_paragraphs"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "answer_keys" ADD CONSTRAINT "answer_keys_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_session_id_practice_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."practice_sessions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attempts" ADD CONSTRAINT "attempts_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "explanations" ADD CONSTRAINT "explanations_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passage_paragraphs" ADD CONSTRAINT "passage_paragraphs_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passages" ADD CONSTRAINT "passages_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "practice_sessions" ADD CONSTRAINT "practice_sessions_group_id_question_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."question_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_groups" ADD CONSTRAINT "question_groups_paper_id_papers_id_fk" FOREIGN KEY ("paper_id") REFERENCES "public"."papers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "question_groups" ADD CONSTRAINT "question_groups_passage_id_passages_id_fk" FOREIGN KEY ("passage_id") REFERENCES "public"."passages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_group_id_question_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."question_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_states" ADD CONSTRAINT "review_states_question_id_questions_id_fk" FOREIGN KEY ("question_id") REFERENCES "public"."questions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_group_id_question_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."question_groups"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_references" ADD CONSTRAINT "source_references_batch_id_import_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."import_batches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "annotation_user_passage" ON "annotations" USING btree ("user_id","passage_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_session_question" ON "attempts" USING btree ("session_id","question_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attempt_first_unique" ON "attempts" USING btree ("user_id","question_id") WHERE "attempts"."practice_type" = 'new';--> statement-breakpoint
CREATE INDEX "attempt_user_date" ON "attempts" USING btree ("user_id","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "paper_identity" ON "papers" USING btree ("year","month","set");--> statement-breakpoint
CREATE UNIQUE INDEX "paragraph_position" ON "passage_paragraphs" USING btree ("passage_id","position");--> statement-breakpoint
CREATE INDEX "session_user_status" ON "practice_sessions" USING btree ("user_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_id_unique" ON "practice_sessions" USING btree ("submission_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_user_pair" ON "practice_sessions" USING btree ("id","user_id");--> statement-breakpoint
CREATE INDEX "group_recommendation" ON "question_groups" USING btree ("eligible","archived","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "question_number" ON "questions" USING btree ("group_id","number");--> statement-breakpoint
CREATE INDEX "review_user_due" ON "review_states" USING btree ("user_id","review_due_at");