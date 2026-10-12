ALTER TABLE user_settings ADD COLUMN selected_exam text NOT NULL DEFAULT 'CET6', ADD CONSTRAINT selected_exam_shape CHECK (selected_exam IN ('CET6','KY1','JLPT_N1'));
