/**
 * Whether an activated service worker should interrupt the reader with the
 * "new version available" toast.
 *
 * The first install also ends in `activated`, but nothing changed for the user
 * — an interrupting banner there is pure noise. `hadController` is
 * `navigator.serviceWorker.controller !== null` *at registration time*: it is
 * only truthy when a worker was already serving this page, which means this
 * activation is an update to an app the user is currently running.
 */
export function shouldAnnounceUpdate(
  workerState: ServiceWorkerState | string,
  hadController: boolean,
): boolean {
  return workerState === 'activated' && hadController;
}
