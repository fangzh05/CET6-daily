"""Fetch pinned Lazynote reading analyses. Requires requests and beautifulsoup4.

Input is the normalized bank exported to reports/explanation-input.json.
Never changes answer keys; mismatches are reported for review.
"""
import concurrent.futures, hashlib, json, re, unicodedata
from pathlib import Path
import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'vendor/lazynote'
CACHE.mkdir(parents=True, exist_ok=True)

def norm(text):
    return re.sub(r'[^a-z0-9]', '', unicodedata.normalize('NFKD', text).lower())

def quote_in(quote, paragraphs):
    needle = norm(quote)
    if len(needle) < 18:
        return None
    for p in paragraphs:
        mapped, offsets = '', []
        for i, char in enumerate(p['text']):
            value = norm(char)
            mapped += value
            offsets.extend([i] * len(value))
        start = mapped.find(needle)
        if start >= 0:
            return {'paragraph_id': p['id'], 'text': p['text'][offsets[start]:offsets[start+len(needle)-1]+1]}
    return None

def fetch(group):
    paper = group['paper']
    key = f"{paper['year']}-{paper['month']:02}-{paper['set']}"
    section = {'careful':'c', 'matching':'b', 'cloze':'a'}[group['kind']]
    suffix = '-2' if group['kind']=='careful' and group['questions'][0]['number']==51 else ''
    url = f'https://english-exam.lazynote.cn/cet6/sections/{key}/part3-section-{section}{suffix}/'
    path = CACHE / f'{key}-{section}{suffix}.html'
    issues, records = [], []
    try:
        if not path.exists():
            response = requests.get(url, timeout=40)
            if response.status_code==404 and group['kind']=='careful' and not suffix:
                url=url.replace('part3-section-c/', 'part3-section-c-1/')
                response=requests.get(url, timeout=40)
            if response.status_code==404 and group['id']=='cet6-2021-12-03-reading-a-01':
                # Existing bank audit explicitly records this shared section.
                # Full paragraph, word bank and answer checks below still apply.
                url=url.replace('/2021-12-3/', '/2021-12-1/')
                response=requests.get(url, timeout=40)
            response.raise_for_status()
            path.write_bytes(response.content)
        raw = path.read_bytes()
        soup = BeautifulSoup(raw, 'html.parser')
        canonical=soup.select_one('link[rel="canonical"]')
        if canonical: url=canonical['href']
        text = lambda node: node.get_text(' ', strip=True) if node else ''
        analyses = {int(re.search(r'\d+', x.get('aria-label','')).group()):x for x in soup.select('.rp-ana') if re.search(r'\d+', x.get('aria-label',''))}
        page_text = norm(soup.get_text(' ', strip=True))
        for q in group['questions']:
            try:
                ana = analyses[q['number']]
                answer = re.match('[A-Z]', text(ana.select_one('.rp-ans'))).group()
                expected = next(a['correct_answer'] for a in group['answers'] if a['question_id']==q['id'])
                if answer != expected:
                    raise ValueError(f'answer conflict: source {answer}, bank {expected}')
                if group['kind'] != 'cloze' and norm(q['stem']) not in page_text:
                    raise ValueError('question text mismatch')
                if group['kind'] in ('careful','cloze'):
                    for o in q['options']:
                        if norm(o['text']) not in page_text:
                            raise ValueError(f'option text mismatch {o["key"]}')
                evidence = []
                for node in ana.select('.rp-locate-en'):
                    for chunk in re.split(r'\.{3}|…+', text(node)):
                        ev = quote_in(chunk, group['passage']['paragraphs'])
                        if ev and ev not in evidence: evidence.append(ev)
                if not evidence:
                    selector='.rp-pair-opt' if group['kind']=='matching' else '.is-ok .rp-pair-orig'
                    for node in ana.select(selector):
                        for chunk in re.split(r'\.{3}|…+', text(node)):
                            ev=quote_in(chunk, group['passage']['paragraphs'])
                            if ev and ev not in evidence: evidence.append(ev)
                if group['kind']=='cloze':
                    p = next(p for p in group['passage']['paragraphs'] if '{{'+str(q['number'])+'}}' in p['text'])
                    # Verify the entire paragraph, allowing only blank typography differences.
                    plain = re.sub(r'\{\{(\d+)\}\}', r'\1', p['text'])
                    if norm(plain) not in page_text:
                        raise ValueError('cloze paragraph mismatch')
                    evidence = [{'paragraph_id':p['id'], 'text':p['text']}]
                if not evidence: raise ValueError('no exact original evidence')
                distractors = {}
                for item in ana.select('.rp-verdict.is-bad'):
                    letter = text(item.select_one('.rp-verdict-letter'))[0]
                    distractors[letter] = text(item.select_one('.rp-flag'))+'：'+text(item.select_one('.rp-verdict-note'))
                for item in ana.select('.rp-rival'):
                    distractors[text(item.select_one('.rp-rival-letter'))[0]] = text(item.select_one('.rp-rival-why'))+'：'+text(item.select_one('.rp-rival-detail'))
                for item in ana.select('.rp-disc-item'):
                    distractors[text(item.select_one('.rp-disc-letter'))] = text(item.select_one('.rp-disc-reason'))
                relation = '；'.join(text(x) for x in ana.select('.rp-pair')) or text(ana.select_one('.rp-reason-core'))
                explanation = '\n'.join(text(row) for row in ana.select('.rp-row') if not row.select_one('.rp-row--answer'))
                if not relation or not explanation: raise ValueError('incomplete analysis')
                records.append({'question_id':q['id'], 'correct_answer':answer, 'stem':q['stem'], 'options':q['options'], 'explanation':explanation, 'keyword_relation':relation, 'evidence':evidence, 'distractor_explanations':distractors, 'skill_tags':[text(ana.select_one('.rp-qtype')) or group['kind']], 'verification_status':'verified'})
            except (ValueError, KeyError, AttributeError, StopIteration) as exc:
                issues.append({'question_id':q['id'], 'reason':str(exc)})
        return {'group_id':group['id'], 'url':url, 'sha256':hashlib.sha256(raw).hexdigest(), 'records':records}, issues
    except Exception as exc:
        return None, [{'group_id':group['id'], 'reason':str(exc)}]

if __name__=='__main__':
    groups = json.loads((ROOT/'reports/explanation-input.json').read_text(encoding='utf8'))
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(fetch, groups))
    data = {'schema_version':1, 'provider':'lazynote', 'groups':[x for x,_ in results if x]}
    (ROOT/'data/explanations/lazynote.json').write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
    issues = [i for _,items in results for i in items]
    summary = {'questions':sum(len(x['records']) for x,_ in results if x), 'issues':issues}
    (ROOT/'reports/explanation-coverage.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2),encoding='utf8')
    print(json.dumps({'questions':summary['questions'], 'issues':len(issues)}))
