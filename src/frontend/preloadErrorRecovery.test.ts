import {
  installPreloadErrorRecovery,
  PRELOAD_ERROR_STORAGE_KEY,
} from './preloadErrorRecovery';

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function preloadError(message: string): Event & { payload: Error } {
  const event = new Event('vite:preloadError', { cancelable: true }) as Event & { payload: Error };
  event.payload = new Error(message);
  return event;
}

describe('installPreloadErrorRecovery', () => {
  it('prevents the stale import failure and reloads once for a new chunk signature', () => {
    const target = new EventTarget();
    const storage = new MemoryStorage();
    const reload = jest.fn();
    installPreloadErrorRecovery({ target, storage, reload });

    const event = preloadError('Failed to fetch dynamically imported module: /assets/ProductsPage-old.js');
    target.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(PRELOAD_ERROR_STORAGE_KEY)).toContain('ProductsPage-old.js');
  });

  it('does not loop when the same chunk still fails after the refresh', () => {
    const target = new EventTarget();
    const storage = new MemoryStorage();
    const reload = jest.fn();
    installPreloadErrorRecovery({ target, storage, reload });

    target.dispatchEvent(preloadError('Failed to fetch: /assets/ProductsPage-old.js'));
    const repeatedEvent = preloadError('Failed to fetch: /assets/ProductsPage-old.js');
    target.dispatchEvent(repeatedEvent);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(repeatedEvent.defaultPrevented).toBe(false);
  });

  it('allows recovery for a different stale chunk and unregisters cleanly', () => {
    const target = new EventTarget();
    const storage = new MemoryStorage();
    const reload = jest.fn();
    const uninstall = installPreloadErrorRecovery({ target, storage, reload });

    target.dispatchEvent(preloadError('Failed to fetch: /assets/ProductsPage-old.js'));
    target.dispatchEvent(preloadError('Failed to fetch: /assets/SettingsPage-newer.js'));
    expect(reload).toHaveBeenCalledTimes(2);

    uninstall();
    target.dispatchEvent(preloadError('Failed to fetch: /assets/AnalyticsPage-newest.js'));
    expect(reload).toHaveBeenCalledTimes(2);
  });
});
