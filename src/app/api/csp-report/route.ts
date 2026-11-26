import { NextRequest, NextResponse } from 'next/server';
import { isCspReportContentType, parseCspReport } from '@/lib/security-headers';

/**
 * Collects report-only CSP violations (issue #495). Workers capture console
 * output in their logs, so a tiny logging endpoint is enough to observe real
 * violations before considering an enforcing CSP. Reports are untrusted input:
 * only a few short string fields are logged, nothing is stored or echoed.
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type');
  if (!isCspReportContentType(contentType)) {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_report' }, { status: 400 });
  }

  const report = parseCspReport(body);
  if (!report) {
    return NextResponse.json({ error: 'invalid_report' }, { status: 400 });
  }

  console.warn('[csp-report]', JSON.stringify(report));
  return new NextResponse(null, { status: 204 });
}
