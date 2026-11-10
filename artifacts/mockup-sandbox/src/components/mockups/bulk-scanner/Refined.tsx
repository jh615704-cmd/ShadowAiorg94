import "./_group.css";
import "./Refined.css";

export function Refined() {
  return (
    <main className="bulk-scanner-preview">
      <section className="bulk-scanner-preview-card" aria-label="Bulk Trader control preview">
        <header className="bulk-scanner-preview-heading">
          <span>Bulk Trader</span>
          <small>EXECUTION CONTROLS</small>
        </header>
        <div className="ai-scanner-control bulk-ai-scanner-control">
          <label className="ai-scanner-switch">
            <span className="ai-scanner-switch-copy">
              <span>AI Scanner</span>
              <small>Scan the latest market signals</small>
            </span>
            <input type="checkbox" role="switch" aria-label="AI Scanner" />
            <i aria-hidden="true" />
          </label>
        </div>
      </section>
    </main>
  );
}
