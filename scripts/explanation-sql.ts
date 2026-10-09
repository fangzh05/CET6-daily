export const explanationValidationSql=`select r from jsonb_array_elements($1::jsonb) r
  join questions q on q.id=r->>'question_id' and q.group_id=r->>'group_id' and not q.archived
  join question_groups g on g.id=q.group_id and not g.archived
  join answer_keys a on a.question_id=q.id and a.verification_status='verified' and a.correct_answer=r->>'correct_answer'
  where q.stem=r->>'stem' and q.options=r->'options'
  and not exists(select 1 from jsonb_array_elements(r->'evidence') ev where not exists(
    select 1 from passage_paragraphs p where p.id=ev->>'paragraph_id' and p.passage_id=g.passage_id and position(ev->>'text' in p.text)>0))`;
