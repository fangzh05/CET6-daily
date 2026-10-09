-- These SECURITY INVOKER functions are called only by the authenticated Worker.
-- Each function call is one PostgreSQL statement/transaction over neon-http.
CREATE OR REPLACE FUNCTION cet6_group(gid text) RETURNS jsonb LANGUAGE sql STABLE AS $$
SELECT jsonb_build_object(
  'id',g.id,'kind',g.kind,'title',g.title,'version',g.version,
  'paper',jsonb_build_object('id',p.id,'exam',p.exam,'year',p.year,'month',p.month,'set',p.set),
  'passage',jsonb_build_object('id',pa.id,'word_bank',pa.word_bank,'paragraphs',
    (SELECT coalesce(jsonb_agg(jsonb_build_object('id',pp.id,'label',pp.label,'position',pp.position,'text',pp.text) ORDER BY pp.position),'[]') FROM passage_paragraphs pp WHERE pp.passage_id=pa.id)),
  'questions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',q.id,'number',q.number,'stem',q.stem,'options',q.options,'paragraph_ids',q.paragraph_ids) ORDER BY q.number),'[]') FROM questions q WHERE q.group_id=g.id AND NOT q.archived),
  'source',jsonb_build_object('repository',sr.repository,'path',sr.path,'commit',sr.commit,'hash',sr.hash) || sr.metadata)
FROM question_groups g JOIN papers p ON p.id=g.paper_id JOIN passages pa ON pa.id=g.passage_id JOIN source_references sr ON sr.group_id=g.id
WHERE g.id=gid;
$$;

CREATE OR REPLACE FUNCTION cet6_session_public(s practice_sessions) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
SELECT to_jsonb(s) - ARRAY['user_id','grading_snapshot','explanation_snapshot','submission_id','score','total'];
$$;

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
  SELECT coalesce(jsonb_object_agg(e.question_id,jsonb_build_object('question_id',e.question_id,'explanation',e.explanation,'keyword_relation',e.keyword_relation,'evidence',e.evidence,'distractor_explanations',e.distractors,'skill_tags',e.skill_tags,'verification_status',e.verification_status,'analysis',e.analysis)),'{}') INTO ex
    FROM explanations e WHERE qs ? e.question_id AND e.verification_status='verified';
  INSERT INTO practice_sessions(user_id,group_id,practice_type,question_ids,snapshot,grading_snapshot,explanation_snapshot)
    VALUES(uid,gid,ptype,qs,snap,keys,ex) RETURNING * INTO s;
  RETURN cet6_session_public(s);
END $$;

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
CREATE OR REPLACE FUNCTION cet6_attempt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'ATTEMPT_HISTORY_IMMUTABLE'; END $$;
CREATE TRIGGER attempts_immutable BEFORE UPDATE OR DELETE ON attempts FOR EACH ROW EXECUTE FUNCTION cet6_attempt_immutable();
CREATE OR REPLACE FUNCTION cet6_session_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='submitted' OR NEW.user_id<>OLD.user_id OR NEW.group_id<>OLD.group_id OR NEW.practice_type<>OLD.practice_type OR NEW.snapshot<>OLD.snapshot OR NEW.grading_snapshot<>OLD.grading_snapshot OR NEW.explanation_snapshot<>OLD.explanation_snapshot OR NEW.question_ids<>OLD.question_ids THEN RAISE EXCEPTION 'SESSION_HISTORY_IMMUTABLE'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER session_immutable BEFORE UPDATE ON practice_sessions FOR EACH ROW EXECUTE FUNCTION cet6_session_immutable();
-- Prevent accidental mismatched ownership even if an application write is wrong.
ALTER TABLE attempts ADD CONSTRAINT attempt_session_owner FOREIGN KEY(session_id,user_id) REFERENCES practice_sessions(id,user_id) ON DELETE RESTRICT;
CREATE UNIQUE INDEX one_open_group_session ON practice_sessions(user_id,group_id) WHERE status IN ('active','paused');
