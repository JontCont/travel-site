import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineTrip, isWorkspace, listDates, loadWorkspace } from '../src/trips.ts'

function memoryStorage(entries = {}) {
  const data = new Map(Object.entries(entries))
  return { getItem(key) { return data.get(key) ?? null } }
}

function makeTrip(overrides = {}) {
  return defineTrip({
    id: 'beijing-2026',
    title: '北京之旅',
    destination: '北京',
    country: '中國 · 北京',
    startDate: '2026-05-15',
    endDate: '2026-05-20',
    timeZone: 'Asia/Shanghai',
    days: {
      '2026-05-15': [{
        id: 'arrival',
        name: '落地與入境',
        address: '',
        time: '19:30',
        duration: 60,
        durationMax: 75,
        notes: '提取行李',
        coordinates: '',
      }],
    },
    personalItemPieces: 1,
    carryOnPieces: 1,
    carryOnKg: 7,
    checkedBagPieces: 1,
    checkedBagKg: 23,
    ...overrides,
  })
}

test('generates destination-local dates without time-zone shifts', () => {
  assert.deepEqual(listDates('2027-03-13', '2027-03-15'), ['2027-03-13', '2027-03-14', '2027-03-15'])
  assert.deepEqual(listDates('2027-02-29', '2027-03-01'), [])
  assert.deepEqual(listDates('2027-03-28', '2027-03-27'), [])
})

test('validates stop time points, duration ranges, and per-person baggage counts', () => {
  const trip = makeTrip({
    days: {
      '2026-05-15': [{
        id: 'rest',
        name: '返回飯店休息',
        address: '',
        time: '23:00',
        duration: 0,
        notes: '未提供結束時間',
        coordinates: '',
      }],
    },
  })
  assert.equal(trip.days['2026-05-15'][0].duration, 0)
  assert.equal(trip.carryOnPieces, 1)
  assert.equal(trip.carryOnKg, 7)
  assert.throws(() => makeTrip({
    days: {
      '2026-05-15': [{
        id: 'invalid-range',
        name: '景點',
        address: '',
        time: '10:00',
        duration: 90,
        durationMax: 60,
        coordinates: '',
      }],
    },
  }), /資料無效/)
  assert.throws(() => makeTrip({ checkedBagPieces: -1 }), /資料無效/)
})

test('accepts only complete workspaces with one valid active trip', () => {
  const trip = makeTrip()
  assert.equal(isWorkspace({ trips: [trip], activeTripId: trip.id }), true)
  assert.equal(isWorkspace({ trips: [trip], activeTripId: 'missing' }), false)
  assert.equal(isWorkspace({ trips: [trip, trip], activeTripId: trip.id }), false)
})

test('loads an existing browser workspace as a one-time SQLite migration source', () => {
  const trip = makeTrip()
  const workspace = { trips: [trip], activeTripId: trip.id }
  const storage = memoryStorage({ 'travel-planner-v1': JSON.stringify(workspace) })
  assert.deepEqual(loadWorkspace(storage), workspace)
  assert.equal(loadWorkspace(memoryStorage()), null)
})

test('reports malformed browser backups without replacing them', () => {
  assert.throws(() => loadWorkspace(memoryStorage({ 'travel-planner-v1': '{broken' })), /不是有效 JSON/)
  assert.throws(() => loadWorkspace(memoryStorage({
    'travel-planner-v1': JSON.stringify({ trips: [], activeTripId: 'missing' }),
  })), /格式不正確/)
})
