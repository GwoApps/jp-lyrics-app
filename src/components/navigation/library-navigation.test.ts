import assert from 'node:assert/strict';
import test from 'node:test';
import { isLibraryNavigation, startRouteViewTransition } from './library-navigation.ts';

test('only distinct top-level song, album and artist lists get library motion', () => {
  for (const from of ['/', '/albums', '/artists']) for (const to of ['/', '/albums', '/artists']) assert.equal(isLibraryNavigation(from, to), from !== to);
  for (const path of ['/artists/Aimer', '/songs/track', '/admin', '/albums/', '/settings']) {
    assert.equal(isLibraryNavigation('/', path), false);
    assert.equal(isLibraryNavigation(path, '/artists'), false);
  }
});

test('typed native transition is opt-in and old native APIs keep the callback form', () => {
  for (const supported of [true, false]) {
    let supplied: ViewTransitionUpdateCallback | StartViewTransitionOptions | undefined;
    const transition = { ready: Promise.resolve(), finished: Promise.resolve() };
    const doc = { defaultView: { CSS: { supports: () => supported } }, querySelector: () => null, startViewTransition: (options: typeof supplied) => { supplied = options; return transition; } } as unknown as Document;
    const update = () => {};
    assert.equal(startRouteViewTransition(doc, update, '/', '/albums'), transition);
    if (supported) { assert.deepEqual((supplied as StartViewTransitionOptions).types, ['library-navigation']); assert.equal((supplied as StartViewTransitionOptions).update, update); }
    else assert.equal(supplied, update);
    startRouteViewTransition(doc, update, '/artists', '/artists/Aimer');
    assert.equal(supplied, update);
  }
});
