import "./_group.css";

export function Current() {
  return (
    <main className="bulk-scanner-preview">
      <section className="bulk-scanner-preview-card" aria-label="Bulk Trader control preview">
        <header className="bulk-scanner-preview-heading">
          <span>Bulk Trader</span>
          <small>EXECUTION CONTROLS</small>
        </header>
        <div className="ai-scanner-control">
          <label className="ai-scanner-switch">
            <span>AI Scanner</span>
            <input type="checkbox" role="switch" aria-label="AI Scanner" />
            <i aria-hidden="true" />
          </label>
        </div>
        <p className="bulk-scanner-description">Current Bulk Trader scanner switch</p>
      </section>
    </main>
  );
}
