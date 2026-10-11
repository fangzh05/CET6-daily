import {test,expect} from '@playwright/test';

test('current highlights remain visible, survive refresh, and deduplicate',async({page,request})=>{
  await request.get('http://127.0.0.1:8787/__test/reset');
  await page.goto('/');
  await page.getByRole('button',{name:'开始阅读'}).click();
  const paragraph=page.locator('.rp-paragraph p').first();
  await expect(paragraph).toBeVisible();
  const select=async()=>{
    await paragraph.evaluate(el=>{
      const walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
      const node=walker.nextNode()!;
      const range=document.createRange();range.setStart(node,0);range.setEnd(node,10);
      const selection=window.getSelection()!;selection.removeAllRanges();selection.addRange(range);
      el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));
    });
    await page.getByRole('button',{name:'高亮',exact:true}).click();
  };
  await select();
  await expect(page.locator('.personal-highlight')).toHaveCount(1);
  await select();
  await expect(page.locator('.personal-highlight')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.personal-highlight')).toHaveCount(1);
  const stored=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('cet6:reading-ui:')).map(k=>JSON.parse(localStorage.getItem(k)!)));
  expect(stored.flatMap(s=>s.readingHighlights)).toHaveLength(1);
});
