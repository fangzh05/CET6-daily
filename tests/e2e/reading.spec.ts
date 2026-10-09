import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.get('http://127.0.0.1:8787/__test/reset');});
test('pending library opens full context on desktop and mobile without grading',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'题库',exact:true}).click();
  const row=page.locator('article').filter({has:page.getByRole('heading',{name:'待核验测试文章 · 非六级真题'})});
  await row.getByRole('button',{name:'查看文章与题目'}).click();
  await expect(page.getByText('待核验 · 暂不评分',{exact:true})).toBeVisible();await expect(page.locator('.preview-article')).toBeVisible();
  if((page.viewportSize()?.width??1000)<768)await page.getByRole('button',{name:'题目',exact:true}).click();
  await expect(page.locator('.preview-questions')).toBeVisible();await expect(page.locator('.preview-questions article')).toHaveCount(5);
  await expect(page.getByRole('button',{name:'开始正式练习'})).toHaveCount(0);await expect(page.getByRole('button',{name:'提交整组'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
// Careful reading uses the design-matched workspace on every entry path.
async function questions(page:import('@playwright/test').Page){
  const width=page.viewportSize()?.width??1280;
  if(width<600)await page.getByRole('button',{name:'全屏',exact:true}).click();
  else if(width<1024)await page.getByRole('tab',{name:/题目 ·/}).click();
}
test('complete reading, refresh recovery, evidence, and immutable first score',async({page})=>{
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await page.getByRole('button',{name:'开始阅读'}).click();
  await expect(page).toHaveURL(/\/reading\/[a-f0-9-]+$/);
  const passage=page.locator('.rp-reader-scroll');await expect(passage).toBeVisible();
  await passage.evaluate(el=>{el.scrollTop=300;});await questions(page);
  await expect(page.getByRole('button',{name:'查看原文证据'})).toHaveCount(0);
  await page.getByRole('radio',{name:'B A football competition',exact:true}).check();
  await page.getByRole('button',{name:'标记此题',exact:true}).click();
  await expect.poll(()=>page.request.get(new URL(page.url()).pathname.replace('/reading/','/api/sessions/')).then(r=>r.json()).then(s=>Object.values(s.choices).some((c:any)=>c.answer==='B'&&c.uncertain))).toBe(true);
  await page.reload();await questions(page);
  await expect(page.getByRole('radio',{name:'B A football competition',exact:true})).toBeChecked();
  await expect(page.getByRole('button',{name:'已标记',exact:true})).toHaveAttribute('aria-pressed','true');
  for(let n=52;n<=55;n++){await page.getByRole('button',{name:new RegExp(`第 ${n} 题`)}).click();await page.getByRole('radio',{name:'A A reading experiment',exact:true}).check();}
  await page.getByRole('button',{name:'提交练习',exact:true}).click();await page.getByRole('button',{name:'确认提交',exact:true}).click();
  await expect(page.getByText('成绩已保存',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/第 51 题/}).click();await page.getByRole('button',{name:'查看原文证据',exact:true}).click();
  await expect(page.locator('.evidence-highlight')).toHaveText('Students read complete articles and save their work.');
  await page.getByRole('link',{name:'CET6 Daily',exact:true}).click();await expect(page.locator('.overview-grid').getByText('80%',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'统计',exact:true}).click();await expect(page.getByRole('heading',{name:'学习统计'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('offline draft survives refresh; failed save is explicit and sync resumes',async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'开始阅读'}).click();await questions(page);
  await page.route('**/api/sessions/*',async route=>{if(route.request().method()==='PATCH')await route.abort('internetdisconnected');else await route.continue();});
  await page.getByRole('radio',{name:'C An international journey',exact:true}).check();await expect(page.getByRole('button',{name:'重试云端保存',exact:true})).toBeVisible();
  await page.reload();await questions(page);await expect(page.getByRole('radio',{name:'C An international journey',exact:true})).toBeChecked();
  await page.unroute('**/api/sessions/*');await page.getByRole('button',{name:'重试云端保存',exact:true}).click();
  await expect(page.getByRole('button',{name:'重试云端保存',exact:true})).toHaveCount(0);
});
