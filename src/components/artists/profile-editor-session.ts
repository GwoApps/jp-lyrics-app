/** A successful server write must never settle UI belonging to a later open session. */
export function createProfileEditorSessionGuard() {
  let active: object | null = null;
  return {
    enter() { const token = {}; active = token; return token; },
    capture() { return active; },
    isCurrent(token: object | null) { return token !== null && token === active; },
    leave(token: object) { if (active === token) active = null; },
  };
}
