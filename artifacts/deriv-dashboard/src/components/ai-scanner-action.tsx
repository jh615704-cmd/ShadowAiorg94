import { useEffect, useRef, useState } from "react";

type Props = {
  onScan: () => Promise<string>;
  disabled?: boolean;
  actionLabel?: string;
  messageAutoDismissMs?: number;
};

export default function AiScannerAction({
  onScan,
  disabled = false,
  actionLabel = "AI Scanner",
  messageAutoDismissMs = 3_000,
}: Props) {
  const [scanning, setScanning] = useState(false);
  const [message, setMessage] = useState("");
  const [messageFading, setMessageFading] = useState(false);
  const dismissTimerRef = useRef<number | undefined>(undefined);
  const removeTimerRef = useRef<number | undefined>(undefined);

  const clearMessageTimers = () => {
    if (dismissTimerRef.current !== undefined) {
      window.clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = undefined;
    }
    if (removeTimerRef.current !== undefined) {
      window.clearTimeout(removeTimerRef.current);
      removeTimerRef.current = undefined;
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
    if (scanning || disabled) return;
    clearMessageTimers();
    setScanning(true);
    setMessageFading(false);
    setMessage("Scanning available market samples…");
    try {
      const resultMessage = await onScan();
      setMessage(resultMessage);
      scheduleMessageDismiss();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The scan could not be completed.");
      scheduleMessageDismiss();
    } finally {
      setScanning(false);
    }
  };

  return (
    <div className="ai-scanner-control">
      <button type="button" className="ai-scanner-button" onClick={() => void scan()} disabled={disabled || scanning}>
        {scanning ? "Scanning..." : actionLabel}
      </button>
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