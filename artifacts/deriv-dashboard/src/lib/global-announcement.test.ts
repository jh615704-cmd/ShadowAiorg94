import assert from "node:assert/strict";
import test from "node:test";
import { createGlobalAnnouncementDismissalKey } from "./global-announcement.ts";

test("announcement dismissal keys are stable for a user and message", () => {
  const key = createGlobalAnnouncementDismissalKey("access-key-1", "Update complete.");
  assert.equal(key, createGlobalAnnouncementDismissalKey("access-key-1", "Update complete."));
  assert.equal(key, createGlobalAnnouncementDismissalKey(" access-key-1 ", " Update complete. "));
});

test("announcement dismissal keys change for a different user or updated message", () => {
  const key = createGlobalAnnouncementDismissalKey("access-key-1", "Update complete.");
  assert.notEqual(key, createGlobalAnnouncementDismissalKey("access-key-2", "Update complete."));
  assert.notEqual(key, createGlobalAnnouncementDismissalKey("access-key-1", "New feature available."));
});
