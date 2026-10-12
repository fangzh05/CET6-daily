import { createHash } from 'node:crypto';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { groupSchema, type BankGroup } from '../shared/contracts';

const repository = 'workbuddy-jlpt-n1-markdown';
const paperFilename = /^jlpt-n1-(\d{4})-(7|12)-01\.md$/;
const groupHeading = /^## (\d{4}) 年 (\d{1,2}) 月 JLPT N1 · (文法|読解|文字・語彙) 問題(\d+)$/;
const questionHeading = /^### (?:语法|词汇|阅读) · 问 (\d+)$/;
const answerLine = /^\*\*答案：\s*([A-D])\s*\*\*$/;
const optionLine = /^\s*-\s+\*\*([A-D])\.\*\*\s*(.*?)\s*$/;

type Contract = {
  adapter: 'workbuddy-jlpt-n1-markdown-v1';
  source_commit: string;
  readme_sha256: string;
  markdown_tree_sha256: string;
  paper_count: number;
  group_count: number;
  question_count: number;
};
type IndexRow = { paper_id: string; file: string; year: number; month: number; groups: number; questions: number; explanations: number };

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fail = (message: string): never => { throw new Error(message); };

async function safeFile(root: string, relative: string) {
  const rootPath = await realpath(root);
  const path = await realpath(resolve(rootPath, relative));
  if (path !== rootPath && !path.startsWith(`${rootPath}${sep}`)) fail(`Source path escapes the Markdown folder: ${relative}`);
  return readFile(path, 'utf8');
}

function readFrontmatter(markdown: string) {
  const lines = markdown.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') fail('Missing Markdown front matter');
  const end = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
  if (end < 0) fail('Unclosed Markdown front matter');
  const metadata = parseYaml(lines.slice(1, end).join('\n')) as Record<string, unknown>;
  return { metadata, lines: lines.slice(end + 1) };
}

function parseIndex(readme: string): { sourceCommit: string; rows: IndexRow[] } {
  const commit = readme.match(/源 commit：`([0-9a-f]{40})`/)?.[1];
  if (!commit) throw new Error('README is missing its pinned 40-character source commit');
  const rows = [...readme.matchAll(/^\|\s*\[(jlpt-n1-\d{4}-(?:7|12)-01)\]\(\.\/(jlpt-n1-\d{4}-(?:7|12)-01\.md)\)\s*\|\s*(\d{4})-(\d{2})\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*$/gm)]
    .map(match => ({ paper_id: match[1], file: match[2], year: Number(match[3]), month: Number(match[4]), groups: Number(match[5]), questions: Number(match[6]), explanations: Number(match[7]) }));
  if (rows.length !== 29) fail(`README must index 29 N1 papers; found ${rows.length}`);
  if (!/29 套\s*·\s*2000 题/.test(readme) || !/合计：\*\*29 套 · 2000 题 · 2000 条解析\*\*/.test(readme)) fail('README aggregate coverage changed; review the source contract');
  const papers = new Set<string>();
  for (const row of rows) {
    if (papers.has(row.paper_id) || row.file !== `${row.paper_id}.md`) fail(`Duplicate or mismatched paper in README: ${row.paper_id}`);
    papers.add(row.paper_id);
    const match = row.paper_id.match(/^jlpt-n1-(\d{4})-(7|12)-01$/);
    if (!match || Number(match[1]) !== row.year || Number(match[2]) !== row.month) fail(`Invalid N1 paper identity in README: ${row.paper_id}`);
  }
  return { sourceCommit: commit, rows };
}

function plainText(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\r/g, '')
    .trim();
}

