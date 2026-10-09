import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.get('http://127.0.0.1:8787/__test/reset');});
test('complete reading, refresh recovery, evidence, and immutable first score',async({page})=>{
  const isMobile=(page.viewportSize()?.width??1000)<=700;
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/');await expect(page.getByRole('heading',{name:'今天，读一篇。'})).toBeVisible();
  await expect(page.getByText('测试专用合成文章 · 非六级真题',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'开始阅读'}).click();
  const passage=page.locator('.passage-scroll');await expect(passage).toBeVisible();
  await passage.evaluate(el=>{el.scrollTop=300;});
  if(isMobile)await page.getByRole('tab',{name:'回答题目'}).click();
  await expect(page.getByRole('button',{name:'查看解析'})).toHaveCount(0);
  await page.getByRole('button',{name:'B A football competition'}).click();
  await page.getByLabel('这道题不确定，稍后再看').check();
  if(isMobile){await page.getByRole('tab',{name:'阅读文章'}).click();expect(await passage.evaluate(el=>el.scrollTop)).toBeGreaterThan(250);await page.getByRole('tab',{name:'回答题目'}).click();}
  await expect(page.getByRole('status').filter({hasText:'已保存'})).toBeVisible({timeout:12000});
  await page.reload();if(isMobile)await page.getByRole('tab',{name:'回答题目'}).click();
  await expect(page.getByRole('button',{name:'B A football competition'})).toHaveAttribute('aria-pressed','true');await expect(page.getByLabel('这道题不确定，稍后再看')).toBeChecked();
  for(let n=52;n<=55;n++){await page.getByRole('button',{name:`第 ${n} 题`,exact:true}).click();await page.getByRole('button',{name:'A A reading experiment'}).click();}
  await page.getByRole('button',{name:'提交整组'}).click();await page.getByRole('button',{name:'确认提交'}).click();
  await expect(page.getByRole('heading',{name:'4 / 5 题正确'})).toBeVisible();
  await page.getByRole('button',{name:'查看第 51 题结果'}).click();await page.getByRole('button',{name:'查看解析'}).click();
  await page.getByRole('button',{name:/段落 1 · 定位原文/}).click();
  await expect(page.locator('mark')).toHaveText('Students read complete articles and save their work.');
  await page.getByRole('button',{name:'← 今日'}).click();await expect(page.locator('.overview-grid').getByText('80%',{exact:true}).first()).toBeVisible();
  await page.getByRole('button',{name:'统计',exact:true}).click();await expect(page.getByRole('heading',{name:'学习统计'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);expect(errors).toEqual([]);
});
test('offline draft survives refresh; failed save is explicit and sync resumes',async({page})=>{
  const isMobile=(page.viewportSize()?.width??1000)<=700;
  await page.goto('/');await page.getByRole('button',{name:'开始阅读'}).click();if(isMobile)await page.getByRole('tab',{name:'回答题目'}).click();
  await page.route('**/api/sessions/*',async route=>{if(route.request().method()==='PATCH')await route.abort('internetdisconnected');else await route.continue();});
  await page.getByRole('button',{name:'C An international journey'}).click();await expect(page.getByText('保存失败 · 本机保留')).toBeVisible();
  await page.reload();if(isMobile)await page.getByRole('tab',{name:'回答题目'}).click();await expect(page.getByRole('button',{name:'C An international journey'})).toHaveAttribute('aria-pressed','true');
  await page.unroute('**/api/sessions/*');await page.getByRole('button',{name:'重新保存'}).click();await expect(page.getByRole('status').filter({hasText:'已保存'})).toBeVisible({timeout:12000});
});
