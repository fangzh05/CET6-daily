import { describe,it,expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseReadingFixture } from '../scripts/reading-fixture';
import { initialState,restoreState } from '../src/reading/state';
const source=readFileSync('fixtures/reading/quiet-city.md','utf8').replace(/\r\n/g,'\n');
const fixture=parseReadingFixture(source);
describe('reading prototype build contract',()=>{
  it('separates answers and validates the original 500–700 word passage',()=>{expect(JSON.stringify(fixture.publicData)).not.toContain('correctOptionId');expect(fixture.publicData.paragraphs.flatMap(p=>p.text.split(/\s+/)).length).toBeGreaterThanOrEqual(500);expect(fixture.publicData.paragraphs.flatMap(p=>p.text.split(/\s+/)).length).toBeLessThanOrEqual(700);expect(fixture.reviews.some(r=>r.evidence.length>1)).toBe(true);expect(fixture.reviews.some(r=>r.evidence.length===0)).toBe(true);});
  it('rejects invalid evidence, duplicate numbers and missing options',()=>{expect(()=>parseReadingFixture(source.replace('paragraphId: purpose','paragraphId: absent'))).toThrow('Invalid evidence');expect(()=>parseReadingFixture(source.replace('number: 52','number: 51'))).toThrow();expect(()=>parseReadingFixture(source.replace('key: D, text: To encourage','key: A, text: To encourage'))).toThrow();});
  it('preserves explicit anchors and deterministically disambiguates repeated paragraphs',()=>{const noAnchors=source.replace(/<!-- id: [\w-]+ -->\n/g,'');const metadata=noAnchors.slice(0,noAnchors.indexOf('\n---\n',4)+5);const modified=metadata.replace(/evidence: \[\{ paragraphId:.*?\}\]/g,'evidence: []').replace(/    evidence:\n      -.*\n      -.*/g,'    evidence: []')+'Repeated paragraph.\n\nRepeated paragraph.';const a=parseReadingFixture(modified);expect(a.publicData.paragraphs[1].id).toBe(a.publicData.paragraphs[0].id+'-2');expect(parseReadingFixture(modified)).toEqual(a);});
});
describe('prototype persistence isolation',()=>{
  const base=initialState(fixture.publicData.id,'bench-q1');
  it('restores answers, flags, review mode, drawer and reading positions',()=>{const state={...base,selectedAnswers:{'bench-q1':'B'},flaggedQuestionIds:['bench-q1'],readerScrollPosition:510,drawerState:'half',practiceStatus:'review',readingHighlights:[{id:'h',paragraphId:'opening',start:0,end:10}]};expect(restoreState(JSON.stringify(state),base,fixture.publicData.questions,fixture.publicData.paragraphs)).toEqual(state);});
  it('ignores malformed or foreign drafts and invalid selections',()=>{for(const raw of ['bad',JSON.stringify({...base,passageId:'foreign'}),JSON.stringify({...base,selectedAnswers:{'bench-q1':'Z'}})])expect(restoreState(raw,base,fixture.publicData.questions,fixture.publicData.paragraphs)).toEqual(base);});
  it('filters invalid highlights without losing valid answers',()=>{const state={...base,selectedAnswers:{'bench-q1':'A'},readingHighlights:[{id:'bad',paragraphId:'opening',start:10,end:2}]};expect(restoreState(JSON.stringify(state),base,fixture.publicData.questions,fixture.publicData.paragraphs).readingHighlights).toEqual([]);});
  it('restores freely chosen drawer heights and accepts legacy saved layouts',()=>{
    const legacy={...base};delete (legacy as Partial<typeof base>).drawerHeight;
    expect(restoreState(JSON.stringify(legacy),base,fixture.publicData.questions,fixture.publicData.paragraphs).drawerHeight).toBeNull();
    const custom={...base,drawerHeight:.427};
    expect(restoreState(JSON.stringify(custom),base,fixture.publicData.questions,fixture.publicData.paragraphs).drawerHeight).toBe(.427);
    expect(restoreState(JSON.stringify({...custom,drawerHeight:2}),base,fixture.publicData.questions,fixture.publicData.paragraphs)).toEqual(base);
  });
});
