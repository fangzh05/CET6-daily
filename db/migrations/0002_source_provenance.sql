ALTER TABLE "papers" DROP CONSTRAINT "paper_month";--> statement-breakpoint
ALTER TABLE "source_references" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "papers" ADD CONSTRAINT "paper_month" CHECK ("papers"."month" in (6,7,9,12));