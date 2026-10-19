import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mergeFootprints, parseTimelineExport } from '../src/services/footprint.service.ts'
import { buildGoogleDirectionsUrl, buildGoogleMapsCoordinateUrl, buildTripMapSearchUrl, isChinaTrip } from '../src/services/map.service.ts'

const range = { startDate: '2026-12-04', endDate: '2026-12-07', timeZone: 'Asia/Tokyo' }

test('parses semantic timeline visits within the trip dates', () => {
  const data = [
    {
      startTime: '2026-12-05T01:00:00+09:00',
      endTime: '2026-12-05T02:00:00+09:00',
      visit: { topCandidate: { placeLocation: 'geo:26.5049491,127.8501455' } },
    },
    {
      startTime: '2026-11-30T01:00:00+09:00',
      endTime: '2026-11-30T02:00:00+09:00',
      visit: { topCandidate: { placeLocation: 'geo:26.1,127.1' } },
    },
  ]
  const result = parseTimelineExport(data, range)
  assert.equal(result.length, 1)
  assert.equal(result[0].coordinates, '127.8501455,26.5049491')
})

test('parses wrapped timelineObjects and legacy Records locations', () => {
  const wrapped = parseTimelineExport({
    timelineObjects: [{
      startTime: '2026-12-06T01:00:00+09:00',
      endTime: '2026-12-06T01:30:00+09:00',
      visit: { topCandidate: { placeLocation: 'geo:26.7,128.0' } },
    }],
  }, range)
  assert.equal(wrapped.length, 1)

  const legacy = parseTimelineExport({
    locations: [{ latitudeE7: 265049491, longitudeE7: 1278501455, timestampMs: String(Date.parse('2026-12-05T03:00:00Z')) }],
  }, range)
  assert.equal(legacy.length, 1)
  assert.equal(legacy[0].coordinates, '127.8501455,26.5049491')
})

test('rejects unknown timeline formats', () => {
  assert.throws(() => parseTimelineExport({ foo: 1 }, range), /無法辨識/)
})

test('merges footprints without duplicates', () => {
  const first = parseTimelineExport({
    timelineObjects: [{
      startTime: '2026-12-06T01:00:00+09:00',
      endTime: '2026-12-06T01:30:00+09:00',
      visit: { topCandidate: { placeLocation: 'geo:26.7,128.0' } },
    }],
  }, range)
  assert.equal(mergeFootprints(first, first).length, 1)
})

test('builds Google directions links without computed distance', () => {
  const url = new URL(buildGoogleDirectionsUrl('萬座毛', '古宇利島', 'transit'))
  assert.equal(url.hostname, 'www.google.com')
  assert.equal(url.searchParams.get('origin'), '萬座毛')
  assert.equal(url.searchParams.get('destination'), '古宇利島')
  assert.equal(url.searchParams.get('travelmode'), 'transit')
})

test('builds Google coordinate links in lat,lng order', () => {
  const url = new URL(buildGoogleMapsCoordinateUrl('127.8501455,26.5049491'))
  assert.equal(url.searchParams.get('query'), '26.5049491,127.8501455')
})

test('China trips keep AMap and do not use Google links', () => {
  assert.equal(isChinaTrip('中國'), true)
  const url = buildTripMapSearchUrl({ country: '中國', destination: '上海' }, '外灘', '')
  assert.equal(url.includes('google.com'), false)
})
