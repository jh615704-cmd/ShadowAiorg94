import { useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Eye,
  EyeOff,
  Fingerprint,
  KeyRound,
  MessageCircle,
  Shield,
} from "lucide-react";
import "./_group.css";

export function VideoMatch() {
  const [key, setKey] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [showKey, setShowKey] = useState(false);

  return (
    <main className="mockup-login-reference">
      <div className="reference-grid" aria-hidden="true" />
      <div className="reference-glow" aria-hidden="true" />
      <svg className="reference-network" viewBox="0 0 1000 1500" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <g>
          <path d="M55 170 225 250 340 165 485 270 635 175 820 260 955 155" />
          <path d="M15 475 175 390 330 500 470 390 620 500 780 405 990 520" />
          <path d="M10 815 165 710 335 840 480 720 650 835 805 715 990 850" />
          <path d="M0 1190 165 1060 335 1190 490 1085 645 1205 820 1080 1000 1190" />
          <path d="M225 250 175 390 165 710 165 1060" />
          <path d="M485 270 470 390 480 720 490 1085" />
          <path d="M820 260 780 405 805 715 820 1080" />
          <path d="M340 165 330 500 335 840 335 1190" />
          <path d="M635 175 620 500 650 835 645 1205" />
          <path d="M55 170 175 390 330 500 480 720 650 835 820 1080 990 1190" />
          <path d="M955 155 780 405 620 500 480 720 335 840 165 1060 0 1190" />
        </g>
        <g>
          <circle cx="55" cy="170" r="3" />
          <circle cx="225" cy="250" r="3" />
          <circle cx="340" cy="165" r="2.5" />
          <circle cx="485" cy="270" r="3" />
          <circle cx="635" cy="175" r="2.5" />
          <circle cx="820" cy="260" r="3" />
          <circle cx="955" cy="155" r="2.5" />
          <circle cx="175" cy="390" r="3" />
          <circle cx="330" cy="500" r="2.5" />
          <circle cx="470" cy="390" r="3" />
          <circle cx="620" cy="500" r="2.5" />
          <circle cx="780" cy="405" r="3" />
          <circle cx="165" cy="710" r="2.5" />
          <circle cx="335" cy="840" r="3" />
          <circle cx="480" cy="720" r="2.5" />
          <circle cx="650" cy="835" r="3" />
          <circle cx="805" cy="715" r="2.5" />
          <circle cx="165" cy="1060" r="3" />
          <circle cx="335" cy="1190" r="2.5" />
          <circle cx="490" cy="1085" r="3" />
          <circle cx="645" cy="1205" r="2.5" />
          <circle cx="820" cy="1080" r="3" />
        </g>
      </svg>

      <section className="reference-login-card" aria-label="Shadow Matrix access-key login">
        <header className="reference-brand">
          <span className="reference-brand-mark" aria-hidden="true">
            <Shield size={24} strokeWidth={2.5} />
          </span>
          <span className="reference-brand-copy">
            <span className="reference-brand-title">
              Shadow Matrix
              <span className="reference-version">v4.8</span>
            </span>
            <small>AUTONOMOUS ALGORITHMIC TRADING</small>
          </span>
        </header>

        <div className="reference-risk">
          <AlertTriangle size={14} strokeWidth={2.5} aria-hidden="true" />
          <div>
            <b>HIGH TRADING RISK NOTICE</b>
            <p>
              Options and leveraged CFDs carry significant risk. You may lose
              capital exceeding initial deposits. Ensure you understand
              algorithmic execution mechanics before deploying capital.
            </p>
          </div>
        </div>

        <div className="reference-auth-mark" aria-hidden="true">
          <Fingerprint size={26} strokeWidth={1.8} />
        </div>
        <h1>Login to Shadow Matrix</h1>
        <p className="reference-intro">Authenticate with your private access key to initialize workspace</p>

        <a className="reference-support" href="https://t.me/JDY_HATED">
          <MessageCircle size={16} fill="currentColor" strokeWidth={1.5} />
          Message Support / Get Access Key
        </a>

        <div className="reference-divider"><span>SECURE GATEWAY</span></div>

        <form className="reference-form" onSubmit={(event) => event.preventDefault()}>
          <label htmlFor="reference-access-key">ACCESS KEY</label>
          <div className="reference-key-input">
            <KeyRound size={16} aria-hidden="true" />
            <input
              id="reference-access-key"
              type={showKey ? "text" : "password"}
              placeholder="shdw_live_XXXXXXXX..."
              autoComplete="off"
              value={key}
              onChange={(event) => setKey(event.target.value)}
            />
            <button
              className="reference-show-key"
              type="button"
              aria-label={showKey ? "Hide access key" : "Show access key"}
              aria-pressed={showKey}
              onClick={() => setShowKey((current) => !current)}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <label className="reference-terms">
            <input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
            <span>
              I acknowledge and agree to the algorithmic trading terms, automated
              risk protocols, and privacy policies of Shadow Matrix.
            </span>
          </label>
          <button className="reference-submit" type="submit" disabled={!key.trim() || !accepted}>
            <span>Unlock Workspace</span>
            <ArrowRight size={16} strokeWidth={2.4} />
          </button>
        </form>

        <footer className="reference-footer">
          <span className="reference-nodes"><i /> Nodes Online</span>
          <span>Secure connection</span>
        </footer>
      </section>
    </main>
  );
}
