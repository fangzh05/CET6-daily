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
  'source',jsonb_build_object('repository',sr.repository,'path',sr.path,'commit',sr.commit,'hash',sr.hash))
FROM question_groups g JOIN papers p ON p.id=g.paper_id JOIN passages pa ON pa.id=g.passage_id JOIN source_references sr ON sr.group_id=g.id
WHERE g.id=gid;
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION cet6_session_public(s practice_sessions) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT to_jsonb(s) - ARRAY['user_id','grading_snapshot','explanation_snapshot','submission_id','score','total'];
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION cet6_start(uid uuid, gid text, ptype text, requested jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE g question_groups; s practice_sessions; qs jsonb; keys jsonb; ex jsonb; snap jsonb;
BEGIN
  -- Serialize starts for a user/group: new/retry/review cannot overlap.
  PERFORM pg_advisory_xact_lock(hashtextextended(uid::text || ':' || gid,0));
  IF ptype NOT IN ('new','retry','review') THEN RAISE EXCEPTION 'INVALID_PRACTICE_TYPE'; END IF;
  SELECT * INTO s FROM practice_sessions WHERE user_id=uid AND group_id=gid AND status IN ('active','paused') ORDER BY started_at DESC LIMIT 1;
  IF FOUND THEN RETURN cet6_session_public(s); END IF;
  SELECT * INTO g FROM question_groups WHERE id=gid AND eligible AND NOT archived FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'GROUP_NOT_VERIFIED'; END IF;
  snap := cet6_group(gid);
  SELECT jsonb_agg(q.id ORDER BY q.number) INTO qs FROM questions q WHERE q.group_id=gid AND NOT q.archived;
  IF ptype='review' THEN
    SELECT jsonb_agg(q.id ORDER BY q.number) INTO qs FROM questions q JOIN review_states r ON r.question_id=q.id
    WHERE q.group_id=gid AND NOT q.archived AND r.user_id=uid AND r.review_due_at<=now()
      AND (requested IS NULL OR requested ? q.id);
    IF qs IS NULL THEN RAISE EXCEPTION 'NO_DUE_REVIEWS'; END IF;
  ELSIF requested IS NOT NULL THEN RAISE EXCEPTION 'FULL_GROUP_REQUIRED'; END IF;
  IF ptype='new' AND EXISTS(SELECT 1 FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.user_id=uid AND q.group_id=gid AND a.practice_type='new') THEN RAISE EXCEPTION 'ALREADY_PRACTICED'; END IF;
  IF ptype='retry' AND NOT EXISTS(SELECT 1 FROM attempts a JOIN questions q ON q.id=a.question_id WHERE a.user_id=uid AND q.group_id=gid) THEN RAISE EXCEPTION 'RETRY_REQUIRES_HISTORY'; END IF;
  -- Also check answers here; never trust a stale eligible flag.
  SELECT jsonb_object_agg(a.question_id,jsonb_build_object('correct_answer',a.correct_answer,'answer_version',a.answer_version,'source',a.source)) INTO keys
    FROM answer_keys a WHERE qs ? a.question_id AND a.verification_status='verified' AND a.verified_at IS NOT NULL;
  IF keys IS NULL OR (SELECT count(*) FROM jsonb_object_keys(keys))<>jsonb_array_length(qs) THEN RAISE EXCEPTION 'GROUP_NOT_VERIFIED'; END IF;
  SELECT coalesce(jsonb_object_agg(e.question_id,jsonb_build_object('question_id',e.question_id,'explanation',e.explanation,'keyword_relation',e.keyword_relation,'evidence',e.evidence,'distractor_explanations',e.distractors,'skill_tags',e.skill_tags,'verification_status',e.verification_status)),'{}') INTO ex
    FROM explanations e WHERE qs ? e.question_id AND e.verification_status='verified';
  INSERT INTO practice_sessions(user_id,group_id,practice_type,question_ids,snapshot,grading_snapshot,explanation_snapshot)
    VALUES(uid,gid,ptype,qs,snap,keys,ex) RETURNING * INTO s;
  RETURN cet6_session_public(s);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION cet6_save(uid uuid, sid uuid, expected integer, draft jsonb) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s practice_sessions; entry record; question jsonb;
BEGIN
  SELECT * INTO s FROM practice_sessions WHERE id=sid AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF s.status='submitted' THEN RAISE EXCEPTION 'ALREADY_SUBMITTED'; END IF;
  IF s.revision<>expected THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
  IF (draft->>'cursor')::integer >= jsonb_array_length(s.question_ids) OR (draft->>'elapsed_ms')::integer < s.elapsed_ms THEN RAISE EXCEPTION 'INVALID_DRAFT'; END IF;
  FOR entry IN SELECT * FROM jsonb_each(draft->'choices') LOOP
    IF NOT (s.question_ids ? entry.key) THEN RAISE EXCEPTION 'INVALID_QUESTION'; END IF;
    SELECT q INTO question FROM jsonb_array_elements(s.snapshot->'questions') q WHERE q->>'id'=entry.key;
    IF entry.value->>'answer' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(question->'options') o WHERE o->>'key'=entry.value->>'answer') THEN RAISE EXCEPTION 'INVALID_ANSWER'; END IF;
    IF (entry.value->>'duration_ms')::integer < coalesce((s.choices->entry.key->>'duration_ms')::integer,0) THEN RAISE EXCEPTION 'INVALID_DRAFT'; END IF;
  END LOOP;
  IF s.snapshot->>'kind'='cloze' AND EXISTS(SELECT value->>'answer' FROM jsonb_each(draft->'choices') WHERE value->>'answer' IS NOT NULL GROUP BY value->>'answer' HAVING count(*)>1) THEN RAISE EXCEPTION 'DUPLICATE_CLOZE_WORD'; END IF;
  UPDATE practice_sessions SET choices=draft->'choices', cursor=(draft->>'cursor')::integer, scroll=round((draft->>'scroll')::numeric)::integer,
    elapsed_ms=(draft->>'elapsed_ms')::integer, status=CASE WHEN (draft->>'paused')::boolean THEN 'paused' ELSE 'active' END, revision=revision+1
    WHERE id=sid RETURNING * INTO s;
  RETURN cet6_session_public(s);
