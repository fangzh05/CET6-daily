ALTER TABLE annotations ADD COLUMN target_id text;
--> statement-breakpoint
ALTER TABLE annotations ALTER COLUMN paragraph_id DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE annotations ADD CONSTRAINT annotation_target CHECK ((paragraph_id IS NOT NULL) <> (target_id IS NOT NULL));
