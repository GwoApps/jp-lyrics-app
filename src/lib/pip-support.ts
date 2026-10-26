export interface PiPCapabilities {
  document: boolean;
  video: boolean;
  canvasCapture: boolean;
}

/** Report browser API availability. This does not guarantee the OS will allow PiP at runtime. */
export function getPiPCapabilities(): PiPCapabilities {
  if (typeof window === 'undefined') {
    return { document: false, video: false, canvasCapture: false };
  }

  const pipWindow = window as Window & {
    documentPictureInPicture?: { requestWindow?: unknown };
  };
  const document = typeof pipWindow.documentPictureInPicture?.requestWindow === 'function';
  const canvasCapture = typeof HTMLCanvasElement !== 'undefined'
    && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  if (typeof HTMLVideoElement === 'undefined') return { document, video: false, canvasCapture };

  const videoPrototype = HTMLVideoElement.prototype as HTMLVideoElement & {
    webkitSupportsPresentationMode?: unknown;
    webkitSetPresentationMode?: unknown;
  };
  const standardVideoPiP = window.document.pictureInPictureEnabled !== false
    && typeof HTMLVideoElement.prototype.requestPictureInPicture === 'function';
  const webKitVideoPiP = typeof videoPrototype.webkitSupportsPresentationMode === 'function'
    && typeof videoPrototype.webkitSetPresentationMode === 'function';

  return { document, video: standardVideoPiP || webKitVideoPiP, canvasCapture };
}
