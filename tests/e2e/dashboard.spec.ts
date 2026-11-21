import { expect, test } from '@playwright/test';
import { sampleEvidence } from '../fixtures.ts';

test('frontend rendering regression: incident inbox heading is visible', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Incidents', exact: true }), 'RG_FRONTEND_RENDER').toBeVisible();
});

test('imports evidence and downloads the resulting task', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('API connected')).toBeVisible();
  await page.getByRole('button', { name: 'Import evidence' }).click();
  await page.getByLabel('Evidence JSON').setInputFiles({
    name: 'test-evidence.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(sampleEvidence({ logs: ['RG_API_CONTRACT', 'password=do-not-display'] }))),
  });
  await page.getByRole('button', { name: 'Queue evidence' }).click();
  const detail = page.getByRole('article', { name: 'Incident detail' });
  await expect(detail.getByText('API response schema check')).toBeVisible();
  await expect(detail.getByText(/password=\[REDACTED\]/)).toBeVisible();
  await expect(detail.getByText('do-not-display')).toHaveCount(0);
  await detail.getByRole('button', { name: 'Engineering task' }).click();
  await expect(detail.getByText('Add a repository policy', { exact: false })).toBeVisible();
  const download = page.waitForEvent('download');
  await detail.getByRole('button', { name: 'Download JSON' }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^rg-[a-f0-9]{24}-task\.json$/);
  const stream = await file.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  expect(JSON.parse(Buffer.concat(chunks).toString())).toMatchObject({
    baseCommit: 'a'.repeat(40), approvedPaths: [], state: 'blocked',
  });
  await page.getByRole('searchbox', { name: 'Search incidents' }).or(page.getByRole('textbox', { name: 'Search incidents' })).fill('missing-target');
  await expect(page.getByRole('heading', { name: 'No matching incidents' })).toBeVisible();
});

test('rejects malformed imports and cross-origin submission', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByText('API connected')).toBeVisible();
  await page.getByRole('button', { name: 'Import evidence' }).click();
  await page.getByLabel('Evidence JSON').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{}'),
  });
  await page.getByRole('button', { name: 'Queue evidence' }).click();
  await expect(page.getByRole('dialog', { name: 'Import evidence' }).getByRole('alert')).toHaveText('Evidence did not match the version 1 contract.');
  const denied = await request.post('/api/evidence', {
    data: sampleEvidence(),
    headers: { Origin: 'https://example.invalid' },
  });
  expect(denied.status()).toBe(403);
});
