import assert from "node:assert/strict";
import test from "node:test";
import { createGlobalAnnouncementDismissalKey } from "./global-announcement.ts";

test("announcement dismissal keys are stable for a user and message", () => {
  const key = createGlobalAnnouncementDismissalKey("access-key-1", "Update complete.", "broadcast-1");
  assert.equal(key, createGlobalAnnouncementDismissalKey("access-key-1", "Update complete.", "broadcast-1"));
  assert.equal(key, createGlobalAnnouncementDismissalKey(" access-key-1 ", " Update complete. ", " broadcast-1 "));
});

test("announcement dismissal keys change for a different user, message, or broadcast", () => {
  const key = createGlobalAnnouncementDismissalKey("access-key-1", "Update complete.", "broadcast-1");
  assert.notEqual(key, createGlobalAnnouncementDismissalKey("access-key-2", "Update complete.", "broadcast-1"));
  assert.notEqual(key, createGlobalAnnouncementDismissalKey("access-key-1", "New feature available.", "broadcast-1"));
  assert.notEqual(key, createGlobalAnnouncementDismissalKey("access-key-1", "Update complete.", "broadcast-2"));
});
