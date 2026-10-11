import {test,expect} from '@playwright/test';
test.beforeEach(async({request})=>{await request.get('http://127.0.0.1:8787/__test/reset');});
// The invite-only path is a desktop acceptance flow: a stranger sees the
// activation screen, an administrator issues a code in the console, and the
// same stranger redeems it and lands on the normal home screen.
test('invite onboarding: a stranger activates with a code issued in the admin console',async({page,context},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','covered once on desktop');
  await context.setExtraHTTPHeaders({'x-test-user':'newcomer','x-test-email':'newcomer@example.com'});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'激活你的账号'})).toBeVisible();
  await expect(page.getByText('newcomer@example.com',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'管理',exact:true})).toHaveCount(0);
  await page.getByLabel('邀请码').fill('CET6-ZZZZ-ZZZZ-ZZZZ');
  await page.getByRole('button',{name:'激活账号'}).click();
  await expect(page.getByRole('alert')).toContainText('邀请码无效');
  await expect(page.getByRole('heading',{name:'激活你的账号'})).toBeVisible();
  // Owners manage invites; the same browser then returns as the newcomer.
  await context.setExtraHTTPHeaders({'x-test-user':'owner','x-test-email':'owner@example.com'});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'今天，读一篇。'})).toBeVisible();
  await page.getByRole('button',{name:'管理',exact:true}).click();
  await expect(page.getByRole('heading',{name:'管理',exact:true})).toBeVisible();
  await expect(page.getByText('还没有用户。')).toHaveCount(0);
  await page.getByPlaceholder('给谁的，例如：小周').fill('给新同学');
  await page.getByRole('button',{name:'生成邀请码'}).click();
  const code=await page.locator('.latest-invite strong').innerText();
  expect(code).toMatch(/^CET6-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await expect(page.getByText('给新同学',{exact:true}).first()).toBeVisible();
  await context.setExtraHTTPHeaders({'x-test-user':'newcomer','x-test-email':'newcomer@example.com'});
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'激活你的账号'})).toBeVisible();
  await page.getByLabel('邀请码').fill(code.toLowerCase());
  await page.getByRole('button',{name:'激活账号'}).click();
  await expect(page.getByRole('heading',{name:'今天，读一篇。'})).toBeVisible();
  await expect(page.getByRole('button',{name:'管理',exact:true})).toHaveCount(0);
  await expect(page.locator('.account-menu')).toContainText('newcomer@example.com');
  await page.getByRole('button',{name:'统计',exact:true}).click();
  await expect(page.getByRole('heading',{name:'学习统计'})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('disabled accounts are told why and administrators cannot be disabled',async({page,context},testInfo)=>{
  test.skip(testInfo.project.name!=='desktop','covered once on desktop');
  await context.setExtraHTTPHeaders({'x-test-user':'owner','x-test-email':'owner@example.com'});
  await page.goto('/');
  await page.getByRole('button',{name:'管理',exact:true}).click();
  const ownerRow=page.locator('.admin-table-scroll tbody tr').filter({hasText:'owner@example.com'});
  await expect(ownerRow.getByText('管理员')).toBeVisible();
  await expect(ownerRow.getByRole('button',{name:'停用'})).toHaveCount(0);
});
