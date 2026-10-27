import { useEffect, useState } from "react";
import type { FeatureControl } from "@workspace/api-client-react";

export function featureModeLabel(mode: FeatureControl["mode"]): string {
  if (mode === "restricted") return "Restricted — admin access only";
  if (mode === "coming_soon") return "Coming soon";
  if (mode === "under_construction") return "Under construction";
  return "Available";
}

export function FeatureStatusText({
  control,
  isAdmin,
  fallback,
}: {
  control?: FeatureControl;
  isAdmin: boolean;
  fallback: string;
}) {
  const [now, setNow] = useState(Date.now());
  const countdownAt = control?.countdown_at;

  useEffect(() => {
    if (!countdownAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [countdownAt]);

  if (!control || control.mode === "available") {
    return <>{control?.notice || fallback}</>;
  }

  if (isAdmin) {
    return (
      <>
        <span className="xt-admin-feature-status">{featureModeLabel(control.mode)}</span>
        {control.notice ? ` · ${control.notice}` : ""}
      </>
    );
  }

  const countdownTarget = countdownAt ? Date.parse(String(countdownAt)) : null;
  const remaining = countdownTarget === null ? null : countdownTarget - now;
  const countdown = remaining === null || !Number.isFinite(remaining)
    ? ""
    : remaining <= 0
      ? " · scheduled time passed"
      : ` · ${Math.floor(remaining / 86_400_000)}d ${Math.floor((remaining % 86_400_000) / 3_600_000)}h ${Math.floor((remaining % 3_600_000) / 60_000)}m ${Math.floor((remaining % 60_000) / 1_000)}s`;

  return (
    <>
      {featureModeLabel(control.mode)}{countdown}
      {control.notice ? ` · ${control.notice}` : ""}
    </>
  );
}

