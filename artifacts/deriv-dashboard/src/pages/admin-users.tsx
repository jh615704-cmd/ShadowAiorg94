import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AccessFeature,
  getListAccessKeysQueryKey,
  getGetTradingProtectionQueryKey,
  getGetAdminFeatureSettingsQueryKey,
  useCreateAccessKey,
  useDeleteAccessKey,
  useListAccessKeys,
  useResetAccessKey,
  useUpdateAccessKey,
  useGetTradingProtection,
  useUpdateTradingProtection,
  useGetAdminFeatureSettings,
  useUpdateAdminFeatureSettings,
  getUserFacingErrorMessage,
  type AccessFeature as AccessFeatureValue,
  type AdminFeatureSettings,
  type FeatureControl,
  type AccessKeySummary,
} from "@workspace/api-client-react";
import { AppShell } from "@/components/layout/app-shell";
import AdminIntelligencePanel from "@/components/admin-intelligence-panel";
import { useToast } from "@/hooks/use-toast";
import {
  Activity,
  Ban,
  Check,
  CirclePause,
  Copy,
  Eraser,
  KeyRound,
  LockKeyhole,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  UserRound,
  Unlock,
  Users,
  X,
} from "lucide-react";

const featureLabels: Partial<Record<AccessFeatureValue, string>> = {
  edge: "EDGE trading",
  "digit-flip": "DigitFlip",
  "trade-x": "Trade X",
  "bulk-trader": "Bulk Trader",
  "clock-work": "Clock Work",
  "cash-grab": "Cash Grab",
  "money-bank": "Money Bank",
  "jdy-ai-3": "Shadows 3",
  "auto-trader": "Auto Trader",
  "auto-trader-2": "Auto Trader 2.0",
  settings: "Settings",
  history: "History",
};

const featureDescriptions: Partial<Record<AccessFeatureValue, string>> = {
  edge: "PAT connection, live telemetry, and trades",
  "digit-flip": "Even / Odd parity trading and automation",
  "trade-x": "Digit Differs trading and automation",
  "bulk-trader": "Send 1–6 contracts across four trade types",
  "clock-work": "Five-tick Higher and Lower analysis and trading",
  "cash-grab": "Controlled batch trading with risk gates",
  "money-bank": "Accumulator automation with recovery controls",
  "jdy-ai-3": "Cash Grab live gate and immediate stop control",
  "auto-trader": "Live market scanner and Digit Differs orders",
  "auto-trader-2": "Automated contract selection and session controls",
  settings: "View and manage the Deriv connection",
  history: "Read recent trading activity",
};

const featureOptions = Object.values(AccessFeature)
  .filter((value): value is Exclude<AccessFeatureValue, "admin"> => value !== "admin")
  .map((value) => {
    const label = featureLabels[value] ?? value.split("-").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" ");
    return {
      value,
      label,
      description: featureDescriptions[value] ?? `${label} access`,
    };
  });

function errorMessage(error: unknown) {
  return getUserFacingErrorMessage(error, "The request could not be completed.");
}

function formatOffline(seconds: number, online: boolean) {
  if (online) return "Online now";
  if (!seconds) return "Never connected";
  if (seconds < 60) return `Offline ${seconds}s`;
  if (seconds < 3600) return `Offline ${Math.floor(seconds / 60)}m`;
  return `Offline ${Math.floor(seconds / 3600)}h`;
}

function toDateTimeLocal(value: Date | string | null): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function StatusBadge({ item }: { item: AccessKeySummary }) {
  const label = item.status === "banned" ? "Banned" : item.status === "blocked" ? "Blocked" : item.status === "paused" ? "Paused" : item.online ? "Online" : "Offline";
  return <span className={`key-status key-status-${item.status} ${item.online ? "key-status-online" : ""}`}><i />{label}</span>;
}

