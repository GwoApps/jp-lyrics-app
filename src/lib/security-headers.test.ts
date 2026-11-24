import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CSP_REPORT_ONLY_VALUE,
  SECURITY_HEADERS,
  isCspReportContentType,
  parseCspReport,
  renderHeadersFile,
  securityHeaders,
} from './security-headers.ts';

const HEADERS_FILE = new URL('../../public/_headers', import.meta.url);
const NEXT_CONFIG = new URL('../../next.config.ts', import.meta.url);

test('baseline security headers cover nosniff, referrer, framing and report-only CSP', () => {
  const byKey = securityHeaders();
  assert.equal(byKey['x-content-type-options'], 'nosniff');
  assert.equal(byKey['referrer-policy'], 'strict-origin-when-cross-origin');
  assert.equal(byKey['x-frame-options'], 'SAMEORIGIN');
  assert.equal(byKey['content-security-policy-report-only'], CSP_REPORT_ONLY_VALUE);
  assert.ok(!('content-security-policy' in byKey), 'CSP must stay report-only');
});

test('report-only CSP keeps inline scripts/styles and allows fonts/images but blocks framing', () => {
  assert.match(CSP_REPORT_ONLY_VALUE, /script-src[^;]*'unsafe-inline'/);
  assert.match(CSP_REPORT_ONLY_VALUE, /style-src[^;]*'unsafe-inline'/);
  assert.match(CSP_REPORT_ONLY_VALUE, /img-src[^;]*blob:/);
  assert.match(CSP_REPORT_ONLY_VALUE, /font-src[^;]*https:/);
  assert.match(CSP_REPORT_ONLY_VALUE, /frame-ancestors 'self'/);
  assert.match(CSP_REPORT_ONLY_VALUE, /report-uri \/api\/csp-report/);
});

test('renderHeadersFile emits one indented line per header under each rule', () => {
  const text = renderHeadersFile(['/_next/static/*', '', '/']);
  assert.ok(text.startsWith('/_next/static/*\n\n'));
  for (const { key, value } of SECURITY_HEADERS) {
    assert.ok(text.includes(`  ${key}: ${value}\n`), `missing ${key}`);
  }
});

test('public/_headers applies security headers to static assets and all pages', () => {
  const content = readFileSync(HEADERS_FILE, 'utf8');
  const staticRule = content.split(/\n\s*#/).find((block) => block.includes('/_next/static/*')) ?? '';
  const allRule = content.slice(content.lastIndexOf('/*'));
  assert.ok(staticRule, 'static asset rule missing');
  assert.ok(allRule, 'all-paths rule missing');
  for (const { key, value } of SECURITY_HEADERS) {
    assert.ok(staticRule!.includes(`  ${key}: ${value}`), `static rule missing ${key}`);
    assert.ok(allRule!.includes(`  ${key}: ${value}`), '/* rule missing ' + key);
  }
});

test('next.config.ts applies the security header set to every route', () => {
  const config = readFileSync(NEXT_CONFIG, 'utf8');
  assert.match(config, /import\s+.*SECURITY_HEADERS.*from\s+['"]@\/lib\/security-headers['"]/);
  assert.match(config, /source:\s*['"]\/:path\*['"]/);
  assert.match(config, /headers:\s*SECURITY_HEADERS/);
});

test('CSP report content type detection accepts both report formats', () => {
  assert.ok(isCspReportContentType('application/csp-report'));
  assert.ok(isCspReportContentType('application/csp-report; charset=utf-8'));
  assert.ok(isCspReportContentType('application/reports+json'));
  assert.ok(!isCspReportContentType('application/json'));
  assert.ok(!isCspReportContentType(null));
});

test('CSP report parsing extracts only short string fields', () => {
  const report = parseCspReport({
    'csp-report': {
      'document-uri': 'https://example.com/songs/1',
      'violated-directive': 'script-src-elem',
      'blocked-uri': 'https://evil.test/x.js',
      'line-number': 12,
      'original-policy': 'x'.repeat(900),
    },
  });
  assert.deepEqual(report, {
    documentUri: 'https://example.com/songs/1',
    directive: 'script-src-elem',
    blockedUri: 'https://evil.test/x.js',
    originalPolicy: 'x'.repeat(500),
  });
  assert.equal(parseCspReport(null), null);
  assert.equal(parseCspReport({ unrelated: true }), null);
});
