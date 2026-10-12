import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.get(`http://127.0.0.1:${process.env.TEST_API_PORT??8787}/__test/reset`);});
test('system theme, live changes, manual override and refresh',async({page})=>{
 await page.emulateMedia({colorScheme:'light'});await page.goto('/');await expect(page.getByLabel('主题模式')).toHaveValue('system');await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('.app-shell')).toHaveAttribute('data-theme','dark');await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content','#191b1e');
 await page.getByLabel('主题模式').selectOption('light');await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','light');await expect(page.getByLabel('主题模式')).toHaveValue('light');
 await page.getByLabel('主题模式').selectOption('dark');await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 const colors=await page.evaluate(()=>['html','body','#root','.app-shell'].map(s=>getComputedStyle(document.querySelector(s)!).backgroundColor));expect(new Set(colors).size).toBe(1);
 await page.getByLabel('主题模式').selectOption('system');await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.getByRole('button',{name:'开始阅读'}).click();await expect(page.locator('.reading-prototype')).toBeVisible();await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('.reading-prototype')).toHaveAttribute('data-theme','dark');
});
test('exam setting survives refresh and both exams retain resumable sessions',async({page})=>{
 await page.goto('/');await page.getByRole('button',{name:'开始阅读'}).click();await expect(page).toHaveURL(/#session=/);await expect(page.locator('.reading-prototype')).toBeVisible();const cet6=page.url();await page.goto('/');
 await page.getByLabel('每日考试类型').selectOption('JLPT_N1');await expect(page.getByRole('heading',{name:'N1 daily synthetic reading'})).toBeVisible();await page.reload();await expect(page.getByLabel('每日考试类型')).toHaveValue('JLPT_N1');
 await page.getByRole('button',{name:'开始阅读'}).click();await expect(page.locator('.reading-prototype')).toBeVisible();const n1=page.url();expect(n1).not.toBe(cet6);
 await page.goto('/');await page.getByLabel('每日考试类型').selectOption('CET6');await expect(page.locator('.resume-row')).toHaveCount(2);await page.locator('.resume-row').filter({hasText:'测试专用合成文章'}).getByRole('button',{name:'继续练习'}).click();await expect(page.locator('.reading-prototype')).toBeVisible();await expect(page).toHaveURL(cet6);
});

test('percentages share a right edge at every viewport and navigation remains usable',async({page})=>{
 await page.route('**/api/dashboard',async route=>{const response=await route.fetch();const d=await response.json();d.stats.by_kind=[{kind:'careful',count:5,correct:2},{kind:'cloze',count:20,correct:13},{kind:'jlpt_reading',count:100,correct:100}];await route.fulfill({response,json:d});});
 await page.goto('/');await expect(page.locator('.kind-stat')).toHaveCount(3);
 const rows=await page.locator('.kind-stat strong').evaluateAll(es=>es.map(e=>({text:e.textContent,right:e.getBoundingClientRect().right,numeric:getComputedStyle(e).fontVariantNumeric})));
 expect(rows.map(r=>r.text)).toEqual(['40%','65%','100%']);expect(new Set(rows.map(r=>r.right)).size).toBe(1);expect(rows.every(r=>r.numeric==='tabular-nums')).toBe(true);
 for(const name of ['题库','统计','笔记','管理','今日']){await page.getByRole('button',{name,exact:true}).click();await expect(page.locator('main.dashboard')).toBeVisible();}
});

test('logout is a bordered button and requires explicit confirmation',async({page})=>{
 await page.route('**/api/me',async route=>{const response=await route.fetch();const me=await response.json();await route.fulfill({response,json:{...me,logout_url:'/cdn-cgi/access/logout'}});});
 await page.goto('/');const logout=page.getByRole('button',{name:'退出',exact:true});await expect(logout).toBeVisible();expect(await logout.evaluate(e=>getComputedStyle(e).borderTopStyle)).toBe('solid');await logout.click();await expect(page.getByRole('dialog',{name:'退出当前账号？'})).toBeVisible();await page.getByRole('button',{name:'取消',exact:true}).click();await expect(page.getByRole('dialog')).not.toBeVisible();await logout.click();await expect(page.getByRole('link',{name:'确认退出'})).toHaveAttribute('href','/cdn-cgi/access/logout');await page.keyboard.press('Escape');await expect(page.getByRole('dialog')).not.toBeVisible();
});