function KeyRow({
  item,
  onStatus,
  onUpdate,
  onReset,
  onDelete,
  deletingKey,
}: {
  item: AccessKeySummary;
  onStatus: (item: AccessKeySummary, status: "active" | "paused" | "blocked" | "banned") => void;
  onUpdate: (item: AccessKeySummary, data: { max_devices?: number; features?: AccessFeature[] }) => void;
  onReset: (item: AccessKeySummary) => void;
  onDelete: (item: AccessKeySummary) => void;
  deletingKey?: boolean;
}) {
  const isBanned = item.status === "banned";
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [draftDevices, setDraftDevices] = useState(item.max_devices);
  const [unlimitedDevices, setUnlimitedDevices] = useState(item.kind === "admin" && item.max_devices === 0);
  const [draftFeatures, setDraftFeatures] = useState<AccessFeature[]>(item.features);

  const startEditing = () => {
    setDraftDevices(item.max_devices);
    setUnlimitedDevices(item.kind === "admin" && item.max_devices === 0);
    setDraftFeatures(item.features);
    setEditing(true);
  };

  const toggleDraftFeature = (feature: AccessFeature) => {
    setDraftFeatures((current) => current.includes(feature)
      ? current.filter((value) => value !== feature)
      : [...current, feature]);
  };

  const copyAccessKey = async () => {
    if (!item.access_key) return;
    try {
      await navigator.clipboard.writeText(item.access_key);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      return;
    }
  };

  return (
    <div className={`key-row ${deletingKey ? "key-row-deleting" : ""}`}>
      <div className="key-row-main">
        <div className="key-avatar">{item.kind === "admin" ? <ShieldCheck size={17} /> : <UserRound size={17} />}</div>
        {item.access_key ? (
          <button type="button" className="key-reissue-button" onClick={copyAccessKey} title="Copy access key" aria-label={`Copy access key for ${item.label}`}>
            {copied ? <Check size={13} /> : <Copy size={13} />}
          </button>
        ) : !item.is_admin && !isBanned ? (
          <button type="button" className="key-reissue-button" onClick={() => onReset(item)} title="Issue a replacement access key" aria-label={`Issue a replacement key for ${item.label}`}><KeyRound size={13} /></button>
        ) : null}
        <div>
          <div className="key-label">{item.label}</div>
          <div className="key-prefix">{item.access_key ?? `${item.key_prefix}••••••••`}</div>
          {item.access_key && <code className="key-full-value">{item.access_key}</code>}
        </div>
      </div>
      <div className="key-row-data"><span>{item.kind === "admin" ? "Administrator" : "User"}</span><strong>{item.device_count} / {item.max_devices === 0 ? "Unlimited" : item.max_devices}</strong><small>devices</small></div>
      <div className="key-row-data"><StatusBadge item={item} /><small>{formatOffline(item.offline_seconds, item.online)}</small></div>
      {editing ? (
        <div className="key-edit-panel">
          {item.kind === "admin" && <label className="key-edit-unlimited"><input type="checkbox" checked={unlimitedDevices} onChange={(event) => { setUnlimitedDevices(event.target.checked); if (!event.target.checked) setDraftDevices(1); }} /><span>Unlimited devices</span></label>}
          <label className="key-edit-limit">
            <span>DEVICES</span>
            <input
              type="number"
              min={1}
              max={50}
              disabled={item.kind === "admin" && unlimitedDevices}
              value={draftDevices}
              onChange={(event) => setDraftDevices(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
            />
          </label>
          <div className="key-edit-features">
             {featureOptions.map((feature) => (
               <label className={draftFeatures.includes(feature.value) ? "key-edit-feature selected" : "key-edit-feature"} key={feature.value}>
                <input
                  type="checkbox"
                   checked={draftFeatures.includes(feature.value)}
                  onChange={() => toggleDraftFeature(feature.value)}
                />
                <span>{feature.label}</span>
              </label>
            ))}
          </div>
          <div className="key-edit-actions">
            <button type="button" className="key-action key-action-green" disabled={!draftFeatures.length} onClick={() => { onUpdate(item, { max_devices: item.kind === "admin" && unlimitedDevices ? 0 : draftDevices, features: draftFeatures }); setEditing(false); }}><Save size={13} /> Save</button>
            <button type="button" className="key-action" onClick={() => setEditing(false)}><X size={13} /> Cancel</button>
          </div>
        </div>
      ) : <div className="key-feature-list">{item.features.map((feature) => <span key={feature}>{feature}</span>)}</div>}
      <div className="key-row-actions">
        {!isBanned && !editing && <button type="button" className="key-action" onClick={startEditing} title="Edit device limit and features"><Pencil size={14} /> Edit access</button>}
        {item.status !== "active" && !isBanned && <button type="button" className="key-action key-action-green" onClick={() => onStatus(item, "active")} title="Resume or unblock"><Unlock size={14} /> Resume</button>}
        {item.status === "active" && <button type="button" className="key-action" onClick={() => onStatus(item, "paused")} title="Pause this key"><CirclePause size={14} /> Pause</button>}
        {item.status !== "blocked" && !isBanned && <button type="button" className="key-action" onClick={() => onStatus(item, "blocked")} title="Block this key"><LockKeyhole size={14} /> Block</button>}
        {!isBanned && <button type="button" className="key-action key-action-red" onClick={() => onStatus(item, "banned")} title="Permanently ban this key"><Ban size={14} /> Ban</button>}
        {!item.is_admin && <button type="button" className="key-action key-action-red key-delete-action" onClick={() => onDelete(item)} title="Delete this key permanently"><Eraser size={14} /> Delete</button>}
      </div>
    </div>
  );
}

export default function AdminUsersPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const keysQuery = useListAccessKeys({ query: { refetchInterval: 5_000, queryKey: getListAccessKeysQueryKey() } });
  const createKey = useCreateAccessKey();
  const resetKey = useResetAccessKey();
  const deleteKey = useDeleteAccessKey();
  const updateKey = useUpdateAccessKey();
  const protectionQuery = useGetTradingProtection({ query: { retry: false, queryKey: getGetTradingProtectionQueryKey() } });
  const updateProtection = useUpdateTradingProtection();
  const featureSettingsQuery = useGetAdminFeatureSettings({
    query: { retry: false, queryKey: getGetAdminFeatureSettingsQueryKey() },
  });
  const updateFeatureSettings = useUpdateAdminFeatureSettings();
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<"user" | "admin">("user");
  const [maxDevices, setMaxDevices] = useState(1);
  const [unlimitedDevices, setUnlimitedDevices] = useState(false);
  const [features, setFeatures] = useState<AccessFeature[]>(["edge"]);
  const [newKey, setNewKey] = useState<{ value: string; kind: "user" | "admin"; label: string } | null>(null);
  const [formError, setFormError] = useState("");
  const [deletingKeyIds, setDeletingKeyIds] = useState<Set<string>>(new Set());
  const [protection, setProtection] = useState({
    weekdays_enabled: false,
    weekends_enabled: false,
    dual_weekends_weekdays_enabled: false,
  });
  const [featureSettingsDraft, setFeatureSettingsDraft] = useState<AdminFeatureSettings | null>(null);
  const [featureUserSearch, setFeatureUserSearch] = useState<Record<string, string>>({});
  const keys = keysQuery.data ?? [];
  const userKeys = keys.filter((key) => key.kind === "user");
  const onlineCount = keys.filter((key) => key.online).length;
  const userCount = keys.filter((key) => key.kind === "user").length;
  const activeCount = keys.filter((key) => key.status === "active").length;
  const canCreate = Boolean(label.trim()) && features.length > 0 && !createKey.isPending;

  useEffect(() => {
    if (!protectionQuery.data) return;
    setProtection({
      weekdays_enabled: protectionQuery.data.weekdays_enabled,
      weekends_enabled: protectionQuery.data.weekends_enabled,
      dual_weekends_weekdays_enabled: protectionQuery.data.dual_weekends_weekdays_enabled,
    });
  }, [protectionQuery.data]);

  useEffect(() => {
    if (featureSettingsQuery.data && !featureSettingsDraft) {
      setFeatureSettingsDraft(featureSettingsQuery.data);
    }
  }, [featureSettingsDraft, featureSettingsQuery.data]);

  const refreshEverything = async () => {
    await queryClient.invalidateQueries();
    await keysQuery.refetch();
    toast({ title: "Admin data refreshed", description: "Presence, access keys, and feature access are up to date." });
  };

  const toggleFeature = (feature: AccessFeature) => {
    setFeatures((current) => current.includes(feature) ? current.filter((item) => item !== feature) : [...current, feature]);
  };

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    setFormError("");
    createKey.mutate(
       { data: { label: label.trim(), kind, max_devices: kind === "admin" && unlimitedDevices ? 0 : maxDevices, features } },
      {
        onSuccess: (created) => {
           setNewKey({ value: created.access_key, kind: created.kind, label: created.label });
          setLabel("");
          setKind("user");
          setMaxDevices(1);
          setUnlimitedDevices(false);
          setFeatures(["edge"]);
          queryClient.invalidateQueries({ queryKey: getListAccessKeysQueryKey() });
          toast({ title: "Access key created", description: "Copy the key now. It is shown only once." });
        },
        onError: (error) => setFormError(errorMessage(error)),
      },
    );
  };

  const handleStatus = (item: AccessKeySummary, status: "active" | "paused" | "blocked" | "banned") => {
    if (status === "banned" && !window.confirm(`Permanently ban ${item.label}? This cannot be undone.`)) return;
    updateKey.mutate(
      { id: item.key_id, data: { status } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAccessKeysQueryKey() });
          toast({ title: status === "banned" ? "Key permanently banned" : `Key ${status === "active" ? "resumed" : status}` });
        },
        onError: (error) => toast({ variant: "destructive", title: "Update failed", description: errorMessage(error) }),
      },
    );
  };

  const handleUpdate = (item: AccessKeySummary, data: { max_devices?: number; features?: AccessFeature[] }) => {
    updateKey.mutate(
      { id: item.key_id, data },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAccessKeysQueryKey() });
          toast({ title: "Access updated", description: `${item.label} now has the selected device limit and features.` });
        },
        onError: (error) => toast({ variant: "destructive", title: "Update failed", description: errorMessage(error) }),
      },
    );
  };

  const handleReset = (item: AccessKeySummary) => {
    if (!window.confirm(`Issue a replacement key for ${item.label}? The current key will stop working immediately.`)) return;
    resetKey.mutate(
      { id: item.key_id },
      {
        onSuccess: (created) => {
          setNewKey({ value: created.access_key, kind: created.kind, label: created.label });
          queryClient.invalidateQueries({ queryKey: getListAccessKeysQueryKey() });
          toast({ title: "Replacement key ready", description: "Copy the new key now. The old key has been revoked." });
        },
        onError: (error) => toast({ variant: "destructive", title: "Key replacement failed", description: errorMessage(error) }),
      },
    );
  };

  const handleDelete = (item: AccessKeySummary) => {
    if (!window.confirm(`Delete ${item.label}? This immediately revokes every session. You can reuse this name later, but this key can never sign in again.`)) return;
    setDeletingKeyIds((current) => new Set(current).add(item.key_id));
    deleteKey.mutate(
      { id: item.key_id },
      {
        onSuccess: () => {
          toast({ title: "Access key deleted", description: `${item.label} has been removed and can no longer sign in. You can reuse this name for a new key.` });
          window.setTimeout(() => {
            setDeletingKeyIds((current) => {
              const next = new Set(current);
              next.delete(item.key_id);
              return next;
            });
            queryClient.invalidateQueries({ queryKey: getListAccessKeysQueryKey() });
          }, 420);
        },
        onError: (error) => {
          setDeletingKeyIds((current) => {
            const next = new Set(current);
            next.delete(item.key_id);
            return next;
          });
          toast({ variant: "destructive", title: "Delete failed", description: errorMessage(error) });
        },
      },
    );
  };

  const copyKey = async () => {
    if (!newKey) return;
    await navigator.clipboard?.writeText(newKey.value);
    toast({ title: "Copied", description: "The access key is on your clipboard." });
  };

  const updateProtectionSetting = (key: keyof typeof protection, value: boolean) => {
    const next = { ...protection, [key]: value };
    setProtection(next);
    updateProtection.mutate(
      { data: next },
      {
        onSuccess: (saved) => {
          setProtection({
            weekdays_enabled: saved.weekdays_enabled,
            weekends_enabled: saved.weekends_enabled,
            dual_weekends_weekdays_enabled: saved.dual_weekends_weekdays_enabled,
          });
          toast({ title: "Global protection updated", description: "The selected market-quality shield now applies to all users." });
        },
        onError: (error) => {
          setProtection(protection);
          toast({ variant: "destructive", title: "Protection update failed", description: errorMessage(error) });
        },
      },
    );
  };

  const editFeatureControl = (feature: FeatureControl["feature"], patch: Partial<FeatureControl>) => {
    setFeatureSettingsDraft((current) => current
      ? { ...current, features: current.features.map((item) => item.feature === feature ? { ...item, ...patch } : item) }
      : current);
  };

  const featureSettingsPayload = (
    base: AdminFeatureSettings,
    featureOverrides: FeatureControl[] = base.features,
    extra?: Partial<AdminFeatureSettings>,
  ) => ({
    features: featureOverrides,
    global_announcement_enabled: extra?.global_announcement_enabled ?? base.global_announcement_enabled,
    global_announcement: extra?.global_announcement ?? base.global_announcement,
    global_announcement_revision: extra?.global_announcement_revision ?? base.global_announcement_revision,
    auto_trader_2_paused: extra?.auto_trader_2_paused ?? base.auto_trader_2_paused,
    auto_trader_2_pause_message: extra?.auto_trader_2_pause_message ?? base.auto_trader_2_pause_message,
  });

  const saveFeatureControl = (feature: FeatureControl["feature"]) => {
    const savedSettings = featureSettingsQuery.data;
    const draftControl = featureSettingsDraft?.features.find((item) => item.feature === feature);
    if (!savedSettings || !draftControl) return;
    const features = savedSettings.features.map((item) => item.feature === feature ? draftControl : item);
    updateFeatureSettings.mutate(
      { data: featureSettingsPayload(savedSettings, features) },
      {
        onSuccess: (saved) => {
          queryClient.setQueryData(getGetAdminFeatureSettingsQueryKey(), saved);
          setFeatureSettingsDraft((current) => current
            ? { ...current, features: current.features.map((item) => item.feature === feature
              ? saved.features.find((savedItem) => savedItem.feature === feature) ?? item
              : item) }
            : saved);
          toast({ title: "Feature notice saved", description: "The selected users are updated immediately." });
        },
        onError: (error) => toast({ variant: "destructive", title: "Feature notice could not be saved", description: errorMessage(error) }),
      },
    );
  };

  const cancelFeatureControl = (feature: FeatureControl["feature"]) => {
    const savedControl = featureSettingsQuery.data?.features.find((item) => item.feature === feature);
    if (savedControl) editFeatureControl(feature, savedControl);
  };

  const saveAnnouncement = () => {
    const base = featureSettingsQuery.data;
    const draft = featureSettingsDraft;
    if (!base || !draft) return;
    updateFeatureSettings.mutate(
      {
        data: featureSettingsPayload(base, base.features, {
          global_announcement_enabled: draft.global_announcement_enabled,
          global_announcement: draft.global_announcement,
          global_announcement_revision: crypto.randomUUID(),
        }),
      },
      {
        onSuccess: (saved) => {
          queryClient.setQueryData(getGetAdminFeatureSettingsQueryKey(), saved);
          setFeatureSettingsDraft((current) => current
            ? {
                ...current,
                global_announcement_enabled: saved.global_announcement_enabled,
                global_announcement: saved.global_announcement,
                global_announcement_revision: saved.global_announcement_revision,
              }
            : saved);
          toast({ title: "Global announcement broadcast", description: "It's live for all users, including new accounts, until each user dismisses it." });
        },
        onError: (error) => toast({ variant: "destructive", title: "Announcement could not be saved", description: errorMessage(error) }),
      },
    );
  };

  const cancelAnnouncement = () => {
    const saved = featureSettingsQuery.data;
    if (!saved) return;
    setFeatureSettingsDraft((current) => current
      ? {
          ...current,
          global_announcement_enabled: saved.global_announcement_enabled,
          global_announcement: saved.global_announcement,
          global_announcement_revision: saved.global_announcement_revision,
        }
      : saved);
  };

  const saveAutoTrader2Controls = () => {
    const base = featureSettingsQuery.data;
    const draft = featureSettingsDraft;
    if (!base || !draft) return;
    updateFeatureSettings.mutate(
      {
        data: featureSettingsPayload(base, base.features, {
          auto_trader_2_paused: draft.auto_trader_2_paused,
          auto_trader_2_pause_message: draft.auto_trader_2_pause_message,
        }),
      },
      {
        onSuccess: (saved) => {
          queryClient.setQueryData(getGetAdminFeatureSettingsQueryKey(), saved);
          setFeatureSettingsDraft((current) => current
            ? { ...current, auto_trader_2_paused: saved.auto_trader_2_paused, auto_trader_2_pause_message: saved.auto_trader_2_pause_message }
            : saved);
          toast({ title: "Auto Trader 2.0 controls saved" });
        },
        onError: (error) => toast({ variant: "destructive", title: "Auto Trader 2.0 controls could not be saved", description: errorMessage(error) }),
      },
    );
  };

  const cancelAutoTrader2Controls = () => {
    const saved = featureSettingsQuery.data;
    if (!saved) return;
    setFeatureSettingsDraft((current) => current
      ? { ...current, auto_trader_2_paused: saved.auto_trader_2_paused, auto_trader_2_pause_message: saved.auto_trader_2_pause_message }
      : saved);
  };

  const stats = useMemo(() => [
    { label: "TOTAL KEYS", value: keys.length, detail: `${userCount} user keys`, icon: KeyRound },
    { label: "ONLINE NOW", value: onlineCount, detail: "Presence within 90 seconds", icon: Activity },
    { label: "ACTIVE ACCESS", value: activeCount, detail: "Keys currently accepted", icon: Users },
  ], [activeCount, keys.length, onlineCount, userCount]);

  return (
    <AppShell title="ADMIN / ACCESS CONTROL">
      <div className="admin-console">
        <section className="admin-console-heading">
          <div>
            <div className="eyebrow"><span className="eyebrow-rule" />WORKSPACE / EDGE ADMIN</div>
            <h1>Access <em>control.</em></h1>
            <p>Provision keys, set device limits, grant features, and control who can enter the trading workspace.</p>
          </div>
           <button type="button" className="refresh-control" onClick={() => void refreshEverything()} disabled={keysQuery.isFetching}><RefreshCw size={14} className={keysQuery.isFetching ? "spin" : ""} /> Refresh everything</button>
        </section>

        <AdminIntelligencePanel />

        <section className="panel admin-feature-control-card">
          <div className="panel-header">
            <div><span className="panel-overline">USER-FACING FEATURE CONTROLS</span><h3>Feature availability and bot settings</h3></div>
          </div>
          <p className="admin-protection-intro">Restricted, Coming soon, and Under construction block the selected users from opening that feature or its guide. Choose All users to include current and future user keys, or Specific users to target a saved list. Open contracts are not cancelled.</p>
          {featureSettingsQuery.isError ? (
            <div className="admin-form-error">Unable to load feature controls. Refresh the page and sign in again as the primary administrator.</div>
          ) : featureSettingsQuery.isLoading || !featureSettingsDraft ? (
            <div className="admin-empty"><RefreshCw className="spin" size={18} /> Loading feature controls…</div>
          ) : (
            <>
              <div className="admin-feature-control-grid">
                {featureSettingsDraft.features.map((control) => {
                  const featureLabel = featureOptions.find((item) => item.value === control.feature)?.label ?? control.feature;
                  const savedControl = featureSettingsQuery.data?.features.find((item) => item.feature === control.feature);
                  const comparable = (item: FeatureControl | undefined) => item
                    ? JSON.stringify({ ...item, user_ids: [...item.user_ids].sort() })
                    : "";
                  const changed = comparable(control) !== comparable(savedControl);
                  const search = (featureUserSearch[control.feature] ?? "").trim().toLowerCase();
                  const matchingUsers = userKeys.filter((key) =>
                    !search || `${key.label} ${key.key_prefix}`.toLowerCase().includes(search),
                  );
                  const visibleUsers = matchingUsers.slice(0, search ? 200 : 100);
                  return (
                    <div className="admin-feature-control-row" key={control.feature}>
                      <div className="admin-feature-control-fields">
                        <div className="admin-feature-control-title"><strong>{featureLabel}</strong><small>Save applies the status and notice to the audience you choose.</small></div>
                        <label className="admin-control-field"><span>Status</span><select value={control.mode} onChange={(event) => editFeatureControl(control.feature, { mode: event.target.value as FeatureControl["mode"] })}>
                          <option value="available">Available</option>
                          <option value="restricted">Restricted — admin access only</option>
                          <option value="coming_soon">Coming soon</option>
                          <option value="under_construction">Under construction</option>
                        </select></label>
                        <label className="admin-control-field"><span>Users</span><select value={control.audience} onChange={(event) => editFeatureControl(control.feature, { audience: event.target.value as FeatureControl["audience"] })}>
                          <option value="all">All users</option>
                          <option value="specific">Specific users</option>
                        </select></label>
                        <label className="admin-control-field"><span>Countdown (optional)</span><input type="datetime-local" value={toDateTimeLocal(control.countdown_at)} onChange={(event) => editFeatureControl(control.feature, { countdown_at: event.target.value ? new Date(event.target.value).toISOString() : null })} /></label>
                      </div>
                      <label className="admin-control-field admin-feature-notice"><span>Feature notice</span><input type="text" maxLength={500} value={control.notice} placeholder="Optional message shown with the status" onChange={(event) => editFeatureControl(control.feature, { notice: event.target.value })} /></label>
                      {control.audience === "specific" && (
                        <div className="admin-feature-user-picker">
                          <div className="admin-feature-user-picker-heading">
                            <div><strong>Select users</strong><small>{control.user_ids.length} selected · {userKeys.length} user keys</small></div>
                            <label className="admin-control-field"><span>Find a user</span><input type="search" value={featureUserSearch[control.feature] ?? ""} onChange={(event) => setFeatureUserSearch((current) => ({ ...current, [control.feature]: event.target.value }))} placeholder="Search by name or key prefix" /></label>
                          </div>
                          <div className="admin-feature-user-list" role="group" aria-label={`Users affected by ${featureLabel} status`}>
                            {visibleUsers.length ? visibleUsers.map((userKey) => {
                              const selected = control.user_ids.includes(userKey.key_id);
                              return (
                                <label className={`admin-feature-user-option${selected ? " selected" : ""}`} key={userKey.key_id}>
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    onChange={() => editFeatureControl(control.feature, {
                                      user_ids: selected
                                        ? control.user_ids.filter((id) => id !== userKey.key_id)
                                        : [...control.user_ids, userKey.key_id],
                                    })}
                                  />
                                  <span className={`admin-feature-user-presence${userKey.online ? " online" : ""}`} />
                                  <span className="admin-feature-user-name">{userKey.label}<small>{userKey.key_prefix} · {userKey.status}</small></span>
                                  <span className="admin-feature-user-online">{userKey.online ? "Online" : "Offline"}</span>
                                </label>
                              );
                            }) : <div className="admin-feature-user-empty">No users match this search.</div>}
                          </div>
                          {matchingUsers.length > visibleUsers.length && <small className="admin-feature-user-limit">Showing {visibleUsers.length} of {matchingUsers.length} matches. Search to narrow the list.</small>}
                          {!userKeys.length && <small className="admin-feature-user-limit">No user keys have been created yet. New users are included automatically when All users is selected.</small>}
                        </div>
                      )}
                      <div className="admin-feature-control-actions">
                        <button type="button" className="secondary-button" onClick={() => saveFeatureControl(control.feature)} disabled={!changed || !savedControl || updateFeatureSettings.isPending}>
                          <Save size={14} />{updateFeatureSettings.isPending ? "Saving…" : "Save"}
                        </button>
                        <button type="button" className="key-action" onClick={() => cancelFeatureControl(control.feature)} disabled={!changed || updateFeatureSettings.isPending}>
                          <X size={14} />Cancel
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="admin-bot-controls">
                <label className={`admin-protection-toggle ${featureSettingsDraft.auto_trader_2_paused ? "selected" : ""}`}>
                  <input type="checkbox" checked={featureSettingsDraft.auto_trader_2_paused} onChange={(event) => setFeatureSettingsDraft({ ...featureSettingsDraft, auto_trader_2_paused: event.target.checked })} />
                  <span className="admin-protection-switch"><i /></span>
                  <span><b>Pause Auto Trader 2.0</b><small>Blocks new bot entries; open contracts are not closed.</small></span>
                </label>
                <label className="admin-control-field"><span>Auto Trader 2.0 pause message</span><input type="text" maxLength={300} value={featureSettingsDraft.auto_trader_2_pause_message} onChange={(event) => setFeatureSettingsDraft({ ...featureSettingsDraft, auto_trader_2_pause_message: event.target.value })} /></label>
                <div className="admin-feature-control-actions admin-settings-actions">
                  <button type="button" className="secondary-button" onClick={saveAutoTrader2Controls} disabled={!featureSettingsQuery.data || updateFeatureSettings.isPending || (featureSettingsDraft.auto_trader_2_paused === featureSettingsQuery.data.auto_trader_2_paused && featureSettingsDraft.auto_trader_2_pause_message === featureSettingsQuery.data.auto_trader_2_pause_message)}>
                    <Save size={14} />{updateFeatureSettings.isPending ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="key-action" onClick={cancelAutoTrader2Controls} disabled={!featureSettingsQuery.data || updateFeatureSettings.isPending || (featureSettingsDraft.auto_trader_2_paused === featureSettingsQuery.data.auto_trader_2_paused && featureSettingsDraft.auto_trader_2_pause_message === featureSettingsQuery.data.auto_trader_2_pause_message)}>
                    <X size={14} />Cancel
                  </button>
                </div>
                <label className="admin-protection-toggle admin-announcement-toggle">
                  <input type="checkbox" checked={featureSettingsDraft.global_announcement_enabled} onChange={(event) => setFeatureSettingsDraft({ ...featureSettingsDraft, global_announcement_enabled: event.target.checked })} />
                  <span className="admin-protection-switch"><i /></span>
                  <span><b>Show a global announcement</b><small>Broadcast to every user until they dismiss it. Saving again republishes it.</small></span>
                </label>
                <label className="admin-control-field admin-announcement-message"><span>Global announcement</span><textarea rows={2} maxLength={500} value={featureSettingsDraft.global_announcement} onChange={(event) => setFeatureSettingsDraft({ ...featureSettingsDraft, global_announcement: event.target.value })} placeholder="Enter the message users should see" /></label>
                <div className="admin-feature-control-actions admin-announcement-actions">
                  <button type="button" className="secondary-button" onClick={saveAnnouncement} disabled={!featureSettingsQuery.data || updateFeatureSettings.isPending || (featureSettingsDraft.global_announcement_enabled === featureSettingsQuery.data.global_announcement_enabled && featureSettingsDraft.global_announcement === featureSettingsQuery.data.global_announcement && (!featureSettingsDraft.global_announcement_enabled || !featureSettingsDraft.global_announcement.trim()))}>
                    <Save size={14} />{updateFeatureSettings.isPending ? "Saving…" : "Save"}
                  </button>
                  <button type="button" className="key-action" onClick={cancelAnnouncement} disabled={!featureSettingsQuery.data || updateFeatureSettings.isPending || (featureSettingsDraft.global_announcement_enabled === featureSettingsQuery.data.global_announcement_enabled && featureSettingsDraft.global_announcement === featureSettingsQuery.data.global_announcement)}>
                    <X size={14} />Cancel
                  </button>
                </div>
              </div>
            </>
          )}
        </section>

        <section className="admin-stat-grid">
          {stats.map((stat) => <div className="admin-stat panel" key={stat.label}><div className="admin-stat-top"><span>{stat.label}</span><stat.icon size={16} /></div><strong>{stat.value}</strong><small>{stat.detail}</small></div>)}
        </section>

        {newKey && (
          <section className="new-key-callout">
            <div className="new-key-icon"><Check size={20} /></div>
             <div><span className="panel-overline">ONE-TIME KEY — COPY BEFORE CLOSING</span><h3>{newKey.label}: {newKey.kind === "admin" ? "administrator" : "user"} key is ready</h3><code>{newKey.value}</code></div>
            <button type="button" className="copy-key-button" onClick={copyKey}><Copy size={15} /> Copy key</button>
            <button type="button" className="dismiss-key" onClick={() => setNewKey(null)} aria-label="Hide new key">×</button>
          </section>
        )}

        <section className="panel admin-protection-card">
          <div className="panel-header">
            <div><span className="panel-overline">GLOBAL ENTRY SHIELD</span><h3>Market-quality protection</h3></div>
            <ShieldCheck size={19} className="panel-icon" />
          </div>
          <p className="admin-protection-intro">These administrator-only switches add a shared pre-entry quality check for every trading feature and every access key. They do not stop running contracts, change stop controls, or alter settlement behavior.</p>
          {protectionQuery.isError ? (
            <div className="admin-form-error">Unable to load the global protection settings. Refresh the page and sign in again as the primary administrator.</div>
          ) : (
            <div className="admin-protection-grid">
              <label className={`admin-protection-toggle ${protection.weekdays_enabled ? "selected" : ""}`}>
                <input type="checkbox" checked={protection.weekdays_enabled} onChange={(event) => updateProtectionSetting("weekdays_enabled", event.target.checked)} disabled={updateProtection.isPending} />
                <span className="admin-protection-switch"><i /></span>
                <span><b>Weekdays</b><small>Monday–Friday</small></span>
              </label>
                <label className={`admin-protection-toggle ${protection.weekends_enabled ? "selected" : ""}`}>
                <input type="checkbox" checked={protection.weekends_enabled} onChange={(event) => updateProtectionSetting("weekends_enabled", event.target.checked)} disabled={updateProtection.isPending} />
                <span className="admin-protection-switch"><i /></span>
                  <span><b>Weekends</b><small>Saturday–Sunday</small></span>
              </label>
              <label className={`admin-protection-toggle ${protection.dual_weekends_weekdays_enabled ? "selected" : ""}`}>
                <input type="checkbox" checked={protection.dual_weekends_weekdays_enabled} onChange={(event) => updateProtectionSetting("dual_weekends_weekdays_enabled", event.target.checked)} disabled={updateProtection.isPending} />
                <span className="admin-protection-switch"><i /></span>
                <span><b>Dual Weekends and Weekdays</b><small>Every day</small></span>
              </label>
            </div>
          )}
          <div className="admin-protection-footnote"><Activity size={14} /> Active switches hold entries with thin samples or weak observed setups. Settings stay hidden from regular users.</div>
        </section>

        <section className="admin-create-layout">
          <div className="panel admin-create-card">
            <div className="panel-header"><div><span className="panel-overline">PROVISION ACCESS</span><h3>Create a new key</h3></div><Plus size={19} className="panel-icon" /></div>
            {formError && <div className="admin-form-error">{formError}</div>}
            <form onSubmit={handleCreate} className="admin-key-form">
              <label className="admin-field"><span>LABEL</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Alex — desktop" maxLength={120} /></label>
              <div className="admin-form-row">
                <label className="admin-field"><span>KEY TYPE</span><select value={kind} onChange={(event) => setKind(event.target.value as "user" | "admin")}><option value="user">User key</option><option value="admin">Administrator key</option></select></label>
                <label className="admin-field"><span>DEVICES ALLOWED</span><input type="number" min={1} max={50} disabled={kind === "admin" && unlimitedDevices} value={maxDevices} onChange={(event) => setMaxDevices(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></label>
              </div>
              {kind === "admin" && <label className="admin-unlimited-toggle"><input type="checkbox" checked={unlimitedDevices} onChange={(event) => setUnlimitedDevices(event.target.checked)} /><span>Unlimited devices</span></label>}
              <div className="admin-feature-picker"><span className="admin-field-label">FEATURE ACCESS</span>{featureOptions.map((feature) => <label className={`admin-feature-option ${kind === "admin" || features.includes(feature.value) ? "selected" : ""}`} key={feature.value}><input type="checkbox" checked={kind === "admin" || features.includes(feature.value)} disabled={kind === "admin"} onChange={() => toggleFeature(feature.value)} /><span><b>{feature.label}</b><small>{feature.description}</small></span></label>)}</div>
              <button type="submit" className="primary-button admin-create-submit" disabled={!canCreate}><KeyRound size={16} />{createKey.isPending ? "Generating…" : `Generate ${kind === "admin" ? "admin" : "user"} key`}</button>
            </form>
          </div>
            <div className="admin-safety-note admin-key-features-note"><div className="admin-safety-icon"><KeyRound size={20} /></div><h3>Key features</h3><ul><li>Grant EDGE, DigitFlip, Trade X, Bulk Trader, Clock Work, Cash Grab, Money Bank, Auto Trader, Auto Trader 2.0, Settings, or History independently.</li><li>Shadows 3 is an additional Cash Grab gate and immediate-stop control.</li><li>If a feature is not granted, the workspace shows “Restricted — admin access only.”</li><li>Edit access later to unlock a feature without issuing a replacement key.</li><li>Delete permanently revokes the key. Its name can be reused, but the old key can never sign in again.</li></ul></div>
        </section>

        <section className="panel admin-directory">
          <div className="panel-header"><div><span className="panel-overline">LIVE DIRECTORY</span><h3>Access keys and presence</h3></div><span className="directory-note">{keys.length} records · {onlineCount} online</span></div>
          {keysQuery.isLoading ? <div className="admin-empty"><RefreshCw className="spin" size={20} /> Loading access keys…</div> : keysQuery.isError ? <div className="admin-empty admin-empty-error">Unable to load the access directory. Sign in again as an administrator.</div> : keys.length === 0 ? <div className="admin-empty">No keys created yet. Generate the first user key above.</div> : <div className="key-directory">{keys.map((item) => <KeyRow key={item.key_id} item={item} deletingKey={deletingKeyIds.has(item.key_id)} onStatus={handleStatus} onUpdate={handleUpdate} onReset={handleReset} onDelete={handleDelete} />)}</div>}
        </section>
      </div>
    </AppShell>
  );
}