END $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION cet6_submit(uid uuid, sid uuid, token uuid, expected integer) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE s practice_sessions; qid text; key jsonb; choice jsonb; correct boolean; stamp timestamptz := now(); n integer := 0; old review_states; nextstep integer;
BEGIN
  SELECT * INTO s FROM practice_sessions WHERE id=sid AND user_id=uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_NOT_FOUND'; END IF;
  IF s.status='submitted' THEN
    IF s.submission_id=token THEN RETURN jsonb_build_object('session_id',s.id,'score',s.score,'total',s.total); END IF;
    RAISE EXCEPTION 'ALREADY_SUBMITTED';
  END IF;
  IF s.revision<>expected THEN RAISE EXCEPTION 'REVISION_CONFLICT'; END IF;
  FOR qid IN SELECT jsonb_array_elements_text(s.question_ids) LOOP
    key := s.grading_snapshot->qid; choice := coalesce(s.choices->qid,'{}');
    IF key IS NULL THEN RAISE EXCEPTION 'GROUP_NOT_VERIFIED'; END IF;
    correct := coalesce(choice->>'answer'=key->>'correct_answer',false);
    IF correct THEN n := n+1; END IF;
    INSERT INTO attempts(session_id,user_id,question_id,submitted_answer,correct_answer,is_correct,uncertain,response_duration,practice_type,answer_version,submitted_at)
      VALUES(sid,uid,qid,choice->>'answer',key->>'correct_answer',correct,coalesce((choice->>'uncertain')::boolean,false),coalesce((choice->>'duration_ms')::integer,0),s.practice_type,key->>'answer_version',stamp);
    IF NOT correct OR coalesce((choice->>'uncertain')::boolean,false) OR s.practice_type='review' THEN
      SELECT * INTO old FROM review_states WHERE user_id=uid AND question_id=qid FOR UPDATE;
      nextstep := CASE WHEN NOT correct THEN 0 WHEN s.practice_type='review' AND FOUND THEN least(old.step+1,3) ELSE 0 END;
      INSERT INTO review_states(user_id,question_id,first_wrong_at,last_reviewed_at,review_due_at,wrong_count,review_count,step,mastery_state)
      VALUES(uid,qid,CASE WHEN NOT correct THEN stamp ELSE NULL END,CASE WHEN s.practice_type='review' THEN stamp ELSE NULL END,
        stamp + make_interval(days => (ARRAY[1,3,7,14])[nextstep+1]),CASE WHEN correct THEN 0 ELSE 1 END,CASE WHEN s.practice_type='review' THEN 1 ELSE 0 END,nextstep,CASE WHEN nextstep=3 AND correct THEN 'mastered' ELSE 'learning' END)
      ON CONFLICT(user_id,question_id) DO UPDATE SET
        first_wrong_at=coalesce(review_states.first_wrong_at,excluded.first_wrong_at),
        last_reviewed_at=coalesce(excluded.last_reviewed_at,review_states.last_reviewed_at),
        review_due_at=excluded.review_due_at,wrong_count=review_states.wrong_count+excluded.wrong_count,
        review_count=review_states.review_count+excluded.review_count,step=excluded.step,mastery_state=excluded.mastery_state;
    END IF;
  END LOOP;
  UPDATE practice_sessions SET status='submitted',submission_id=token,submitted_at=stamp,score=n,total=jsonb_array_length(s.question_ids),revision=revision+1 WHERE id=sid;
  RETURN jsonb_build_object('session_id',sid,'score',n,'total',jsonb_array_length(s.question_ids));
