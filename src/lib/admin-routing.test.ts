import assert from 'node:assert/strict';
import test from 'node:test';
import { buildAdminUrl, viewFromAdminPathname } from './admin-routing.ts';

test('admin paths map to the correct internal tab', () => {
  assert.equal(viewFromAdminPathname('/admin/todo'), 'queue');
  assert.equal(viewFromAdminPathname('/admin/content'), 'content');
  assert.equal(viewFromAdminPathname('/admin/users'), 'people');
  assert.equal(viewFromAdminPathname('/admin/system'), 'system');
});

test('admin root and unknown paths fall back to todo', () => {
  assert.equal(viewFromAdminPathname('/admin'), 'queue');
  assert.equal(viewFromAdminPathname('/admin/not-a-tab'), 'queue');
});

test('admin tab identity is encoded in the path, not query', () => {
  assert.equal(buildAdminUrl('queue'), '/admin/todo');
  assert.equal(buildAdminUrl('content'), '/admin/content');
  assert.equal(buildAdminUrl('people'), '/admin/users');
  assert.equal(buildAdminUrl('system'), '/admin/system');
  assert.equal(
    buildAdminUrl('content', new URLSearchParams({ q: '夜', status: 'public' })),
    '/admin/content?q=%E5%A4%9C&status=public',
  );
});
