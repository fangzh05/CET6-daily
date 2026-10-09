import { z } from 'zod';
export const kindSchema = z.enum(['careful', 'matching', 'cloze']);
export const practiceTypeSchema = z.enum(['new', 'retry', 'review']);
export const errorCategorySchema = z.enum(['vocabulary', 'sentence', 'locating', 'inference', 'distractor', 'time']);
export const verificationSchema = z.enum(['pending', 'verified', 'rejected']);
const id = z.string().min(1).max(200);
export const paragraphSchema = z.object({ id, label: z.string().min(1), text: z.string().min(1), position: z.number().int().nonnegative() }).strict();
export const optionSchema = z.object({ key: z.string().min(1).max(4), text: z.string().min(1) }).strict();
export const questionSchema = z.object({ id, number: z.number().int().positive(), stem: z.string().min(1), options: z.array(optionSchema).min(1), paragraph_ids: z.array(id).default([]) }).strict();
export const answerSchema = z.object({ question_id: id, correct_answer: z.string().min(1), source: z.string().min(1), verification_status: verificationSchema, verified_at: z.iso.datetime({ offset: true }).nullable(), answer_version: z.string().min(1), notes: z.string().optional() }).strict().superRefine((a, ctx) => {
  if (a.verification_status === 'verified' && !a.verified_at) ctx.addIssue({ code: 'custom', message: 'verified answer requires verified_at' });
});
export const explanationSchema = z.object({
  question_id: id, explanation: z.string().min(1), keyword_relation: z.string().min(1),
  evidence: z.array(z.object({ paragraph_id: id, text: z.string().min(1) }).strict()).min(1),
  distractor_explanations: z.record(z.string(), z.string().min(1)), skill_tags: z.array(z.string()).min(1),
  verification_status: verificationSchema
}).strict();
export const groupSchema = z.object({
  id, paper: z.object({ id, year: z.number().int().min(2000).max(2100), month: z.union([z.literal(6),z.literal(7),z.literal(9),z.literal(12)]), set: z.number().int().positive() }).strict(),
  kind: kindSchema, title: z.string().min(1), passage: z.object({ id, paragraphs: z.array(paragraphSchema).min(1), word_bank: z.array(optionSchema).default([]) }).strict(),
  questions: z.array(questionSchema).min(1), content_status: z.enum(['complete', 'incomplete']), question_status: z.enum(['complete', 'incomplete']),
  release_status: z.enum(['released','pending']).default('pending'),
  version: z.string().min(1), source: z.object({ repository: z.string().min(1), path: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40}$/), hash: z.string().regex(/^[0-9a-f]{64}$/), raw_repository:z.string().optional(),raw_path:z.string().optional(),raw_hash:z.string().optional(),markdown_path:z.string().optional(),explanation_sources:z.array(z.object({url:z.url(),sha256:z.string().regex(/^[0-9a-f]{64}$/),method:z.literal('html_rp_ana_exact_evidence_v1')}).strict()).optional(),supplemental_sources:z.array(z.object({url:z.url(),sha256:z.string().regex(/^[0-9a-f]{64}$/),method:z.string(),verification_status:z.literal('needs_review'),shared_from_paper_id:z.string().optional()}).strict()).optional() }).strict(),
  answers: z.array(answerSchema).default([]), explanations: z.array(explanationSchema).default([])
}).strict().superRefine((g, ctx) => {
  const fail = (message: string) => ctx.addIssue({ code: 'custom', message });
  const unique = (items: string[], name: string) => { if (new Set(items).size !== items.length) fail(`duplicate ${name}`); };
  unique(g.questions.map(q => q.id), 'question IDs'); unique(g.questions.map(q => String(q.number)), 'question numbers');
  unique(g.passage.paragraphs.map(p => p.id), 'paragraph IDs'); unique(g.passage.paragraphs.map(p => p.label), 'paragraph labels');
  unique(g.passage.paragraphs.map(p => String(p.position)), 'paragraph positions'); unique(g.answers.map(a => a.question_id), 'answer IDs');
  unique(g.explanations.map(e => e.question_id), 'explanation IDs'); unique(g.passage.word_bank.map(w => w.key), 'word bank keys');
  for (const q of g.questions) {
    unique(q.options.map(o => o.key), `option keys for ${q.id}`);
    if (g.kind === 'careful' && q.options.map(o => o.key).sort().join('') !== 'ABCD') fail(`${q.id}: careful reading requires A/B/C/D`);
    if (q.paragraph_ids.some(p => !g.passage.paragraphs.some(row => row.id === p))) fail(`${q.id}: unknown paragraph`);
    if (g.kind === 'matching' && q.options.some(o => !g.passage.paragraphs.some(p => p.label === o.key))) fail(`${q.id}: unknown matching label`);
    if (g.kind === 'cloze' && q.options.some(o => !g.passage.word_bank.some(w => w.key === o.key && w.text === o.text))) fail(`${q.id}: option is not in word bank`);
  }
  if (g.content_status === 'complete' && g.question_status === 'complete') {
    if (g.questions.length !== (g.kind === 'careful' ? 5 : 10)) fail('complete groups require 5 careful or 10 matching/cloze questions');
    if (g.kind === 'cloze') for (const q of g.questions) {
      const count = g.passage.paragraphs.reduce((sum, p) => sum + p.text.split(`{{${q.number}}}`).length - 1, 0);
      if (count !== 1) fail(`${q.id}: cloze must have exactly one {{${q.number}}} blank`);
    }
  }
  for (const a of g.answers) {
    const q = g.questions.find(q => q.id === a.question_id);
    if (!q || !q.options.some(o => o.key === a.correct_answer)) fail(`${a.question_id}: answer does not match question/options`);
  }
  if (g.kind === 'cloze') unique(g.answers.filter(a => a.verification_status === 'verified').map(a => a.correct_answer), 'cloze correct words');
  for (const e of g.explanations) {
    const q = g.questions.find(q => q.id === e.question_id);
    if (!q) fail(`${e.question_id}: unknown explanation question`);
    if (e.verification_status !== 'verified') continue;
    const a = g.answers.find(a => a.question_id === e.question_id && a.verification_status === 'verified');
    if (!a) fail(`${e.question_id}: verified explanation requires verified answer`);
    for (const ev of e.evidence) if (!g.passage.paragraphs.some(p => p.id === ev.paragraph_id && p.text.includes(ev.text))) fail(`${e.question_id}: evidence is not an exact passage substring`);
    for (const key of Object.keys(e.distractor_explanations)) if (!q?.options.some(o=>o.key===key) || key===a?.correct_answer) fail(`${e.question_id}: invalid distractor ${key}`);
    if(g.kind==='careful') for (const o of q?.options ?? []) if (o.key !== a?.correct_answer && !e.distractor_explanations[o.key]) fail(`${e.question_id}: missing distractor ${o.key}`);
  }
});
export type BankGroup = z.infer<typeof groupSchema>;
export type PublicGroup = Pick<BankGroup, 'id' | 'kind' | 'title' | 'paper' | 'passage' | 'questions' | 'version' | 'source'>;
export type Choice = { answer: string | null; uncertain: boolean; duration_ms: number };
export const choiceSchema = z.object({ answer: z.string().min(1).max(4).nullable(), uncertain: z.boolean(), duration_ms: z.number().int().min(0).max(86400000) }).strict();
export const draftSchema = z.object({ revision: z.number().int().nonnegative(), choices: z.record(z.string(), choiceSchema), cursor: z.number().int().nonnegative(), scroll: z.number().nonnegative(), elapsed_ms: z.number().int().min(0).max(86400000), paused: z.boolean().default(false) }).strict();
export const submitSchema = z.object({ submission_id: z.uuid(), revision: z.number().int().nonnegative() }).strict();
export const startSchema = z.object({ group_id: id, practice_type: practiceTypeSchema, question_ids: z.array(id).min(1).optional() }).strict();
export const annotationSchema = z.object({ passage_id: id, paragraph_id: id, selected_text: z.string().min(1).max(10000), note: z.string().max(5000), kind: z.enum(['note', 'sentence']) }).strict();
export type Session = {
  id: string; group_id: string; practice_type: z.infer<typeof practiceTypeSchema>; revision: number;
  status: 'active' | 'paused' | 'submitted'; choices: Record<string, Choice>; cursor: number; scroll: number;
  elapsed_ms: number; question_ids: string[]; snapshot: PublicGroup; started_at: string; submitted_at: string | null;
};
export type Result = { session: Session; score: number; total: number; attempts: { question_id: string; submitted_answer: string | null; correct_answer: string; is_correct: boolean; uncertain: boolean; answer_version: string; explanation: z.infer<typeof explanationSchema> | null }[] };
export type GroupSummary = { id: string; title: string; kind: BankGroup['kind']; question_count: number; year: number; month: number; set: number };
export type Annotation = { id:string; passage_id:string; paragraph_id:string; selected_text:string; note:string; kind:'note'|'sentence'; created_at:string; title?:string };
export type Mistake = { session_id:string; question_id:string; number:number; stem:string; submitted_answer:string|null; correct_answer:string; submitted_at:string; practice_type:'new'|'retry'|'review'; paper:BankGroup['paper']; kind:BankGroup['kind']; title:string };
export type MistakePage = { day:string; items:Mistake[]; total:number; offset:number };
export const mistakeQuerySchema=z.object({day:z.iso.date(),offset:z.coerce.number().int().min(0).max(100000).default(0)}).strict();
export type Stats = { today_count: number; week_count: number; week_ms: number; first_count: number; first_correct: number; review_count: number; review_correct: number; average_ms: number; review_completion: { completed: number; due: number }; trend: { day: string; session_id:string; title:string; paper:BankGroup['paper']; kind:BankGroup['kind']; count: number; correct: number }[]; by_kind: { kind: BankGroup['kind']; count: number; correct: number }[]; by_year: { year: number; count: number; total: number }[]; errors: { category: string | null; count: number }[] };
export type Dashboard = { daily_goal: number; remaining: number; recommendations: GroupSummary[]; due: { question_id: string; group_id: string; title: string; review_due_at: string }[]; active: Session[]; stats: Stats };
export function isEligible(g: BankGroup): boolean {
  return g.release_status === 'released' && g.content_status === 'complete' && g.question_status === 'complete' && g.questions.every(q => g.answers.some(a => a.question_id === q.id && a.verification_status === 'verified' && a.verified_at));
}
