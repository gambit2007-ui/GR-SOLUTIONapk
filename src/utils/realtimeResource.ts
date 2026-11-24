export type DataStatus = 'idle' | 'loading' | 'ready' | 'error';
export interface ResourceSnapshot<T> { data: T; status: DataStatus }
export type ResourceSubscription<T> = (
  onData: (data: T, confirmed?: boolean) => void,
  onError: (error: unknown) => void,
) => () => void;

// Each resource owns its listener. Disposed listeners cannot update a new session.
export const createRealtimeResource = <T>(
  initialData: T, enabled: boolean, start: ResourceSubscription<T>, onError?: (error: unknown) => void,
) => {
  const initial: ResourceSnapshot<T> = { data: initialData, status: enabled ? 'loading' : 'idle' };
  let snapshot = initial;
  let stop: (() => void) | undefined;
  let generation = 0;
  const listeners = new Set<() => void>();
  const publish = (next: ResourceSnapshot<T>) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1 && enabled) {
        const current = ++generation;
        const fail = (error: unknown) => {
          if (current !== generation) return;
          publish({ data: snapshot.data, status: 'error' });
          onError?.(error);
        };
        try {
          stop = start((data, confirmed = true) => {
            if (current === generation) publish({ data, status: confirmed ? 'ready' : 'loading' });
          }, fail);
        } catch (error) { fail(error); }
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          generation += 1;
          stop?.();
          stop = undefined;
          snapshot = initial;
        }
      };
    },
  };
};
