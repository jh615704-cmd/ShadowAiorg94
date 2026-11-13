import { ReactNode, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useUser } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetAccessSessionQueryKey,
  getGetAdminFeatureSettingsQueryKey,
  useGetAccessSession,
  useGetAdminFeatureSettings,
  type AdminFeatureSettings,
} from '@workspace/api-client-react';
import {
  FEATURE_ACTION_CATALOG,
  featureActionControlIdFromTestId,
} from '@workspace/api-zod';
import {
  Bot,
  Gauge,
  ShieldCheck,
  Moon,
  Sun,
  LogOut,
  Settings,
  User as UserIcon,
} from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { DerivAccountSwitcher } from '@/components/deriv-account-switcher';
import { useAccessSessionLogout } from '@/hooks/use-access-session-logout';
import { BrandWordmark } from '@/components/brand-wordmark';
import { FeatureStatusText } from '@/components/feature-status';
import { GlobalFeatureAnnouncement } from '@/components/layout/global-feature-announcement';
import './feature-action-controls.css';

interface AppShellProps {
  children: ReactNode;
  title: string;
  onRefresh?: () => void;
  headerContent?: ReactNode;
}

export function AppShell({ children, title, onRefresh, headerContent }: AppShellProps) {
  const queryClient = useQueryClient();
  const [location, setLocation] = useLocation();
  const { theme, setTheme } = useTheme();
  const { user } = useUser();
  const accessSession = useGetAccessSession({ query: { retry: false, queryKey: getGetAccessSessionQueryKey() } });
  const featureSettings = useGetAdminFeatureSettings({
    query: { retry: false, refetchInterval: 10_000, queryKey: getGetAdminFeatureSettingsQueryKey() },
  });
  useEffect(() => {
    if (!accessSession.data?.key_id) return;
    const stream = new EventSource('/api/access/feature-announcements/stream', { withCredentials: true });
    const onAnnouncement = (event: Event) => {
      try {
        const update = JSON.parse((event as MessageEvent<string>).data) as {
          enabled: boolean;
          message: string;
          revision: string;
        };
        queryClient.setQueryData<AdminFeatureSettings>(
          getGetAdminFeatureSettingsQueryKey(),
          (current) => current ? {
            ...current,
            global_announcement_enabled: update.enabled,
            global_announcement: update.message,
            global_announcement_revision: update.revision,
          } : current,
        );
      } catch {
        // The regular settings query remains the fallback if a stream event is malformed.
      }
    };
    stream.addEventListener('announcement', onAnnouncement);
    return () => {
      stream.removeEventListener('announcement', onAnnouncement);
      stream.close();
    };
  }, [accessSession.data?.key_id, queryClient]);
  useEffect(() => {
    const knownControls = new Set(FEATURE_ACTION_CATALOG.map((control) => `${control.feature}/${control.control_id}`));
    const modes = new Map(
      (featureSettings.data?.action_controls ?? []).map((control) => [
        `${control.feature}/${control.control_id}`,
        control.mode,
      ]),
    );
    const statusLabel = (mode: string) => mode === "restricted"
      ? "Restricted — admin access only"
      : mode === "coming_soon"
        ? "Coming soon"
        : "Under construction";
    const normalizeActionLabel = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const updateControls = () => {
      document.querySelectorAll<HTMLElement>(
        "[data-feature-scope] button, [data-feature-scope] input[type='checkbox'], [data-feature-scope] [role='switch'], section[id$='-feature'] button, section[id$='-feature'] input[type='checkbox'], section[id$='-feature'] [role='switch'], [data-feature-action]",
      ).forEach((control) => {
        if (!control.hasAttribute("data-feature-action")) {
          const featureScope = control.closest<HTMLElement>("[data-feature-scope]");
          const featureSection = control.closest<HTMLElement>("section[id$='-feature']");
          const scope = featureScope?.dataset.featureScope
            ?? featureSection?.id.replace(/-feature$/, "");
          const testId = control.dataset.testid;
          if (scope) {
            const accessibleLabel = control.getAttribute("aria-label")
              ?? control.getAttribute("title")
              ?? control.textContent
              ?? "";
            const normalizedLabel = normalizeActionLabel(accessibleLabel);
            const byLabel = FEATURE_ACTION_CATALOG.filter((item) =>
              item.feature === scope
              && (
                normalizeActionLabel(item.label) === normalizedLabel
                || normalizeActionLabel(item.label).endsWith(` ${normalizedLabel}`)
              ),
            );
            const controlId = (testId ? featureActionControlIdFromTestId(scope, testId) : undefined)
              ?? (byLabel.length === 1 ? byLabel[0].control_id : undefined);
            const key = controlId ? `${scope}/${controlId}` : "";
            if (controlId && knownControls.has(key)) control.setAttribute("data-feature-action", key);
          }
        }
        const mode = isAdmin ? undefined : modes.get(control.dataset.featureAction ?? "");
        const blocked = mode !== undefined && mode !== "available";
        if (blocked) {
          if (!control.hasAttribute("data-feature-action-original-title")) {
            control.setAttribute("data-feature-action-original-title", control.getAttribute("title") ?? "");
            control.setAttribute("data-feature-action-original-aria-disabled", control.getAttribute("aria-disabled") ?? "");
          }
          control.setAttribute("data-feature-action-blocked", mode);
          control.setAttribute("aria-disabled", "true");
          control.setAttribute("title", statusLabel(mode));
          return;
        }
        if (!control.hasAttribute("data-feature-action-blocked")) return;
        const originalTitle = control.getAttribute("data-feature-action-original-title") ?? "";
        const originalAriaDisabled = control.getAttribute("data-feature-action-original-aria-disabled") ?? "";
        control.removeAttribute("data-feature-action-blocked");
        control.removeAttribute("data-feature-action-original-title");
        control.removeAttribute("data-feature-action-original-aria-disabled");
        if (originalTitle) control.setAttribute("title", originalTitle);
        else control.removeAttribute("title");
        if (originalAriaDisabled) control.setAttribute("aria-disabled", originalAriaDisabled);
        else control.removeAttribute("aria-disabled");
      });
    };
    const preventBlockedAction = (event: Event) => {
      if (!(event.target instanceof Element)) return;
      if (!event.target.closest("[data-feature-action-blocked]")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    updateControls();
    const observer = new MutationObserver(updateControls);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-feature-action"],
    });
    document.addEventListener("click", preventBlockedAction, true);
    document.addEventListener("change", preventBlockedAction, true);
    return () => {
      observer.disconnect();
      document.removeEventListener("click", preventBlockedAction, true);
      document.removeEventListener("change", preventBlockedAction, true);
    };
  }, [accessSession.data?.is_admin, featureSettings.data?.action_controls]);
  const { logout } = useAccessSessionLogout();
  const isAdmin = accessSession.data?.is_admin === true;
  const features = accessSession.data?.features ?? [];
  const canUseEdge = isAdmin || features.includes("edge");
  const canUseDigitFlip = isAdmin || features.includes("digit-flip");
  const canUseTradeX = isAdmin || features.includes("trade-x");
  const canUseBulkTrader = isAdmin || features.includes("bulk-trader");
  const canUseClockWork = isAdmin || features.includes("clock-work");
  const canUseCashGrab = isAdmin || features.includes("cash-grab");
  const canUseMoneyBank = isAdmin || features.includes("money-bank");
  const canUseAutoTrader = isAdmin || features.includes("auto-trader");
  const canUseAutoTrader2 = isAdmin || features.includes("auto-trader-2");
  const canUseTrading = canUseEdge || canUseDigitFlip || canUseTradeX || canUseBulkTrader || canUseClockWork || canUseCashGrab || canUseMoneyBank || canUseAutoTrader || canUseAutoTrader2;
  const canUseSettings = isAdmin || features.includes("settings");
  const routeFeature = location === "/auto-trader"
    ? "auto-trader"
    : location === "/auto-trader-2"
      ? "auto-trader-2"
      : location === "/settings"
        ? "settings"
        : null;
  const routeControl = routeFeature
    ? featureSettings.data?.features.find((item) => item.feature === routeFeature)
    : undefined;
  const featureUnavailable = !isAdmin && routeFeature !== null && (
    featureSettings.isError
    || (routeControl !== undefined && routeControl.mode !== "available")
  );
  const announcementEnabled = Boolean(
    featureSettings.data?.global_announcement_enabled
    && featureSettings.data.global_announcement.trim(),
  );

  return (
    <>
      {announcementEnabled && (
        <div className="global-announcement-frame" data-testid="global-announcement-frame">
          <GlobalFeatureAnnouncement
            message={featureSettings.data!.global_announcement}
            revision={featureSettings.data!.global_announcement_revision}
            viewerId={accessSession.data?.key_id ?? user?.id ?? "anonymous"}
            identityResolved={accessSession.isFetched}
          />
        </div>
      )}
      <div className="app-frame">
      <aside className="sidebar">
        <div>
          <div className="brand-lockup">
            <span className="brand-mark">S</span>
            <BrandWordmark className="text-[11px] text-[#f3fbf9]" />
          </div>
          <p className="sidebar-kicker">Connection center</p>
          <nav className="sidebar-nav" aria-label="Primary navigation">
            {canUseTrading && <Link
              href="/app" 
              className={`nav-item ${location === '/app' ? 'nav-item-active' : ''}`} 
              data-testid="link-nav-dashboard"
            >
              <Gauge size={17} />Dashboard
              {location === '/app' && <span className="nav-live" />}
            </Link>}
            {(canUseAutoTrader || canUseAutoTrader2) && <div className="nav-item-group" role="group" aria-label="Auto Trader features">
              {canUseAutoTrader && <Link
                href="/auto-trader"
                className={`nav-item ${location === '/auto-trader' ? 'nav-item-active' : ''}`}
                aria-current={location === '/auto-trader' ? 'page' : undefined}
                data-testid="link-nav-auto-trader"
              >
                <Bot size={17} />Auto Trader
                {location === '/auto-trader' && <span className="nav-live" />}
              </Link>}
              {canUseAutoTrader2 && <Link
                href="/auto-trader-2"
                className={`nav-item nav-sub-item ${location === '/auto-trader-2' ? 'nav-item-active' : ''}`}
                aria-current={location === '/auto-trader-2' ? 'page' : undefined}
                data-testid="link-nav-auto-trader-2"
              >
                <Bot size={15} />Auto Trader 2.0
                {location === '/auto-trader-2' && <span className="nav-live" />}
              </Link>}
            </div>}
            {isAdmin && (
              <Link 
                href="/admin/users" 
                className={`nav-item ${location === '/admin/users' ? 'nav-item-active' : ''}`} 
                data-testid="link-nav-users"
              >
                <UserIcon size={17} />Users
                {location === '/admin/users' && <span className="nav-live" />}
              </Link>
            )}
            {canUseSettings && <Link 
              href="/settings" 
              className={`nav-item ${location === '/settings' ? 'nav-item-active' : ''}`} 
              data-testid="link-nav-settings"
            >
              <Settings size={17} />Settings
              {location === '/settings' && <span className="nav-live" />}
            </Link>}
          </nav>
        </div>
      </aside>

      <main className={`main-shell ${location.startsWith('/admin') ? 'admin-shell' : ''}`}>
        <header className="topbar">
          <div className="crumbs">
            <span>WORKSPACE</span><span className="crumb-slash">/</span>
            <strong>{title}</strong>
          </div>
          <div className="topbar-actions">
            <DerivAccountSwitcher className="deriv-account-switcher-shell" enabled={canUseTrading} />
            {isAdmin && (
              <Link href="/admin/users" className="admin-top-link">
                <ShieldCheck size={14} /> Admin panel
              </Link>
            )}
            
            {headerContent}

            <button 
              type="button" 
              className="icon-button theme-toggle" 
              title={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} 
              aria-label={theme === 'dark' ? 'Use light theme' : 'Use dark theme'} 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              data-testid="button-toggle-theme"
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
            
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="icon-button" aria-label="User menu" data-testid="button-user-menu">
                  <UserIcon size={16} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56 bg-[var(--paper)] dark:bg-[#102f38] border-[var(--line)] dark:border-[#31545a]">
                <DropdownMenuLabel className="font-mono text-xs tracking-wider text-[var(--teal-deep)] dark:text-[#8ce0ca]">
                   {accessSession.data?.label || user?.primaryEmailAddress?.emailAddress || 'EDGE operator'}
                </DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-[var(--line)] dark:bg-[#31545a]" />
                 <DropdownMenuItem 
                   onClick={() => setLocation('/settings')} 
                  className="cursor-pointer text-[var(--ink-deep)] dark:text-[#d8ece9]"
                >
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={logout}
                  className="cursor-pointer text-red-600 dark:text-red-400 focus:bg-red-50 dark:focus:bg-red-950/30"
                >
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <div className="content-wrap">
          {featureUnavailable ? (
            <section className="feature-availability-panel" role="status">
              {featureSettings.isError
                ? "Feature availability could not be loaded. Refresh the page before using this feature."
                : <FeatureStatusText control={routeControl} isAdmin={isAdmin} fallback="This feature is temporarily unavailable." />}
            </section>
          ) : children}
        </div>
      </main>
      </div>
    </>
  );
}