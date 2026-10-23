import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createBudget } from './call-budget.mjs';

test('counts calls as they are spent', () => {
  const budget = createBudget(10, 0);
  budget.spend();
  budget.spend();
  assert.equal(budget.used(), 2);
  assert.equal(budget.remaining(), 8);
});

test('starts from calls another source already spent', () => {
  // The whole point: BuyMe having spent 3000 must leave Tav 2000, not 5000.
  const budget = createBudget(5000, 3000);
  assert.equal(budget.used(), 3000);
  assert.equal(budget.remaining(), 2000);
});

test('throws at the ceiling rather than billing', () => {
  const budget = createBudget(2, 0);
  budget.spend();
  budget.spend();
  assert.throws(() => budget.spend(), /budget/i);
});

test('a ceiling already exceeded refuses the first call', () => {
  const budget = createBudget(100, 100);
  assert.throws(() => budget.spend(), /budget/i);
  assert.equal(budget.remaining(), 0);
});

test('remaining never goes negative', () => {
  const budget = createBudget(5, 9);
  assert.equal(budget.remaining(), 0);
});

test('rejects a nonsensical ceiling', () => {
  assert.throws(() => createBudget(0, 0), /ceiling/i);
  assert.throws(() => createBudget(-1, 0), /ceiling/i);
});
