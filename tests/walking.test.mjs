import assert from 'node:assert/strict'
import { test } from 'node:test'
import { evaluateWalk } from '../src/services/walking.service.ts'

test('checks both per-leg and daily walking limits', () => {
  const legs = [11, 13, 20].map((minutes) => ({ fromId: 'a', toId: 'b', minutes, meters: 100 }))
  assert.equal(evaluateWalk(legs, 12, 50, 3), 'over')
  const daily = [10, 12, 12, 11, 9].map((minutes) => ({ fromId: 'a', toId: 'b', minutes, meters: 100 }))
  assert.equal(evaluateWalk(daily, 12, 50, 5), 'over')
  assert.equal(evaluateWalk(legs, 20, 50, 3), 'within')
})

test('never calls an incomplete route compliant', () => {
  assert.equal(evaluateWalk([], 12, 50, 2), 'unverified')
  assert.equal(evaluateWalk([{ fromId: 'a', toId: 'b', minutes: 5, meters: 200 }], 12, 50, 2), 'unverified')
  assert.equal(evaluateWalk([{ fromId: 'a', toId: 'b', minutes: 5, meters: 200 }], 0, 50, 1), 'unverified')
})
