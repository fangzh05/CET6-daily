-- These SECURITY INVOKER functions are called only by the authenticated Worker.
-- Each function call is one PostgreSQL statement/transaction over neon-http.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cet6_group(gid text) RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT jsonb_build_object(
  'id',g.id,'kind',g.kind,'title',g.title,'version',g.version,
  'paper',jsonb_build_object('id',p.id,'year',p.year,'month',p.month,'set',p.set),
  'passage',jsonb_build_object('id',pa.id,'word_bank',pa.word_bank,'paragraphs',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id',pp.id,'label',pp.label,'position',pp.position,'text',pp.text) ORDER BY pp.position),'[]') FROM passage_paragraphs pp WHERE pp.passage_id=pa.id)),
  'questions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'number',q.number,'stem',q.stem,'options',q.options,'paragraph_ids',q.paragraph_ids) ORDER BY q.number),'[]') FROM questions q WHERE q.group_id=g.id AND NOT q.archived),
  'source',jsonb_build_object('repository',sr.repository,'path',sr.path,'commit',sr.commit,'hash',sr.hash) || sr.metadata)
FROM question_groups g JOIN papers p ON p.id=g.paper_id JOIN passages pa ON pa.id=g.passage_id JOIN source_references sr ON sr.group_id=g.id
WHERE g.id=gid;
$$;


--> statement-breakpoint
CREATE OR REPLACE FUNCTION cet6_import(g jsonb, batch uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item jsonb; a jsonb; oldg question_groups; p jsonb := g->'paper'; pa jsonb := g->'passage'; gid text := g->>'id'; v text := g->>'version';
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('import:'||gid,0));
  SELECT * INTO oldg FROM question_groups WHERE id=gid FOR UPDATE;
  IF FOUND AND (oldg.paper_id<>p->>'id' OR oldg.passage_id<>pa->>'id' OR oldg.kind<>g->>'kind') THEN RAISE EXCEPTION 'IMPORT_STABLE_ID_CONFLICT'; END IF;
  IF EXISTS(SELECT 1 FROM passages WHERE id=pa->>'id' AND paper_id<>p->>'id') THEN RAISE EXCEPTION 'IMPORT_PASSAGE_OWNER_CONFLICT'; END IF;
  -- Paragraph deletions/re-numbering require an explicit future revision strategy.
  IF EXISTS(SELECT 1 FROM passage_paragraphs pp WHERE pp.passage_id=pa->>'id' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(pa->'paragraphs') x WHERE x->>'id'=pp.id)) THEN RAISE EXCEPTION 'IMPORT_PARAGRAPH_REMOVAL_REQUIRES_REVIEW'; END IF;
  INSERT INTO papers(id,year,month,set) VALUES(p->>'id',(p->>'year')::integer,(p->>'month')::integer,(p->>'set')::integer)
    ON CONFLICT(id) DO NOTHING;
  IF NOT EXISTS(SELECT 1 FROM papers WHERE id=p->>'id' AND year=(p->>'year')::int AND month=(p->>'month')::int AND set=(p->>'set')::int) THEN RAISE EXCEPTION 'IMPORT_PAPER_ID_CONFLICT'; END IF;
  INSERT INTO passages(id,paper_id,title,version,word_bank) VALUES(pa->>'id',p->>'id',g->>'title',v,pa->'word_bank')
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,version=excluded.version,word_bank=excluded.word_bank;
  FOR item IN SELECT * FROM jsonb_array_elements(pa->'paragraphs') LOOP
    IF EXISTS(SELECT 1 FROM passage_paragraphs WHERE id=item->>'id' AND (passage_id<>pa->>'id' OR position<>(item->>'position')::int)) THEN RAISE EXCEPTION 'IMPORT_PARAGRAPH_ID_CONFLICT'; END IF;
    INSERT INTO passage_paragraphs(id,passage_id,label,position,text) VALUES(item->>'id',pa->>'id',item->>'label',(item->>'position')::int,item->>'text')
      ON CONFLICT(id) DO UPDATE SET label=excluded.label,text=excluded.text;
  END LOOP;
  INSERT INTO question_groups(id,paper_id,passage_id,kind,title,content_status,question_status,version,eligible)
    VALUES(gid,p->>'id',pa->>'id',g->>'kind',g->>'title',g->>'content_status',g->>'question_status',v,false)
    ON CONFLICT(id) DO UPDATE SET title=excluded.title,content_status=excluded.content_status,question_status=excluded.question_status,version=excluded.version,eligible=false;
  UPDATE questions SET archived=true WHERE group_id=gid;
  FOR item IN SELECT * FROM jsonb_array_elements(g->'questions') LOOP
    IF EXISTS(SELECT 1 FROM questions WHERE id=item->>'id' AND (group_id<>gid OR number<>(item->>'number')::int)) THEN RAISE EXCEPTION 'IMPORT_QUESTION_ID_CONFLICT'; END IF;
    INSERT INTO questions(id,group_id,number,stem,options,paragraph_ids,version,archived)
      VALUES(item->>'id',gid,(item->>'number')::int,item->>'stem',item->'options',item->'paragraph_ids',v,false)
      ON CONFLICT(id) DO UPDATE SET stem=excluded.stem,options=excluded.options,paragraph_ids=excluded.paragraph_ids,version=excluded.version,archived=false;
  END LOOP;
  -- Missing or downgraded source data invalidates old keys/explanations for future sessions.
  UPDATE answer_keys SET verification_status='pending' WHERE question_id IN (SELECT id FROM questions WHERE group_id=gid);
  UPDATE explanations SET verification_status='pending' WHERE question_id IN (SELECT id FROM questions WHERE group_id=gid);
  FOR item IN SELECT * FROM jsonb_array_elements(g->'answers') LOOP
    IF NOT EXISTS(SELECT 1 FROM questions q,jsonb_array_elements(q.options) o WHERE q.id=item->>'question_id' AND q.group_id=gid AND NOT q.archived AND o->>'key'=item->>'correct_answer') THEN RAISE EXCEPTION 'IMPORT_ANSWER_MISMATCH'; END IF;
    INSERT INTO answer_keys(question_id,correct_answer,source,verification_status,verified_at,answer_version)
      VALUES(item->>'question_id',item->>'correct_answer',item->>'source',item->>'verification_status',(item->>'verified_at')::timestamptz,item->>'answer_version')
      ON CONFLICT(question_id) DO UPDATE SET correct_answer=excluded.correct_answer,source=excluded.source,verification_status=excluded.verification_status,verified_at=excluded.verified_at,answer_version=excluded.answer_version;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(g->'explanations') LOOP
    IF NOT EXISTS(SELECT 1 FROM questions WHERE id=item->>'question_id' AND group_id=gid AND NOT archived) THEN RAISE EXCEPTION 'IMPORT_EXPLANATION_MISMATCH'; END IF;
    IF item->>'verification_status'='verified' THEN
      IF NOT EXISTS(SELECT 1 FROM answer_keys WHERE question_id=item->>'question_id' AND verification_status='verified') THEN RAISE EXCEPTION 'IMPORT_EXPLANATION_UNVERIFIED_ANSWER'; END IF;
      FOR a IN SELECT * FROM jsonb_array_elements(item->'evidence') LOOP
        IF NOT EXISTS(SELECT 1 FROM passage_paragraphs WHERE id=a->>'paragraph_id' AND passage_id=pa->>'id' AND position(a->>'text' in text)>0) THEN RAISE EXCEPTION 'IMPORT_EVIDENCE_MISMATCH'; END IF;
      END LOOP;
    END IF;
    INSERT INTO explanations(question_id,explanation,keyword_relation,evidence,distractors,skill_tags,verification_status)
      VALUES(item->>'question_id',item->>'explanation',item->>'keyword_relation',item->'evidence',item->'distractor_explanations',item->'skill_tags',item->>'verification_status')
      ON CONFLICT(question_id) DO UPDATE SET explanation=excluded.explanation,keyword_relation=excluded.keyword_relation,evidence=excluded.evidence,distractors=excluded.distractors,skill_tags=excluded.skill_tags,verification_status=excluded.verification_status;
  END LOOP;
  INSERT INTO source_references(group_id,repository,path,commit,hash,metadata,batch_id)
    VALUES(gid,g->'source'->>'repository',g->'source'->>'path',g->'source'->>'commit',g->'source'->>'hash',(g->'source') - ARRAY['repository','path','commit','hash'],batch)
    ON CONFLICT(group_id) DO UPDATE SET repository=excluded.repository,path=excluded.path,commit=excluded.commit,hash=excluded.hash,metadata=excluded.metadata,batch_id=excluded.batch_id;
  UPDATE question_groups SET eligible=(g->>'release_status'='released' AND content_status='complete' AND question_status='complete'
    AND (SELECT count(*) FROM questions WHERE group_id=gid AND NOT archived)=CASE WHEN kind='careful' THEN 5 ELSE 10 END
    AND NOT EXISTS(SELECT 1 FROM questions q LEFT JOIN answer_keys a ON a.question_id=q.id WHERE q.group_id=gid AND NOT q.archived AND (a.verification_status IS DISTINCT FROM 'verified' OR a.verified_at IS NULL)))
    WHERE id=gid;
END $$;

