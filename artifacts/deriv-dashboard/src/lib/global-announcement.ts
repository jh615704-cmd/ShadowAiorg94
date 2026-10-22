function hashText(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash ^ value.charCodeAt(index), 16_777_619);
  }
  return (hash >>> 0).toString(36);
}

export function createGlobalAnnouncementDismissalKey(viewerId: string, message: string): string {
  const value = `${viewerId.trim()}\u0000${message.trim()}`;
  return `shadow-ai:announcement:v1:${hashText(value, 2_166_136_261)}-${hashText(value, 2_654_435_761)}`;
}
