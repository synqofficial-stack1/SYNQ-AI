type AnalyticsListener = () => void;

const listeners = new Set<AnalyticsListener>();

/** Notify visible analytics views after a task, chat turn, or call is saved. */
export function subscribeAnalytics(listener: AnalyticsListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notifyAnalyticsChanged(): void {
  listeners.forEach((listener) => listener());
}
