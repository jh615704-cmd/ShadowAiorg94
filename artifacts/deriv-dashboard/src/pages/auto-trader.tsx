import { Bot } from "lucide-react";
import { AppShell } from "@/components/layout/app-shell";
import "./auto-trader.css";

export default function AutoTraderPage() {
  return (
    <AppShell title="AUTO TRADER">
      <section className="panel proposal-panel auto-trader-placeholder" aria-labelledby="auto-trader-title">
        <div className="panel-overline">COMING SOON</div>
        <h1 id="auto-trader-title"><Bot size={22} aria-hidden="true" />Auto Trader</h1>
        <p>Trading logic and controls will be added here.</p>
      </section>
    </AppShell>
  );
}
