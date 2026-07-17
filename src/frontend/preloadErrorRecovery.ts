const PRELOAD_ERROR_STORAGE_KEY = 'marketdesk:last-preload-error';

interface PreloadErrorEvent extends Event {
  payload?: unknown;
}

interface PreloadRecoveryOptions {
  target?: EventTarget;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  reload?: () => void;
}

function preloadErrorSignature(payload: unknown): string {
  if (payload instanceof Error && payload.message) return payload.message;
  if (typeof payload === 'string' && payload) return payload;
  return 'unknown-vite-preload-error';
}

/**
 * Refreshes an already-open tab once when a deployment removes one of the
 * previous build's hashed lazy chunks. Vite emits `vite:preloadError` before
 * the rejected dynamic import reaches React.
 */
export function installPreloadErrorRecovery(options: PreloadRecoveryOptions = {}): () => void {
  const target = options.target ?? window;
  const storage = options.storage ?? window.sessionStorage;
  const reload = options.reload ?? (() => window.location.reload());

  const handlePreloadError = (rawEvent: Event) => {
    const event = rawEvent as PreloadErrorEvent;
    const signature = preloadErrorSignature(event.payload);

    // If the same asset still fails after a refresh, surface the real error
    // instead of creating an infinite reload loop.
    if (storage.getItem(PRELOAD_ERROR_STORAGE_KEY) === signature) return;

    event.preventDefault();
    storage.setItem(PRELOAD_ERROR_STORAGE_KEY, signature);
    reload();
  };

  target.addEventListener('vite:preloadError', handlePreloadError);
  return () => target.removeEventListener('vite:preloadError', handlePreloadError);
}

export { PRELOAD_ERROR_STORAGE_KEY };
