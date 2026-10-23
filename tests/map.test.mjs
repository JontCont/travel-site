import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildGoogleDirectionsUrl, buildTripMapSearchUrl, isChinaTrip } from '../src/services/map.service.ts'

test('builds Google directions links without computed distance', () => {
  const url = new URL(buildGoogleDirectionsUrl('萬座毛', '古宇利島', 'transit'))
  assert.equal(url.hostname, 'www.google.com')
  assert.equal(url.searchParams.get('origin'), '萬座毛')
  assert.equal(url.searchParams.get('destination'), '古宇利島')
  assert.equal(url.searchParams.get('travelmode'), 'transit')
})

test('China trips keep AMap and do not use Google links', () => {
  assert.equal(isChinaTrip('中國'), true)
  const url = buildTripMapSearchUrl({ country: '中國', destination: '上海' }, '外灘', '')
  assert.equal(url.includes('google.com'), false)
})
