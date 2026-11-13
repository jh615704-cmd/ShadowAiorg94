import { Link } from 'wouter';
import { ArrowRight, ShieldCheck, Zap, LockKeyhole } from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { useEffect } from 'react';
import { BrandWordmark } from '@/components/brand-wordmark';

export default function Landing() {
  const { setTheme } = useTheme();

  // Ensure landing page is dark mode for visual impact
  useEffect(() => {
    setTheme('dark');
  }, [setTheme]);

  return (
    <div className="min-h-[100dvh] bg-[#0b1a20] text-[#e7f6f2] flex flex-col font-sans selection:bg-[#18a894] selection:text-white">
      <header className="flex items-center justify-between px-6 py-8 md:px-12 md:py-10 max-w-7xl mx-auto w-full">
        <div className="flex items-center gap-3">
          <div aria-hidden="true" className="w-10 h-10 rounded-xl rounded-tr-sm bg-gradient-to-br from-[#39e4ed] to-[#8c9dff] flex items-center justify-center text-[#071827] text-sm font-black tracking-[-0.12em] shadow-[0_0_28px_rgba(68,197,255,0.24)]">
            S
            <span className="-ml-0.5">M</span>
          </div>
          <BrandWordmark className="text-sm text-[#f3fbf9]" />
        </div>
        
        <div className="flex items-center gap-4">
          <Link href="/sign-in" className="text-sm font-bold bg-[#18a894] text-white px-6 py-2.5 rounded-lg hover:bg-[#087d70] hover:-translate-y-0.5 transition-all shadow-[0_4px_14px_rgba(24,168,148,0.25)]">
            Login
          </Link>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 max-w-5xl mx-auto w-full pb-20">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#24434a] bg-[#10262d] text-[#8ce0ca] font-mono text-[10px] tracking-widest mb-8">
          <span className="w-1.5 h-1.5 rounded-full bg-[#18a894] animate-pulse" />
          SECURE TRADING PLATFORM
        </div>

        <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight leading-[1.05] mb-6">
          See the market clearly. <br className="hidden md:block" />
          <em className="bg-gradient-to-r from-[#42e8ee] via-[#77c7ff] to-[#ae9cff] bg-clip-text text-transparent not-italic">Trade with a plan.</em>
        </h1>

        <p className="text-[#8ba1a2] text-lg md:text-xl max-w-2xl mx-auto leading-relaxed mb-12">
          Shadow Matrix is a private Deriv workspace for live market analysis,
          feature-specific trade controls, and account-isolated history. Signals
          describe observed data; they cannot guarantee a trading outcome.
        </p>

        <Link href="/sign-in" className="inline-flex items-center justify-center gap-3 bg-[#18a894] text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-[#087d70] hover:-translate-y-1 transition-all shadow-[0_8px_24px_rgba(24,168,148,0.3)] mb-20 group">
          Login <ArrowRight size={20} className="group-hover:translate-x-1 transition-transform" />
        </Link>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-10 w-full text-left border-t border-[#1d3339] pt-16">
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-lg bg-[#123e3a] text-[#35d6b6] flex items-center justify-center">
              <LockKeyhole size={24} />
            </div>
            <h3 className="font-bold text-xl text-[#f3fbf9]">Bring Your Own Key</h3>
            <p className="text-[#7f9d9d] text-sm leading-relaxed">
              Sign in and provide your Deriv Personal Access Token. Credentials are encrypted server-side and never exposed to the client.
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-lg bg-[#123e3a] text-[#35d6b6] flex items-center justify-center">
              <ShieldCheck size={24} />
            </div>
            <h3 className="font-bold text-xl text-[#f3fbf9]">Complete Isolation</h3>
            <p className="text-[#7f9d9d] text-sm leading-relaxed">
              Every user operates in a strictly isolated context. You only ever see your own accounts, telemetry, proposals, and trade history.
            </p>
          </div>
          
          <div className="space-y-4">
            <div className="w-12 h-12 rounded-lg bg-[#123e3a] text-[#35d6b6] flex items-center justify-center">
              <Zap size={24} />
            </div>
            <h3 className="font-bold text-xl text-[#f3fbf9]">High-Density UI</h3>
            <p className="text-[#7f9d9d] text-sm leading-relaxed">
              A crafted interface optimized for information density. Live market data, one-click execution, and immediate feedback loops.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}