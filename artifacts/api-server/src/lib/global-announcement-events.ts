export type GlobalAnnouncementEvent = {
  enabled: boolean;
  message: string;
  revision: string;
};

type Listener = (event: GlobalAnnouncementEvent) => void;
const listeners = new Set<Listener>();

export function subscribeGlobalAnnouncements(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishGlobalAnnouncement(event: GlobalAnnouncementEvent) {
  for (const listener of listeners) listener(event);
}
