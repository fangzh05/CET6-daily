import type { z } from 'zod';
import type { reviewSchema } from '../../scripts/reading-fixture';
export type ReadingQuestionReview=z.infer<typeof reviewSchema> & {analysis?:unknown};
