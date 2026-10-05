---
name: Workspace dependency audits
description: Why a clean production-only audit can still leave a workspace security finding.
---

Audit the complete workspace dependency graph, including development tooling, before declaring a project-wide dependency issue resolved. A clean production-only audit for one artifact does not clear a vulnerable package still installed by another artifact or by its development tools.

**Why:** Removing the vulnerable package path from the API left the workspace scanner reporting the same advisory through the mockup preview tool's development dependency.

**How to apply:** Compare production-only and full-workspace audit results, then inspect recursive dependency paths across every artifact before closing a finding.
