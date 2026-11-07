import { useEffect, useRef, useState } from "react";
import {
  getGetAccessSessionQueryKey,
  getGetAdminFeatureSettingsQueryKey,
  useGetAccessSession,
  useGetAdminFeatureSettings,
} from "@workspace/api-client-react";
import { featureActionAttributes } from "@workspace/api-zod";

type Props = {
  onScan: () => Promise<string>;
  feature: string;
  disabled?: boolean;
  actionLabel?: string;
  messageAutoDismissMs?: number;
};

const MIN_SCANNER_PROGRESS_MS = 1_100;

export default function AiScannerAction({
  onScan,
  feature,
  disabled = false,
  actionLabel = "AI Scanner",
  messageAutoDismissMs = 3_000,
}: Props) {
  const accessSession = useGetAccessSession({
    query: { retry: false, queryKey: getGetAccessSessionQueryKey() },
  });
  const featureSettings = useGetAdminFeatureSettings({
    query: { retry: false, queryKey: getGetAdminFeatureSettingsQueryKey() },
  });
  const isAdmin = accessSession.data?.is_admin === true;
  const actionControl = featureSettings.data?.action_controls.find((control) =>
    control.feature === feature && control.control_id === "ai-scanner",
  );
  const actionUnavailable = !isAdmin && (
    !accessSession.isFetched
    || !featureSettings.isFetched
    || actionControl?.mode !== undefined && actionControl.mode !== "available"
  );
  const isDisabled = disabled || actionUnavailable;
  const [scanning, setScanning] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [progressComplete, setProgressComplete] = useState(false);
  const [message, setMessage] = useState("");
  const [messageFading, setMessageFading] = useState(false);
  const dismissTimerRef = useRef<number | undefined>(undefined);
  const removeTimerRef = useRef<number | undefined>(undefined);
  const progressTimerRef = useRef<number | undefined>(undefined);

  const clearMessageTimers = () => {
    if (dismissTimerRef.current !== undefined) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = undefined;
    }
    if (removeTimerRef.current !== undefined) {
      window.clearTimeout(removeTimerRef.current);
      removeTimerRef.current = undefined;
    }
    if (progressTimerRef.current !== undefined) {
      window.clearTimeout(progressTimerRef.current);
      progressTimerRef.current = undefined;
    }
  };

  useEffect(() => clearMessageTimers, []);

  const scheduleMessageDismiss = () => {
    if (!Number.isFinite(messageAutoDismissMs) || messageAutoDismissMs <= 0) return;
    dismissTimerRef.current = window.setTimeout(() => {
      setMessageFading(true);
      removeTimerRef.current = window.setTimeout(() => {
        setMessage("");
        setMessageFading(false);
        removeTimerRef.current = undefined;
      }, 320);
      dismissTimerRef.current = undefined;
    }, messageAutoDismissMs);
  };

  const scan = async () => {
    if (scanning || isDisabled) return;
    clearMessageTimers();
    const startedAt = Date.now();
    setScanning(true);
    setShowProgress(true);
    setProgressComplete(false);
    setMessageFading(false);
    setMessage("");
    try {
      const resultMessage = await onScan();
      setMessage(resultMessage);
      setProgressComplete(true);
      scheduleMessageDismiss();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The scan could not be completed.");
      setProgressComplete(true);
      scheduleMessageDismiss();
    } finally {
      setScanning(false);
      const remainingProgressMs = Math.max(0, MIN_SCANNER_PROGRESS_MS - (Date.now() - startedAt));
      if (remainingProgressMs === 0) {
        setShowProgress(false);
      } else {
        progressTimerRef.current = window.setTimeout(() => {
          setShowProgress(false);
          progressTimerRef.current = undefined;
        }, remainingProgressMs);
      }
    }
  };

  return (
    <div className="ai-scanner-control">
      <label className={`ai-scanner-switch${scanning ? " is-scanning" : ""}${isDisabled ? " is-disabled" : ""}`}>
        <span>{actionLabel}</span>
        <input
          {...featureActionAttributes(feature, "ai-scanner")}
          type="checkbox"
          role="switch"
          checked={scanning}
          onChange={(event) => {
            if (event.target.checked) void scan();
          }}
          disabled={isDisabled || scanning}
          aria-label={actionLabel}
          data-testid={`switch-${actionLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        />
        <i aria-hidden="true" />
      </label>
      {showProgress && (
        <div className={`ai-scanner-progress${progressComplete ? " is-complete" : ""}`} role="status" aria-live="polite" aria-label="AI Scanner Calculating">
          <strong>AI Scanner Calculating</strong>
          <span className="ai-scanner-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progressComplete ? 100 : 82}><i /></span>
        </div>
      )}
      {message && (
        <p
          className={`ai-scanner-message${messageFading ? " is-fading" : ""}`}
          role="status"
          aria-live="polite"
        >
          {message}
        </p>
      )}
    </div>
  );
}