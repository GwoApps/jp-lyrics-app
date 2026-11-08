import test from 'node:test';
import assert from 'node:assert/strict';
import { formatDbDate, formatDbDateTime, parseDbTimestamp } from './db-time.ts';
import { nowUtcOffsetSql, nowUtcSql } from './db-time-sql.ts';

// Node caches the process time zone after first use, so visitor zones are
// simulated through Intl's explicit `timeZone` option instead of `TZ`.

test('naive database values are read as UTC; ISO and offset values pass through', () => {
  assert.equal(parseDbTimestamp('2026-09-26 12:00:00')?.toISOString(), '2026-09-26T12:00:00.000Z');
  assert.equal(parseDbTimestamp('2026-09-26T12:00:00.000Z')?.toISOString(), '2026-09-26T12:00:00.000Z');
  assert.equal(parseDbTimestamp('2026-09-26T20:00:00+08:00')?.toISOString(), '2026-09-26T12:00:00.000Z');
  assert.equal(parseDbTimestamp('2026-09-26T12:00:00.123Z')?.toISOString(), '2026-09-26T12:00:00.123Z');
});

test('a bare date is anchored to UTC midnight so it survives every zone', () => {
  assert.equal(parseDbTimestamp('2026-09-26')?.toISOString(), '2026-09-26T00:00:00.000Z');
  assert.equal(formatDbDate('2026-09-26', 'en', { dateStyle: 'medium', timeZone: 'Asia/Shanghai' }), 'Sep 26, 2026');
});

test('unusable values parse to null instead of an Invalid Date', () => {
  for (const value of ['', '   ', 'not a date', null, undefined, 'invalid']) {
    assert.equal(parseDbTimestamp(value), null, `expected null for ${JSON.stringify(value)}`);
  }
  assert.equal(formatDbDate('nonsense', 'en'), null);
  assert.equal(formatDbDateTime(undefined, 'en'), null);
});

test('one stored instant, one absolute instant — the value is never shifted twice', () => {
  const stored = '2026-09-26 12:00:00'; // UTC, written while no process set TZ
  for (const zone of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
    assert.equal(parseDbTimestamp(stored)?.toISOString(), '2026-09-26T12:00:00.000Z', zone);
    assert.equal(
      formatDbDateTime(stored, 'sv-SE', { timeZone: zone }),
      formatDbDateTime('2026-09-26T12:00:00.000Z', 'sv-SE', { timeZone: zone }),
      zone,
    );
  }
});

test('a UTC+8 visitor sees 20:00 for a 12:00Z row instead of 12:00 (8 hours early)', () => {
  // The old behaviour parsed the naive string as the visitor's local clock, so
  // a Shanghai browser rendered "12:00" — eight hours before the real instant.
  const stored = '2026-09-26 12:00:00';
  const clock = (timeZone: string) => formatDbDateTime(stored, 'en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false });
  assert.equal(clock('Asia/Shanghai'), '20:00');
  assert.equal(clock('UTC'), '12:00');
  assert.equal(clock('America/New_York'), '08:00');
});

test('formatting defaults to the visitor zone, not a hard-coded one', () => {
  const ambient = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(
    formatDbDateTime('2026-11-02 16:25:33', 'en'),
    formatDbDateTime('2026-11-02 16:25:33', 'en', { timeZone: ambient }),
  );
});

test('nowUtcSql writes the same shape as Date#toISOString', () => {
  const query = (fragment: unknown) => (fragment as { toQuery: (o: unknown) => { sql: string; params: unknown[] } })
    .toQuery({ escapeName: (n: string) => n, escapeParam: () => '?', escapeString: (s: string) => s, casing: { getColumnCasing: (c: string) => c } });
  assert.equal(query(nowUtcSql()).sql, "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))");
  const offset = query(nowUtcOffsetSql('-30 minutes'));
  assert.equal(offset.sql, "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))");
  assert.deepEqual(offset.params, ['-30 minutes']);
  // A JS-written timestamp is byte-compatible with the SQL one: sortable as a
  // string, and parseable by the same reader.
  const iso = new Date().toISOString();
  assert.match(iso, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  assert.equal(parseDbTimestamp(iso)?.toISOString(), iso);
});