function passageRows(groupId: string, kind: BankGroup['kind'], heading: string, sourceLines: string[]) {
  if (kind !== 'jlpt_reading') {
    const text = `该题组为 ${kind === 'jlpt_grammar' ? '语法' : '词汇'} 单项选择题，题目见右侧。`;
    return { paragraphs: [{ id: `${groupId}-p01`, label: '题组', text, position: 0 }], complete: true };
  }
  const blocks: string[][] = [];
  let block: string[] = [];
  const flush = () => { if (block.some(line => line.trim())) blocks.push(block); block = []; };
  for (const original of sourceLines) {
    const line = original.replace(/^\s*>\s?/, '').trimEnd();
    if (!line.trim() || /^\*\*文章\*\*$/.test(line.trim()) || /^---+$/.test(line.trim())) { flush(); continue; }
    block.push(line);
  }
  flush();
  const rows = blocks.map((lines, index) => ({
    id: `${groupId}-p${String(index + 1).padStart(2, '0')}`,
    label: String(index + 1),
    text: plainText(lines.join('\n')),
    position: index
  })).filter(row => row.text.length > 0);
  if (!rows.length) return {
    paragraphs: [{ id: `${groupId}-p01`, label: '题面缺失', text: '源 Markdown 未包含本题组的原文、图表或图片题面；补齐材料并复核后才能开放正式练习。', position: 0 }],
    complete: false
  };
  return { paragraphs: rows.map((row, position) => ({ ...row, position })), complete: true };
}

function parseQuestion(groupId: string, kind: BankGroup['kind'], number: number, lines: string[], paragraphIds: string[], file: string, validationTime: string) {
  const keyLines = lines.flatMap((line, index) => answerLine.exec(line.trim())?.[1] ? [{ index, answer: answerLine.exec(line.trim())![1] }] : []);
  if (keyLines.length !== 1) fail(`${file}/${groupId}/question ${number}: expected one 答案 line, got ${keyLines.length}`);
  const keyIndex = keyLines[0].index;
  const optionRows = lines.slice(0, keyIndex).flatMap((line, index) => {
    const match = optionLine.exec(line);
    if (!match) return [];
    const checked = /\s✓\s*$/.test(match[2]);
    const text = match[2].replace(/\s*✓\s*$/, '').trim();
    return [{ index, key: match[1], text, checked }];
  });
  if (optionRows.length !== 4 || optionRows.map(row => row.key).sort().join('') !== 'ABCD') fail(`${file}/${groupId}/question ${number}: expected exactly options A-D`);
  const checked = optionRows.filter(row => row.checked);
  if (checked.length !== 1 || checked[0].key !== keyLines[0].answer) fail(`${file}/${groupId}/question ${number}: 答案 line and unique ✓ marker disagree`);
  if (optionRows.some(row => !row.text)) fail(`${file}/${groupId}/question ${number}: empty option text`);

  const firstOption = Math.min(...optionRows.map(row => row.index));
  const stem = plainText(lines.slice(0, firstOption).join('\n'));
  if (!stem) fail(`${file}/${groupId}/question ${number}: empty stem`);
  const explanationMarkdown = lines.slice(keyIndex + 1).join('\n').trim();
  const explanation = plainText(explanationMarkdown);
  if (!explanation) fail(`${file}/${groupId}/question ${number}: missing explanation text`);
  const id = `${groupId}-q${String(number).padStart(4, '0')}`;
  const answer = keyLines[0].answer;
  return {
    question: { id, number, stem, options: optionRows.map(row => ({ key: row.key, text: row.text })), paragraph_ids: kind === 'jlpt_reading' ? paragraphIds : [] },
    answer: {
      question_id: id,
      correct_answer: answer,
      source: 'JLPT N1 source Markdown: 答案 line matches its unique checked option; source notes no independent official-key check.',
      verification_status: 'verified' as const,
      verified_at: validationTime,
      answer_version: sha(`${file}\n${id}\n${answer}`),
      notes: 'Source-published key; internal marker consistency validated during import. Not independently checked against an official answer key.'
    },
    explanation: {
      question_id: id,
      explanation,
      keyword_relation: 'JLPT N1 source explanation; pending human review',
      evidence: [],
      distractor_explanations: {},
      skill_tags: [kind],
      verification_status: 'pending' as const,
      analysis: { source_markdown: explanationMarkdown, verification_note: 'Source README marks explanations pending review.' }
    }
  };
}