END $$;

-- Enforce append-only attempt history and immutable session content/first results.
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cet6_attempt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ATTEMPT_HISTORY_IMMUTABLE'; END $$;
--> statement-breakpoint
CREATE TRIGGER attempts_immutable BEFORE UPDATE OR DELETE ON attempts FOR EACH ROW EXECUTE FUNCTION cet6_attempt_immutable();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION cet6_session_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='submitted' OR NEW.user_id<>OLD.user_id OR NEW.group_id<>OLD.group_id OR NEW.practice_type<>OLD.practice_type OR NEW.snapshot<>OLD.snapshot OR NEW.grading_snapshot<>OLD.grading_snapshot OR NEW.explanation_snapshot<>OLD.explanation_snapshot OR NEW.question_ids<>OLD.question_ids THEN RAISE EXCEPTION 'SESSION_HISTORY_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER session_immutable BEFORE UPDATE ON practice_sessions FOR EACH ROW EXECUTE FUNCTION cet6_session_immutable();
-- Prevent accidental mismatched ownership even if an application write is wrong.
--> statement-breakpoint
ALTER TABLE attempts ADD CONSTRAINT attempt_session_owner FOREIGN KEY(session_id,user_id) REFERENCES practice_sessions(id,user_id) ON DELETE RESTRICT;
--> statement-breakpoint
CREATE UNIQUE INDEX one_open_group_session ON practice_sessions(user_id,group_id) WHERE status IN ('active','paused');

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
  INSERT INTO source_references(group_id,repository,path,commit,hash,batch_id)
    VALUES(gid,g->'source'->>'repository',g->'source'->>'path',g->'source'->>'commit',g->'source'->>'hash',batch)
    ON CONFLICT(group_id) DO UPDATE SET repository=excluded.repository,path=excluded.path,commit=excluded.commit,hash=excluded.hash,batch_id=excluded.batch_id;
  UPDATE question_groups SET eligible=(content_status='complete' AND question_status='complete'
    AND (SELECT count(*) FROM questions WHERE group_id=gid AND NOT archived)=CASE WHEN kind='careful' THEN 5 ELSE 10 END
    AND NOT EXISTS(SELECT 1 FROM questions q LEFT JOIN answer_keys a ON a.question_id=q.id WHERE q.group_id=gid AND NOT q.archived AND (a.verification_status IS DISTINCT FROM 'verified' OR a.verified_at IS NULL)))
    WHERE id=gid;
END $$;

