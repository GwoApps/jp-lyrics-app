import assert from 'node:assert/strict';
import test from 'node:test';
import { createProfileEditorSessionGuard } from './profile-editor-session.ts';

test('an older artist write finishes its readback without mutating or closing a newer editor', async () => {
  const sessions = createProfileEditorSessionGuard();
  const a = sessions.enter();
  let finish!: () => void;
  const pending = new Promise<void>((resolve) => { finish = resolve; });
  let readbacks = 0; let callbacks = 0;
  const write = (async () => { await pending; readbacks++; if (sessions.isCurrent(a)) callbacks++; })();
  const b = sessions.enter();
  sessions.leave(a);
  finish(); await write;
  assert.equal(readbacks, 1); assert.equal(callbacks, 0);
  assert.equal(sessions.isCurrent(b), true);
  sessions.leave(b);
  assert.equal(sessions.isCurrent(b), false);
});
