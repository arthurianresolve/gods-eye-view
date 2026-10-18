import test from 'node:test';
import assert from 'node:assert/strict';
import { getLocale, prepareLocale, setLocale, t } from './index.js';

await Promise.all([prepareLocale('es'), prepareLocale('ru')]);
test.afterEach(() => setLocale('en'));

test('latest repeated pending locale wins an es to ru to es race', async () => {
  let resolveEs;
  let resolveRu;
  const esLoad = new Promise((resolve) => {
    resolveEs = resolve;
  });
  const ruLoad = new Promise((resolve) => {
    resolveRu = resolve;
  });
  const loaders = { es: () => esLoad, ru: () => ruLoad };
  const firstEs = prepareLocale('es', { force: true, loaders });
  const ru = prepareLocale('ru', { force: true, loaders });
  const repeatedEs = prepareLocale('es', { force: true, loaders });
  assert.strictEqual(firstEs, repeatedEs, 'same pending locale must coalesce');
  assert.equal(getLocale(), 'es', 'repeated request is the latest preference');
  resolveRu({ default: { 'POWERED UP': 'RU' } });
  await ru;
  assert.equal(getLocale(), 'es', 'stale ru completion cannot retake the UI');
  resolveEs({ default: { 'POWERED UP': 'ES' } });
  await firstEs;
  assert.equal(t('POWERED UP'), 'ES');
});
