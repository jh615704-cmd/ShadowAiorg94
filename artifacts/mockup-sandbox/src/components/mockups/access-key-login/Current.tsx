import { useState } from "react";
import { KeyRound, MessageCircle, ShieldCheck } from "lucide-react";
import "./_group.css";

export function Current() {
  const [key, setKey] = useState("");
  const [accepted, setAccepted] = useState(false);

  return (
    <main className="mockup-login-current">
      <div className="current-orbit" aria-hidden="true" />
      <section className="current-card" aria-label="Current access-key login">
        <div className="current-brand">
          <span className="current-brand-mark">S</span>
          <span className="current-brand-copy">
            <strong>Shadow Ai Trading</strong>
            <small>AI Trading</small>
          </span>
        </div>

        <div className="current-risk">
          <b>TRADING RISK</b>
          <p>
            Options and CFDs are risky. You may lose some or all of your money;
            currency conversion can affect results. Never trade with borrowed
            money or money you cannot afford to lose.
          </p>
        </div>

        <div className="current-lock" aria-hidden="true">
          <ShieldCheck size={25} />
        </div>
        <h1>Login to Shadow Ai</h1>
        <p className="current-intro">Use your access key to open your private trading workspace.</p>

        <a className="current-support" href="https://t.me/JDY_HATED">
          <MessageCircle size={16} />
          Message me now
        </a>

        <form className="current-form" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="current-access-key">ACCESS KEY</label>
          <div className="current-input">
            <KeyRound size={17} />
            <input
              id="current-access-key"
              type="password"
              placeholder="Enter your access key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
          </div>
          <label className="current-terms">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            <span>I acknowledge and agree to the terms and conditions of Shadow Ai Trading.</span>
          </label>
          <button className="current-submit" type="submit" disabled={!key.trim() || !accepted}>
            Unlock workspace
          </button>
        </form>

        <footer className="current-footer">
          <span>Shadow AI Trading</span>
          <span>Access key required</span>
        </footer>
      </section>
    </main>
  );
}
