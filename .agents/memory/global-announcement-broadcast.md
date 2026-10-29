---
name: Global announcement broadcast
description: Recipient scope and dismissal behavior for administrator announcements.
---

Global announcements must reach every active access-key session, including the primary administrator. Dismissal is per viewer and per broadcast revision; saving again republishes the message.

**Why:** The user explicitly requires the broadcast to appear for all users, including the admin who publishes it.

**How to apply:** Keep the admin and standard-user announcement paths aligned, and cover the admin, an existing user, and a new user in the broadcast regression test. A new save must create a revision so prior dismissals do not hide the republished message.