function parsePaper(markdown: string, row: IndexRow, sourceCommit: string, fileHash: string, validationTime: string): BankGroup[] {
  const { metadata, lines } = readFrontmatter(markdown);
  if (metadata.paper !== row.paper_id || metadata.exam !== 'JLPT_N1' || metadata.source_commit !== sourceCommit) fail(`${row.file}: front matter identity, exam or source commit mismatch`);
  if (Number(metadata.year) !== row.year || Number(metadata.month) !== row.month || Number(metadata.groups) !== row.groups || Number(metadata.questions) !== row.questions || Number(metadata.explanations) !== row.explanations) fail(`${row.file}: front matter coverage disagrees with README`);
  const groupStarts = lines.flatMap((line, index) => groupHeading.exec(line.trim()) ? [{ index, match: groupHeading.exec(line.trim())! }] : []);
  if (groupStarts.length !== row.groups) fail(`${row.file}: README lists ${row.groups} groups, Markdown has ${groupStarts.length}`);
  const groups: BankGroup[] = [];
  for (let i = 0; i < groupStarts.length; i++) {
    const { index: start, match } = groupStarts[i];
    const end = groupStarts[i + 1]?.index ?? lines.length;
    const heading = match[0].replace(/^## /, '');
    const year = Number(match[1]); const month = Number(match[2]); const section = match[3]; const problem = Number(match[4]);
    if (year !== row.year || month !== row.month) fail(`${row.file}: group heading has wrong paper identity: ${heading}`);
    const sectionInfo = section === '文法' ? { suffix: 'grammar', kind: 'jlpt_grammar' as const } : section === '読解' ? { suffix: 'reading', kind: 'jlpt_reading' as const } : { suffix: 'vocab', kind: 'jlpt_vocab' as const };
    const groupId = `${row.paper_id}-${sectionInfo.suffix}-${String(problem).padStart(2, '0')}`;
    const content = lines.slice(start + 1, end);
    const questionStarts = content.flatMap((line, offset) => questionHeading.exec(line.trim()) ? [{ offset, number: Number(questionHeading.exec(line.trim())![1]) }] : []);
    if (!questionStarts.length) fail(`${row.file}/${groupId}: no question headings`);
    const passage = passageRows(groupId, sectionInfo.kind, heading, content.slice(0, questionStarts[0].offset));
    const paragraphs = passage.paragraphs;
    const paragraphIds = paragraphs.map(paragraph => paragraph.id);
    const parsedQuestions = questionStarts.map((question, index) => {
      const qEnd = questionStarts[index + 1]?.offset ?? content.length;
      return parseQuestion(groupId, sectionInfo.kind, question.number, content.slice(question.offset + 1, qEnd), paragraphIds, row.file, validationTime);
    });
    const rawGroup = content.join('\n');
    const rawHash = sha(rawGroup);
    groups.push(groupSchema.parse({
      id: groupId,
      paper: { id: row.paper_id, exam: 'JLPT_N1', year: row.year, month: row.month, set: 1 },
      kind: sectionInfo.kind,
      title: heading,
      passage: { id: `${groupId}-passage`, paragraphs, word_bank: [] },
      questions: parsedQuestions.map(item => item.question),
      content_status: passage.complete ? 'complete' : 'incomplete',
      question_status: 'complete',
      release_status: passage.complete ? 'released' : 'pending',
      version: rawHash.slice(0, 16),
      source: {
        repository,
        path: row.file,
        commit: sourceCommit,
        hash: rawHash,
        raw_repository: 'eulerex/jlpt-test (source answer keys are not independently checked against an official key)',
        raw_path: `markdown/${row.file}`,
        raw_hash: fileHash,
        markdown_path: row.file
      },
      answers: parsedQuestions.map(item => item.answer),
      explanations: parsedQuestions.map(item => item.explanation)
    }));
  }
  if (groups.reduce((total, group) => total + group.questions.length, 0) !== row.questions) fail(`${row.file}: README question count mismatch`);
  return groups;
}

export async function inspectJlptN1Bank(root: string, contractPath = 'docs/jlpt-n1-markdown-contract.json') {
  const contract = JSON.parse(await readFile(contractPath, 'utf8')) as Contract;
  if (contract.adapter !== 'workbuddy-jlpt-n1-markdown-v1') fail('Unexpected JLPT N1 source contract adapter');
  const readme = await safeFile(root, 'README.md');
  const index = parseIndex(readme);
  const filenames = (await readdir(root, { withFileTypes: true })).filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.md') && entry.name !== 'README.md').map(entry => entry.name).sort();
  const indexed = index.rows.map(row => row.file).sort();
  if (JSON.stringify(filenames) !== JSON.stringify(indexed)) fail('Markdown folder inventory differs from README; review the source contract before import');
  const fileHashes = new Map<string, string>();
  for (const row of index.rows) fileHashes.set(row.file, sha(await safeFile(root, row.file)));
  const treeHash = sha(index.rows.map(row => `${row.file}:${fileHashes.get(row.file)}`).sort().join('\n'));
  const readmeHash = sha(readme);
  if (index.sourceCommit !== contract.source_commit || readmeHash !== contract.readme_sha256 || treeHash !== contract.markdown_tree_sha256) fail('JLPT N1 source changed from the reviewed Markdown contract');
  if (index.rows.length !== contract.paper_count || index.rows.reduce((n, row) => n + row.groups, 0) !== contract.group_count || index.rows.reduce((n, row) => n + row.questions, 0) !== contract.question_count) fail('JLPT N1 README coverage differs from the reviewed contract');
  for (const row of index.rows) {
    const match = row.file.match(paperFilename);
    if (!match || Number(match[1]) !== row.year || Number(match[2]) !== row.month) fail(`Invalid paper file name: ${row.file}`);
  }
  return { source_commit: index.sourceCommit, readme_sha256: readmeHash, markdown_tree_sha256: treeHash, paper_count: index.rows.length, rows: index.rows, fileHashes };
}

export async function validateJlptN1Bank(root: string, contractPath = 'docs/jlpt-n1-markdown-contract.json', validationTime = new Date().toISOString()) {
  const inspected = await inspectJlptN1Bank(root, contractPath);
  const groups: BankGroup[] = [];
  const byPaper: { paper_id: string; groups: number; questions: number }[] = [];
  for (const row of inspected.rows) {
    const markdown = await safeFile(root, row.file);
    const paperGroups = parsePaper(markdown, row, inspected.source_commit, inspected.fileHashes.get(row.file)!, validationTime);
    groups.push(...paperGroups);
    byPaper.push({ paper_id: row.paper_id, groups: paperGroups.length, questions: paperGroups.reduce((n, group) => n + group.questions.length, 0) });
  }
  const questions = groups.reduce((n, group) => n + group.questions.length, 0);
  const answerCount = groups.reduce((n, group) => n + group.answers.length, 0);
  const explanationCount = groups.reduce((n, group) => n + group.explanations.length, 0);
  if (groups.length !== 375 || questions !== 2000 || answerCount !== questions || explanationCount !== questions) fail(`Expected 375 groups / 2,000 questions / matching answer and explanation counts; got ${groups.length} / ${questions} / ${answerCount} / ${explanationCount}`);
  const ids = groups.flatMap(group => group.questions.map(question => question.id));
  if (new Set(ids).size !== ids.length) fail('Duplicate JLPT N1 question IDs');
  return {
    groups,
    errors: [] as { path: string; message: string }[],
    quarantine: [] as { group_id: string; reason: string }[],
    commit: inspected.source_commit,
    repository,
    sourceHash: inspected.markdown_tree_sha256,
    coverage: {
      papers: inspected.paper_count,
      groups: groups.length,
      questions,
      source_verified_answers: answerCount,
      pending_explanations: explanationCount,
      release_ready: groups.filter(group => group.release_status === 'released').length,
      by_paper: byPaper
    }
  };
}
