import { test } from 'vitest';
import assert from 'node:assert/strict';
import { formatMB, fmtInt, ago, fmtMonthYear, fmtDate, itemUrl } from './format';

const SCAN = '2026-10-10T09:00:00Z';
const isoAgo = (d: number) => new Date(Date.parse(SCAN) - d * 86400000).toISOString();

test('formatters', () => {
  assert.equal(formatMB(0.5), '0.5 MB');
  assert.equal(formatMB(250), '250 MB');
  assert.equal(formatMB(14.6), '14.6 MB');
  assert.equal(formatMB(9.96), '9.9 MB');
  assert.equal(formatMB(50), '50 MB');
  assert.equal(formatMB(99.99), '99.9 MB');
  assert.equal(formatMB(100), '100 MB');
  assert.equal(formatMB(2048), '2.0 GB');
  assert.equal(fmtInt(12345), '12,345');
  assert.equal(fmtMonthYear('2024-03-15T00:00:00Z'), 'Mar 2024');
  assert.equal(ago(isoAgo(21), Date.parse(SCAN)), '3 weeks ago');
  assert.equal(itemUrl({ urlKey: 'acme' }, 'abc'), 'https://acme.maps.arcgis.com/home/item.html?id=abc');
  assert.equal(itemUrl({ urlKey: 'acme' }, { id: 'abc' }), 'https://acme.maps.arcgis.com/home/item.html?id=abc');
  // a custom base URL, and no urlKey at all (a scan cached before the urlKey was read): never "https://.maps.arcgis.com"
  assert.equal(itemUrl({ urlKey: 'acme', customBaseUrl: 'maps.arcgis.com' }, 'abc'), 'https://acme.maps.arcgis.com/home/item.html?id=abc');
  assert.equal(itemUrl({ urlKey: 'acme', customBaseUrl: 'https://gis.example.org/' }, 'abc'), 'https://acme.gis.example.org/home/item.html?id=abc');
  assert.equal(itemUrl({ urlKey: '' }, 'abc'), 'https://www.arcgis.com/home/item.html?id=abc');
  assert.equal(itemUrl({ urlKey: 'a/b' }, 'abc'), 'https://www.arcgis.com/home/item.html?id=abc');
});

test('fmtDate and ago edge cases', () => {
  assert.equal(fmtDate('2024-03-05T00:00:00Z'), '5 Mar 2024');
  const ref = Date.parse(SCAN);
  assert.equal(ago(isoAgo(0), ref), 'today');
  assert.equal(ago(isoAgo(5), ref), '5 days ago');
  assert.equal(ago(isoAgo(300), ref), '10 months ago');
  assert.equal(ago(isoAgo(730), ref), '2 years ago');
});
