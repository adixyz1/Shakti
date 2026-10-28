import React, { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  Download,
  Edit2,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { PageLayout } from '../components/PageLayout';
import { DemoSimulatePanel } from '../components/DemoSimulatePanel';
import { Button, Card, Spinner } from '../components/ui';
import {
  adminAuditApi,
  adminMetricsApi,
  adminRespondersApi,
  demoApi,
  resourcesPulseApi,
  safetyToolsApi,
  type AdminResponderDto,
  type ImpactMetricsResponseDto,
  type IncidentAccessAuditDto,
  type MetricEntryDto,
  type ResourceDto,
  type SafetyToolDto,
} from '../lib/api';
import { useDemoStore } from '../store/demoStore';

const RESOURCE_CATEGORY_OPTIONS = [
  'emergency_helpline',
  'women_helpline',
  'one_stop_centre',
  'campus_security',
  'legal_aid',
  'counseling',
] as const;

const SAFETY_TOOL_CATEGORY_OPTIONS = [
  'personal_alarm_keychain',
  'whistle',
  'torch_keyring',
  'portable_door_alarm',
  'pepper_spray',
  'self_defence',
] as const;

export const AdminPage: React.FC = () => {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();

  const initialTab: 'analytics' | 'tools' = location.pathname.endsWith('/tools')
    ? 'tools'
    : 'analytics';
  const [activeTab, setActiveTab] = useState<'analytics' | 'tools'>(initialTab);

  useEffect(() => {
    if (location.pathname.endsWith('/tools')) {
      setActiveTab('tools');
    } else if (location.pathname === '/admin') {
      setActiveTab('analytics');
    }
  }, [location.pathname]);

  // =========================================================================
  // Analytics Tab State
  // =========================================================================
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [metricsData, setMetricsData] =
    useState<ImpactMetricsResponseDto | null>(null);
  const [isLoadingMetrics, setIsLoadingMetrics] = useState<boolean>(true);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [isDownloadingCsv, setIsDownloadingCsv] = useState<boolean>(false);
  const [isResettingDemo, setIsResettingDemo] = useState<boolean>(false);
  const [demoResetFeedback, setDemoResetFeedback] = useState<string | null>(
    null
  );
  const { demoMode } = useDemoStore();

  const loadMetrics = useCallback(async (fromVal?: string, toVal?: string) => {
    setIsLoadingMetrics(true);
    setMetricsError(null);
    try {
      const res = await adminMetricsApi.getMetrics({
        from: fromVal || undefined,
        to: toVal || undefined,
      });
      setMetricsData(res);
    } catch (err) {
      setMetricsError(
        err instanceof Error ? err.message : 'Failed to load impact metrics'
      );
    } finally {
      setIsLoadingMetrics(false);
    }
  }, []);

  useEffect(() => {
    void loadMetrics();
  }, [loadMetrics]);

  const handleApplyDateFilter = (e: React.FormEvent) => {
    e.preventDefault();
    void loadMetrics(fromDate.trim(), toDate.trim());
  };

  const handleDownloadCsv = async () => {
    setIsDownloadingCsv(true);
    try {
      const csvText = await adminMetricsApi.downloadMetricsCsvText({
        from: fromDate.trim() || undefined,
        to: toDate.trim() || undefined,
      });
      if (typeof window !== 'undefined' && typeof Blob !== 'undefined') {
        const blob = new Blob([csvText], { type: 'text/csv;charset=utf-8;' });
        if (typeof URL.createObjectURL === 'function') {
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.setAttribute('download', 'saathi-impact-metrics.csv');
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          if (typeof URL.revokeObjectURL === 'function') {
            URL.revokeObjectURL(url);
          }
        }
      }
    } catch (err) {
      setMetricsError(
        err instanceof Error ? err.message : 'Failed to download CSV'
      );
    } finally {
      setIsDownloadingCsv(false);
    }
  };

  // =========================================================================
  // Admin Tools Tab State: Audit Log, Responders, Resources
  // =========================================================================
  const [auditEntries, setAuditEntries] = useState<IncidentAccessAuditDto[]>(
    []
  );
  const [auditIncidentFilter, setAuditIncidentFilter] = useState<string>('');
  const [auditActorFilter, setAuditActorFilter] = useState<
    'all' | 'contact' | 'responder' | 'admin'
  >('all');
  const [isLoadingAudit, setIsLoadingAudit] = useState<boolean>(false);

  const [responders, setResponders] = useState<AdminResponderDto[]>([]);
  const [isLoadingResponders, setIsLoadingResponders] =
    useState<boolean>(false);
  const [responderWarning, setResponderWarning] = useState<string | null>(null);
  const [pendingConfirmOff, setPendingConfirmOff] = useState<{
    responderId: string;
    responderName: string;
    field: 'active' | 'on_duty';
  } | null>(null);

  const [resources, setResources] = useState<ResourceDto[]>([]);
  const [isLoadingResources, setIsLoadingResources] = useState<boolean>(false);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(
    null
  );
  const [resFormName, setResFormName] = useState<string>('');
  const [resFormCategory, setResFormCategory] =
    useState<string>('campus_security');
  const [resFormPhone, setResFormPhone] = useState<string>('');
  const [resFormHours, setResFormHours] = useState<string>('24x7');
  const [resFormDescription, setResFormDescription] = useState<string>('');
  const [isSavingResource, setIsSavingResource] = useState<boolean>(false);

  const [safetyTools, setSafetyTools] = useState<SafetyToolDto[]>([]);
  const [isLoadingSafetyTools, setIsLoadingSafetyTools] = useState<boolean>(false);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [toolFormCategory, setToolFormCategory] = useState<string>('personal_alarm_keychain');
  const [toolFormTitle, setToolFormTitle] = useState<string>('');
  const [toolFormDesc, setToolFormDesc] = useState<string>('');
  const [toolFormSafeUse, setToolFormSafeUse] = useState<string>('');
  const [toolFormLegalNote, setToolFormLegalNote] = useState<string>('');
  const [toolFormUrl, setToolFormUrl] = useState<string>('');
  const [toolFormLinkLabel, setToolFormLinkLabel] = useState<string>('Add a trusted seller link');
  const [toolFormLastChecked, setToolFormLastChecked] = useState<string>('2026-10-28');
  const [toolFormActive, setToolFormActive] = useState<boolean>(true);
  const [toolFormAffiliate, setToolFormAffiliate] = useState<boolean>(false);
  const [isSavingTool, setIsSavingTool] = useState<boolean>(false);
  const [toolFormError, setToolFormError] = useState<string | null>(null);

  const loadAuditLogs = useCallback(
    async (
      incFilter: string,
      actorFilter: 'all' | 'contact' | 'responder' | 'admin'
    ) => {
      setIsLoadingAudit(true);
      try {
        const res = await adminAuditApi.listAuditLogs(
          incFilter.trim() || undefined,
          actorFilter === 'all' ? undefined : actorFilter
        );
        setAuditEntries(res.entries || []);
      } catch {
        setAuditEntries([]);
      } finally {
        setIsLoadingAudit(false);
      }
    },
    []
  );

  const loadResponders = useCallback(async () => {
    setIsLoadingResponders(true);
    try {
      const res = await adminRespondersApi.listResponders();
      setResponders(res.responders || []);
    } catch {
      setResponders([]);
    } finally {
      setIsLoadingResponders(false);
    }
  }, []);

  const loadResources = useCallback(async () => {
    setIsLoadingResources(true);
    try {
      const res = await resourcesPulseApi.listResources();
      setResources(res.resources || []);
    } catch {
      setResources([]);
    } finally {
      setIsLoadingResources(false);
    }
  }, []);

  const loadSafetyTools = useCallback(async () => {
    setIsLoadingSafetyTools(true);
    try {
      const res = await safetyToolsApi.listSafetyTools({ include_inactive: true });
      setSafetyTools(res.safety_tools || []);
    } catch {
      setSafetyTools([]);
    } finally {
      setIsLoadingSafetyTools(false);
    }
  }, []);

  useEffect(() => {
    if (activeTab === 'tools') {
      void loadAuditLogs(auditIncidentFilter, auditActorFilter);
      void loadResponders();
      void loadResources();
      void loadSafetyTools();
    }
  }, [
    activeTab,
    auditIncidentFilter,
    auditActorFilter,
    loadAuditLogs,
    loadResponders,
    loadResources,
    loadSafetyTools,
  ]);

  const executeResponderUpdate = async (
    responderId: string,
    payload: { active?: boolean; on_duty?: boolean }
  ) => {
    setPendingConfirmOff(null);
    try {
      const res = await adminRespondersApi.updateResponder(
        responderId,
        payload
      );
      setResponders((prev) =>
        prev.map((r) => (r.id === responderId ? res.responder : r))
      );
      setResponderWarning(res.warning || null);
      void loadAuditLogs(auditIncidentFilter, auditActorFilter);
    } catch {
      // ignore error in UI
    }
  };

  const handleToggleResponder = (
    resp: AdminResponderDto,
    field: 'active' | 'on_duty',
    nextValue: boolean
  ) => {
    // Turning a responder OFF requires an explicit confirm tap first
    if (!nextValue) {
      setPendingConfirmOff({
        responderId: resp.id,
        responderName: resp.name,
        field,
      });
      return;
    }
    void executeResponderUpdate(resp.id, { [field]: true });
  };

  const handleSaveResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resFormName.trim() || !resFormPhone.trim()) return;
    setIsSavingResource(true);
    try {
      if (editingResourceId) {
        await resourcesPulseApi.updateResource(editingResourceId, {
          name: resFormName.trim(),
          category: resFormCategory,
          phone: resFormPhone.trim(),
          available_hours: resFormHours.trim() || '24x7',
          description: resFormDescription.trim() || resFormName.trim(),
          active: true,
        });
      } else {
        await resourcesPulseApi.createResource({
          name: resFormName.trim(),
          category: resFormCategory,
          phone: resFormPhone.trim(),
          available_hours: resFormHours.trim() || '24x7',
          description: resFormDescription.trim() || resFormName.trim(),
          active: true,
        });
      }
      setEditingResourceId(null);
      setResFormName('');
      setResFormPhone('');
      setResFormHours('24x7');
      setResFormDescription('');
      await loadResources();
    } finally {
      setIsSavingResource(false);
    }
  };

  const handleEditResourceClick = (item: ResourceDto) => {
    setEditingResourceId(item.id);
    setResFormName(item.name);
    setResFormCategory(item.category);
    setResFormPhone(item.phone);
    setResFormHours(item.available_hours);
    setResFormDescription(item.description);
  };

  const handleDeleteResource = async (id: string) => {
    await resourcesPulseApi.deleteResource(id);
    await loadResources();
  };

  const handleSaveSafetyTool = async (e: React.FormEvent) => {
    e.preventDefault();
    setToolFormError(null);
    if (
      !toolFormTitle.trim() ||
      !toolFormDesc.trim() ||
      !toolFormSafeUse.trim() ||
      !toolFormLegalNote.trim()
    ) {
      setToolFormError(
        'Please fill in title, description, safe use notes, and legal note.'
      );
      return;
    }
    if (toolFormUrl.trim() && !toolFormUrl.trim().startsWith('https://')) {
      setToolFormError('Link URL must use HTTPS protocol (https://)');
      return;
    }

    setIsSavingTool(true);
    try {
      if (editingToolId) {
        await safetyToolsApi.updateSafetyTool(editingToolId, {
          category: toolFormCategory,
          title: toolFormTitle.trim(),
          description: toolFormDesc.trim(),
          safe_use_notes: toolFormSafeUse.trim(),
          legal_note: toolFormLegalNote.trim(),
          link_url: toolFormUrl.trim() || null,
          link_label: toolFormLinkLabel.trim() || 'Add a trusted seller link',
          last_checked: toolFormLastChecked.trim() || '2026-10-28',
          active: toolFormActive,
          is_affiliate: toolFormAffiliate,
        });
      } else {
        await safetyToolsApi.createSafetyTool({
          category: toolFormCategory,
          title: toolFormTitle.trim(),
          description: toolFormDesc.trim(),
          safe_use_notes: toolFormSafeUse.trim(),
          legal_note: toolFormLegalNote.trim(),
          link_url: toolFormUrl.trim() || null,
          link_label: toolFormLinkLabel.trim() || 'Add a trusted seller link',
          last_checked: toolFormLastChecked.trim() || '2026-10-28',
          active: toolFormActive,
          is_affiliate: toolFormAffiliate,
        });
      }
      setEditingToolId(null);
      setToolFormTitle('');
      setToolFormDesc('');
      setToolFormSafeUse('');
      setToolFormLegalNote('');
      setToolFormUrl('');
      setToolFormLinkLabel('Add a trusted seller link');
      setToolFormLastChecked('2026-10-28');
      setToolFormActive(true);
      setToolFormAffiliate(false);
      await loadSafetyTools();
    } catch (err: unknown) {
      setToolFormError(
        err instanceof Error ? err.message : 'Failed to save safety tool.'
      );
    } finally {
      setIsSavingTool(false);
    }
  };

  const handleEditToolClick = (tool: SafetyToolDto) => {
    setEditingToolId(tool.id);
    setToolFormCategory(tool.category);
    setToolFormTitle(tool.title);
    setToolFormDesc(tool.description);
    setToolFormSafeUse(tool.safe_use_notes);
    setToolFormLegalNote(tool.legal_note);
    setToolFormUrl(tool.link_url || '');
    setToolFormLinkLabel(tool.link_label);
    setToolFormLastChecked(tool.last_checked);
    setToolFormActive(tool.active);
    setToolFormAffiliate(tool.is_affiliate);
    setToolFormError(null);
  };

  const handleCancelEditTool = () => {
    setEditingToolId(null);
    setToolFormTitle('');
    setToolFormDesc('');
    setToolFormSafeUse('');
    setToolFormLegalNote('');
    setToolFormUrl('');
    setToolFormLinkLabel('Add a trusted seller link');
    setToolFormLastChecked('2026-10-28');
    setToolFormActive(true);
    setToolFormAffiliate(false);
    setToolFormError(null);
  };

  const handleDeleteSafetyTool = async (id: string) => {
    await safetyToolsApi.deleteSafetyTool(id);
    await loadSafetyTools();
  };

  const formatMetricValue = (entry: MetricEntryDto): string => {
    if (entry.insufficient_data || entry.value === null) {
      return t('admin.notEnoughData');
    }
    if (entry.unit === 'seconds') {
      return `${entry.value} s`;
    }
    if (entry.unit === 'percent') {
      return `${entry.value}%`;
    }
    if (entry.unit === 'score_1_to_5') {
      return `${entry.value} / 5`;
    }
    return String(entry.value);
  };

  const renderMetricCard = (
    key: keyof ImpactMetricsResponseDto['metrics'],
    entry: MetricEntryDto,
    extraContent?: React.ReactNode
  ) => {
    return (
      <Card
        key={key}
        data-testid={`metric-card-${key}`}
        className="p-5 space-y-2 border border-slate-200 dark:border-slate-800"
      >
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
            {t(`admin.metrics.${key}`, { defaultValue: entry.metric })}
          </h3>
          {entry.target && (
            <span
              data-testid={`metric-target-${key}`}
              className="text-xs text-slate-600 dark:text-slate-400 tabular-nums shrink-0"
            >
              {t('admin.targetLabel', { target: entry.target })}
            </span>
          )}
        </div>

        <div
          data-testid={`metric-value-${key}`}
          className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50"
        >
          {formatMetricValue(entry)}
        </div>

        <div className="text-xs text-slate-500 dark:text-slate-400 tabular-nums flex flex-wrap items-center gap-2">
          <span>{t('admin.sampleCountLabel', { n: entry.n })}</span>
          <span aria-hidden="true">·</span>
          <span>{entry.formula}</span>
        </div>

        {extraContent}
      </Card>
    );
  };

  // Prepare Recharts data when metrics are loaded
  const channelChartData = metricsData
    ? Object.entries(
        metricsData.metrics.notification_delivery_rate.by_channel || {}
      ).map(([ch, stats]) => ({
        channel: ch.toUpperCase(),
        rate: stats.insufficient_data || stats.value === null ? 0 : stats.value,
        n: stats.n,
        insufficient_data: stats.insufficient_data,
      }))
    : [];

  const pulseChartData = metricsData
    ? (metricsData.metrics.safety_pulse.by_week || []).map((w) => ({
        week: w.week,
        average_score:
          w.insufficient_data || w.average_score === null ? 0 : w.average_score,
        avoided_percent:
          w.insufficient_data || w.avoided_going_somewhere_percent === null
            ? 0
            : w.avoided_going_somewhere_percent,
        n: w.n,
        insufficient_data: w.insufficient_data,
      }))
    : [];

  return (
    <PageLayout>
      <div className="max-w-5xl mx-auto space-y-6" data-testid="admin-page">
        {/* Header & Prototype Banner */}
        <header className="space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-2 text-teal-800 dark:text-teal-400">
              <ShieldCheck className="w-6 h-6 shrink-0" aria-hidden="true" />
              <h1 className="text-2xl font-bold tracking-tight">
                {t('admin.title')}
              </h1>
            </div>

            {/* Segmented Tab Controls (Analytics vs Tools) */}
            <div
              role="tablist"
              aria-label="Admin sections"
              className="inline-flex items-center gap-1 p-1 bg-slate-200 dark:bg-slate-800 rounded-xl"
            >
              <button
                type="button"
                role="tab"
                data-testid="admin-tab-analytics"
                aria-selected={activeTab === 'analytics'}
                onClick={() => {
                  setActiveTab('analytics');
                  if (location.pathname !== '/admin') {
                    navigate('/admin');
                  }
                }}
                className={`min-h-[40px] px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'analytics'
                    ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-700 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                {t('admin.tabs.analytics')}
              </button>
              <button
                type="button"
                role="tab"
                data-testid="admin-tab-tools"
                aria-selected={activeTab === 'tools'}
                onClick={() => {
                  setActiveTab('tools');
                  if (location.pathname !== '/admin/tools') {
                    navigate('/admin/tools');
                  }
                }}
                className={`min-h-[40px] px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                  activeTab === 'tools'
                    ? 'bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 shadow-sm'
                    : 'text-slate-700 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                {t('admin.tabs.tools')}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              data-testid="admin-prototype-banner"
              className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 px-4 py-2.5 text-xs font-semibold text-amber-900 dark:text-amber-200 flex-1"
            >
              {t('admin.prototypeBanner')}
            </div>

            {(demoMode || metricsData?.includes_demo_data) && (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  data-testid="admin-includes-demo-badge"
                  className="inline-flex items-center px-3 py-2 rounded-xl border border-amber-400 dark:border-amber-600 bg-amber-100 dark:bg-amber-950 text-xs font-bold text-amber-950 dark:text-amber-200"
                >
                  {t('demo.includesDemoDataBadge', 'Includes demo data')}
                </span>
                {demoMode && (
                  <Button
                    type="button"
                    variant="secondary"
                    data-testid="admin-demo-reset-btn"
                    isLoading={isResettingDemo}
                    onClick={async () => {
                      setIsResettingDemo(true);
                      setDemoResetFeedback(null);
                      try {
                        await demoApi.resetDemoData();
                        setDemoResetFeedback(t('demo.resetSuccess'));
                        await loadMetrics(fromDate.trim(), toDate.trim());
                      } finally {
                        setIsResettingDemo(false);
                      }
                    }}
                    className="text-xs"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t('demo.resetBtn', 'Reset Demo Data')}
                  </Button>
                )}
              </div>
            )}
          </div>

          {demoResetFeedback && (
            <div
              role="status"
              data-testid="admin-demo-reset-feedback"
              className="rounded-xl border border-teal-500/50 bg-teal-50 dark:bg-teal-950/60 px-4 py-2.5 text-xs font-semibold text-teal-900 dark:text-teal-200"
            >
              {demoResetFeedback}
            </div>
          )}

          <DemoSimulatePanel
            onSimulated={() => {
              void loadMetrics(fromDate.trim(), toDate.trim());
              if (activeTab === 'tools') {
                void loadAuditLogs(auditIncidentFilter, auditActorFilter);
              }
            }}
          />
        </header>

        {/* ================================================================= */}
        {/* TAB 1: IMPACT ANALYTICS                                           */}
        {/* ================================================================= */}
        {activeTab === 'analytics' && (
          <section
            aria-label={t('admin.tabs.analytics')}
            data-testid="admin-analytics-section"
            className="space-y-6"
          >
            {/* Date Range Filter & CSV Export */}
            <Card className="p-5">
              <form
                onSubmit={handleApplyDateFilter}
                className="flex flex-col sm:flex-row sm:items-end justify-between gap-4"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 flex-1">
                  <div>
                    <label
                      htmlFor="admin-from-date"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      {t('admin.filters.fromLabel')}
                    </label>
                    <input
                      id="admin-from-date"
                      type="date"
                      data-testid="admin-from-date"
                      value={fromDate}
                      onChange={(e) => setFromDate(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 tabular-nums"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="admin-to-date"
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      {t('admin.filters.toLabel')}
                    </label>
                    <input
                      id="admin-to-date"
                      type="date"
                      data-testid="admin-to-date"
                      value={toDate}
                      onChange={(e) => setToDate(e.target.value)}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 tabular-nums"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="submit"
                    data-testid="admin-apply-date-filter-btn"
                    isLoading={isLoadingMetrics}
                  >
                    <RefreshCw className="w-4 h-4" />
                    {t('admin.filters.applyBtn')}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    data-testid="admin-download-csv-btn"
                    isLoading={isDownloadingCsv}
                    onClick={() => void handleDownloadCsv()}
                  >
                    <Download className="w-4 h-4" />
                    {t('admin.filters.downloadCsvBtn')}
                  </Button>
                </div>
              </form>
            </Card>

            {metricsError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"
              >
                {metricsError}
              </div>
            )}

            {isLoadingMetrics && !metricsData ? (
              <div className="py-12 flex justify-center">
                <Spinner className="w-8 h-8 text-teal-700 dark:text-teal-400" />
              </div>
            ) : (
              metricsData && (
                <>
                  {/* KPI Cards Grid */}
                  <div
                    className="grid grid-cols-1 md:grid-cols-2 gap-4"
                    data-testid="admin-kpi-grid"
                  >
                    {/* 1. Alert-initiation time + clock-skew footnote + separate queued-then-delivered card */}
                    {renderMetricCard(
                      'alert_initiation_time',
                      metricsData.metrics.alert_initiation_time,
                      <p
                        data-testid="clock-skew-footnote"
                        className="text-xs text-slate-500 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800 tabular-nums"
                      >
                        {t('admin.clockSkewFootnote', {
                          count:
                            metricsData.metrics.alert_initiation_time
                              .excluded_implausible ?? 0,
                        })}
                      </p>
                    )}

                    {/* Separate card for queued-then-delivered offline alerts */}
                    <Card
                      data-testid="queued-then-delivered-card"
                      className="p-5 space-y-2 border border-slate-200 dark:border-slate-800"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                          {t('admin.queuedSeparateTitle')}
                        </h3>
                        <span className="text-xs text-slate-500 dark:text-slate-400">
                          queued-then-delivered
                        </span>
                      </div>
                      <div
                        data-testid="queued-then-delivered-value"
                        className="text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-50"
                      >
                        {metricsData.metrics.alert_initiation_time
                          .queued_then_delivered?.insufficient_data ||
                        metricsData.metrics.alert_initiation_time
                          .queued_then_delivered?.value === null ||
                        metricsData.metrics.alert_initiation_time
                          .queued_then_delivered?.value === undefined
                          ? t('admin.notEnoughData')
                          : `${metricsData.metrics.alert_initiation_time.queued_then_delivered.value} s`}
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {t('admin.sampleCountLabel', {
                          n:
                            metricsData.metrics.alert_initiation_time
                              .queued_then_delivered?.n ?? 0,
                        })}
                      </p>
                    </Card>

                    {/* 2. Time to active */}
                    {renderMetricCard(
                      'time_to_active',
                      metricsData.metrics.time_to_active
                    )}

                    {/* 3. Notification delivery rate */}
                    {renderMetricCard(
                      'notification_delivery_rate',
                      metricsData.metrics.notification_delivery_rate,
                      <div
                        data-testid="delivery-by-channel-summary"
                        className="text-xs text-slate-600 dark:text-slate-400 pt-1 border-t border-slate-100 dark:border-slate-800 tabular-nums flex flex-wrap gap-3"
                      >
                        {Object.entries(
                          metricsData.metrics.notification_delivery_rate
                            .by_channel || {}
                        ).map(([ch, st]) => (
                          <span key={ch}>
                            {ch.toUpperCase()}:{' '}
                            {st.insufficient_data || st.value === null
                              ? t('admin.notEnoughData')
                              : `${st.value}%`}{' '}
                            (n={st.n})
                          </span>
                        ))}
                      </div>
                    )}

                    {/* 4. Time to first acknowledgement */}
                    {renderMetricCard(
                      'time_to_first_acknowledgement',
                      metricsData.metrics.time_to_first_acknowledgement,
                      <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                        p90:{' '}
                        {metricsData.metrics.time_to_first_acknowledgement
                          .insufficient_data ||
                        metricsData.metrics.time_to_first_acknowledgement
                          .p90_seconds === null
                          ? t('admin.notEnoughData')
                          : `${metricsData.metrics.time_to_first_acknowledgement.p90_seconds} s`}
                      </p>
                    )}

                    {/* 5. Time to resolution */}
                    {renderMetricCard(
                      'time_to_resolution',
                      metricsData.metrics.time_to_resolution
                    )}

                    {/* 6. Cancellation rate & False-alarm rate */}
                    {renderMetricCard(
                      'cancellation_rate',
                      metricsData.metrics.cancellation_rate
                    )}
                    {renderMetricCard(
                      'false_alarm_rate',
                      metricsData.metrics.false_alarm_rate
                    )}

                    {/* 7. Location availability */}
                    {renderMetricCard(
                      'location_availability',
                      metricsData.metrics.location_availability,
                      <div className="text-xs text-slate-600 dark:text-slate-400 tabular-nums flex flex-wrap gap-3">
                        <span>
                          Median accuracy:{' '}
                          {metricsData.metrics.location_availability
                            .median_accuracy_meters === null ||
                          metricsData.metrics.location_availability
                            .median_accuracy_meters === undefined
                            ? t('admin.notEnoughData')
                            : `${metricsData.metrics.location_availability.median_accuracy_meters} m`}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Location consent off:{' '}
                          {metricsData.metrics.location_availability
                            .location_consent_off_count ?? 0}
                        </span>
                      </div>
                    )}

                    {/* 8. Audit completeness */}
                    {renderMetricCard(
                      'audit_completeness',
                      metricsData.metrics.audit_completeness
                    )}

                    {/* 9. Safety pulse */}
                    {renderMetricCard(
                      'safety_pulse',
                      metricsData.metrics.safety_pulse,
                      <p className="text-xs text-slate-600 dark:text-slate-400 tabular-nums">
                        Avoided going somewhere:{' '}
                        {metricsData.metrics.safety_pulse.insufficient_data ||
                        metricsData.metrics.safety_pulse
                          .avoided_going_somewhere_percent === null
                          ? t('admin.notEnoughData')
                          : `${metricsData.metrics.safety_pulse.avoided_going_somewhere_percent}%`}
                      </p>
                    )}

                    {/* 10. Post-incident trust score */}
                    {renderMetricCard(
                      'post_incident_trust_score',
                      metricsData.metrics.post_incident_trust_score
                    )}
                  </div>

                  {/* Charts Section (Recharts) */}
                  <div
                    className="grid grid-cols-1 lg:grid-cols-2 gap-4"
                    data-testid="admin-charts-section"
                  >
                    <Card className="p-5 space-y-3">
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {t('admin.charts.channelTitle')}
                      </h2>
                      <div className="h-56 w-full" data-testid="chart-delivery-channel">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={channelChartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="channel" />
                            <YAxis domain={[0, 100]} />
                            <Tooltip />
                            <Bar dataKey="rate" fill="#0f766e" name="Delivery %" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>

                    <Card className="p-5 space-y-3">
                      <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                        {t('admin.charts.pulseTitle')}
                      </h2>
                      <div className="h-56 w-full" data-testid="chart-safety-pulse">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={pulseChartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="week" />
                            <YAxis />
                            <Tooltip />
                            <Legend />
                            <Line
                              type="monotone"
                              dataKey="average_score"
                              stroke="#0f766e"
                              name="Avg Score (1-5)"
                            />
                            <Line
                              type="monotone"
                              dataKey="avoided_percent"
                              stroke="#b45309"
                              name="% Avoided"
                            />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </Card>
                  </div>
                </>
              )
            )}
          </section>
        )}

        {/* ================================================================= */}
        {/* TAB 2: ADMIN TOOLS (Audit Log, Responders, Resource Directory)     */}
        {/* ================================================================= */}
        {activeTab === 'tools' && (
          <section
            aria-label={t('admin.tabs.tools')}
            data-testid="admin-tools-section"
            className="space-y-6"
          >
            {/* 1. Responder Roster & Active/On-Duty Controls */}
            <Card className="p-5 space-y-4" data-testid="admin-responders-panel">
              <div className="space-y-1">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {t('admin.tools.respondersTitle')}
                </h2>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {t('admin.tools.routingNote')}
                </p>
              </div>

              {responderWarning && (
                <div
                  role="alert"
                  data-testid="responder-zero-warning"
                  className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/60 p-4 flex items-start gap-3 text-sm font-semibold text-amber-950 dark:text-amber-200"
                >
                  <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
                  <span>{responderWarning}</span>
                </div>
              )}

              {pendingConfirmOff && (
                <div
                  role="region"
                  aria-label="Confirm turning off responder"
                  data-testid="confirm-turn-off-banner"
                  className="rounded-xl border-2 border-rose-600 bg-rose-50 dark:bg-rose-950/60 p-4 space-y-3"
                >
                  <p className="text-sm font-semibold text-rose-950 dark:text-rose-100">
                    {t('admin.tools.confirmTurnOffPrompt')}{' '}
                    {pendingConfirmOff.responderName} (
                    {pendingConfirmOff.field === 'active'
                      ? t('admin.tools.responderActiveLabel')
                      : t('admin.tools.responderOnDutyLabel')}
                    )
                  </p>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      data-testid="confirm-turn-off-btn"
                      onClick={() =>
                        void executeResponderUpdate(
                          pendingConfirmOff.responderId,
                          { [pendingConfirmOff.field]: false }
                        )
                      }
                      className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-bold bg-rose-700 text-white hover:bg-rose-800 whitespace-nowrap"
                    >
                      {t('admin.tools.confirmTurnOffBtn')}
                    </button>
                    <button
                      type="button"
                      data-testid="cancel-turn-off-btn"
                      onClick={() => setPendingConfirmOff(null)}
                      className="min-h-[44px] px-4 py-2 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 text-slate-800 dark:text-slate-200 whitespace-nowrap"
                    >
                      {t('admin.tools.cancelTurnOffBtn')}
                    </button>
                  </div>
                </div>
              )}

              {isLoadingResponders ? (
                <Spinner className="w-6 h-6 text-teal-700" />
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800">
                  {responders.map((resp) => (
                    <div
                      key={resp.id}
                      data-testid={`admin-responder-row-${resp.id}`}
                      className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div>
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {resp.name}
                        </p>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          {resp.organization_zone}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-3">
                        <button
                          type="button"
                          data-testid={`toggle-responder-active-${resp.id}`}
                          aria-pressed={resp.active}
                          onClick={() =>
                            handleToggleResponder(resp, 'active', !resp.active)
                          }
                          className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border whitespace-nowrap ${
                            resp.active
                              ? 'bg-teal-800 text-white border-teal-800'
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          {t('admin.tools.responderActiveLabel')}:{' '}
                          {resp.active ? 'ON' : 'OFF'}
                        </button>

                        <button
                          type="button"
                          data-testid={`toggle-responder-onduty-${resp.id}`}
                          aria-pressed={resp.on_duty}
                          onClick={() =>
                            handleToggleResponder(
                              resp,
                              'on_duty',
                              !resp.on_duty
                            )
                          }
                          className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border whitespace-nowrap ${
                            resp.on_duty
                              ? 'bg-teal-800 text-white border-teal-800'
                              : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                          }`}
                        >
                          {t('admin.tools.responderOnDutyLabel')}:{' '}
                          {resp.on_duty ? 'ON' : 'OFF'}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 2. Audit Log Viewer with Filters */}
            <Card className="p-5 space-y-4" data-testid="admin-audit-panel">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {t('admin.tools.auditTitle')}
              </h2>

              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="search"
                  data-testid="admin-audit-incident-filter"
                  value={auditIncidentFilter}
                  onChange={(e) => setAuditIncidentFilter(e.target.value)}
                  placeholder={t('admin.tools.auditIncidentFilterPlaceholder')}
                  className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                />

                <div className="flex flex-wrap gap-1.5">
                  {(['all', 'contact', 'responder', 'admin'] as const).map(
                    (actor) => (
                      <button
                        key={actor}
                        type="button"
                        data-testid={`admin-audit-actor-${actor}`}
                        aria-pressed={auditActorFilter === actor}
                        onClick={() => setAuditActorFilter(actor)}
                        className={`min-h-[44px] px-3 py-1.5 rounded-xl text-xs font-semibold border whitespace-nowrap ${
                          auditActorFilter === actor
                            ? 'bg-teal-800 text-white border-teal-800'
                            : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                        }`}
                      >
                        {actor === 'all'
                          ? t('admin.tools.auditActorFilterAll')
                          : actor === 'contact'
                          ? t('admin.tools.auditActorContact')
                          : actor === 'responder'
                          ? t('admin.tools.auditActorResponder')
                          : t('admin.tools.auditActorAdmin')}
                      </button>
                    )
                  )}
                </div>
              </div>

              {isLoadingAudit ? (
                <Spinner className="w-6 h-6 text-teal-700" />
              ) : auditEntries.length === 0 ? (
                <p
                  data-testid="admin-audit-empty"
                  className="text-sm text-slate-600 dark:text-slate-300 py-4"
                >
                  {t('admin.tools.auditEmpty')}
                </p>
              ) : (
                <div
                  className="divide-y divide-slate-200 dark:divide-slate-800"
                  data-testid="admin-audit-list"
                >
                  {auditEntries.map((entry) => (
                    <div
                      key={entry.id}
                      data-testid={`audit-entry-${entry.id}`}
                      className="py-2.5 text-xs space-y-1"
                    >
                      <div className="flex flex-wrap items-center gap-2 text-slate-700 dark:text-slate-300 tabular-nums">
                        <span className="font-semibold">
                          {entry.actor_label || entry.actor_id}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{entry.actor_type}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{entry.action}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{entry.incident_id}</span>
                        <span aria-hidden="true">·</span>
                        <span>{entry.created_at}</span>
                      </div>
                      {entry.detail && (
                        <p className="text-slate-600 dark:text-slate-400">
                          {entry.detail}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 3. Resource Directory Editor */}
            <Card className="p-5 space-y-4" data-testid="admin-resources-panel">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                {t('admin.tools.resourcesTitle')}
              </h2>

              <form
                onSubmit={handleSaveResource}
                className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800"
              >
                <div>
                  <label
                    htmlFor="admin-res-name"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('admin.tools.resourceNameLabel')}
                  </label>
                  <input
                    id="admin-res-name"
                    type="text"
                    data-testid="admin-res-name-input"
                    value={resFormName}
                    onChange={(e) => setResFormName(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-res-category"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('admin.tools.resourceCategoryLabel')}
                  </label>
                  <select
                    id="admin-res-category"
                    data-testid="admin-res-category-select"
                    value={resFormCategory}
                    onChange={(e) => setResFormCategory(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {RESOURCE_CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="admin-res-phone"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('admin.tools.resourcePhoneLabel')}
                  </label>
                  <input
                    id="admin-res-phone"
                    type="text"
                    data-testid="admin-res-phone-input"
                    value={resFormPhone}
                    onChange={(e) => setResFormPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-res-hours"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('admin.tools.resourceHoursLabel')}
                  </label>
                  <input
                    id="admin-res-hours"
                    type="text"
                    data-testid="admin-res-hours-input"
                    value={resFormHours}
                    onChange={(e) => setResFormHours(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="admin-res-desc"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('admin.tools.resourceDescriptionLabel')}
                  </label>
                  <input
                    id="admin-res-desc"
                    type="text"
                    data-testid="admin-res-desc-input"
                    value={resFormDescription}
                    onChange={(e) => setResFormDescription(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>

                <div className="sm:col-span-2 flex justify-end gap-2">
                  <Button
                    type="submit"
                    data-testid="admin-res-save-btn"
                    isLoading={isSavingResource}
                  >
                    <Plus className="w-4 h-4" />
                    {editingResourceId
                      ? t('admin.tools.saveResourceBtn')
                      : t('admin.tools.addResourceBtn')}
                  </Button>
                </div>
              </form>

              {isLoadingResources ? (
                <Spinner className="w-6 h-6 text-teal-700" />
              ) : (
                <div
                  className="divide-y divide-slate-200 dark:divide-slate-800"
                  data-testid="admin-resources-list"
                >
                  {resources.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`admin-resource-row-${item.id}`}
                      className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                    >
                      <div className="space-y-0.5">
                        <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                          {item.name}
                        </p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {item.category} · {item.phone} · {item.available_hours}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          data-testid={`admin-edit-resource-${item.id}`}
                          onClick={() => handleEditResourceClick(item)}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 inline-flex items-center gap-1"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                          {t('admin.tools.editResourceBtn')}
                        </button>
                        <button
                          type="button"
                          data-testid={`admin-delete-resource-${item.id}`}
                          onClick={() => void handleDeleteResource(item.id)}
                          className="min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold border border-rose-300 text-rose-700 inline-flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          {t('admin.tools.deleteResourceBtn')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* 4. Safety Tools Guide Editor */}
            <Card className="p-5 space-y-4" data-testid="admin-safety-tools-panel">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  {t('safetyTools.admin.safetyToolsTitle')}
                </h2>
                {editingToolId && (
                  <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    Editing ID: {editingToolId}
                  </span>
                )}
              </div>

              {toolFormError && (
                <div
                  data-testid="admin-tool-error-msg"
                  className="p-3 text-xs font-semibold rounded-xl bg-rose-50 border border-rose-200 text-rose-800 dark:bg-rose-950/40 dark:border-rose-900 dark:text-rose-200"
                >
                  {toolFormError}
                </div>
              )}

              <form
                onSubmit={handleSaveSafetyTool}
                className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 text-left"
              >
                <div>
                  <label
                    htmlFor="admin-tool-title"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('safetyTools.admin.titleLabel')}
                  </label>
                  <input
                    id="admin-tool-title"
                    type="text"
                    data-testid="admin-tool-title-input"
                    value={toolFormTitle}
                    onChange={(e) => setToolFormTitle(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-tool-category"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('safetyTools.admin.categoryLabel')}
                  </label>
                  <select
                    id="admin-tool-category"
                    data-testid="admin-tool-category-select"
                    value={toolFormCategory}
                    onChange={(e) => setToolFormCategory(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  >
                    {SAFETY_TOOL_CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {t(`safetyTools.categories.${c}`, { defaultValue: c })}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label
                    htmlFor="admin-tool-desc"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('safetyTools.admin.descriptionLabel')}
                  </label>
                  <textarea
                    id="admin-tool-desc"
                    rows={2}
                    data-testid="admin-tool-desc-input"
                    value={toolFormDesc}
                    onChange={(e) => setToolFormDesc(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-tool-safe-use"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('safetyTools.admin.safeUseLabel')}
                  </label>
                  <textarea
                    id="admin-tool-safe-use"
                    rows={2}
                    data-testid="admin-tool-safe-use-input"
                    value={toolFormSafeUse}
                    onChange={(e) => setToolFormSafeUse(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-tool-legal-note"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('safetyTools.admin.legalNoteLabel')}
                  </label>
                  <textarea
                    id="admin-tool-legal-note"
                    rows={2}
                    data-testid="admin-tool-legal-note-input"
                    value={toolFormLegalNote}
                    onChange={(e) => setToolFormLegalNote(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                    required
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-tool-url"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('safetyTools.admin.urlLabel')}
                  </label>
                  <input
                    id="admin-tool-url"
                    type="url"
                    placeholder="https://"
                    data-testid="admin-tool-url-input"
                    value={toolFormUrl}
                    onChange={(e) => setToolFormUrl(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-tool-link-label"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('safetyTools.admin.linkLabelLabel')}
                  </label>
                  <input
                    id="admin-tool-link-label"
                    type="text"
                    data-testid="admin-tool-link-label-input"
                    value={toolFormLinkLabel}
                    onChange={(e) => setToolFormLinkLabel(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>

                <div>
                  <label
                    htmlFor="admin-tool-last-checked"
                    className="block text-xs font-semibold mb-1"
                  >
                    {t('safetyTools.admin.lastCheckedLabel')}
                  </label>
                  <input
                    id="admin-tool-last-checked"
                    type="text"
                    placeholder="YYYY-MM-DD"
                    data-testid="admin-tool-last-checked-input"
                    value={toolFormLastChecked}
                    onChange={(e) => setToolFormLastChecked(e.target.value)}
                    className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                  />
                </div>

                <div className="flex items-center gap-6 pt-5">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                    <input
                      type="checkbox"
                      data-testid="admin-tool-affiliate-checkbox"
                      checked={toolFormAffiliate}
                      onChange={(e) => setToolFormAffiliate(e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    <span>{t('safetyTools.admin.isAffiliateLabel')}</span>
                  </label>

                  <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold">
                    <input
                      type="checkbox"
                      data-testid="admin-tool-active-checkbox"
                      checked={toolFormActive}
                      onChange={(e) => setToolFormActive(e.target.checked)}
                      className="w-4 h-4 rounded"
                    />
                    <span>{t('safetyTools.admin.activeLabel')}</span>
                  </label>
                </div>

                <div className="sm:col-span-2 flex items-center gap-2 pt-2">
                  <Button
                    type="submit"
                    variant="primary"
                    data-testid="admin-tool-save-btn"
                    isLoading={isSavingTool}
                  >
                    {editingToolId
                      ? t('safetyTools.admin.saveToolBtn')
                      : t('safetyTools.admin.addToolBtn')}
                  </Button>
                  {editingToolId && (
                    <Button
                      type="button"
                      variant="outline"
                      data-testid="admin-tool-cancel-btn"
                      onClick={handleCancelEditTool}
                    >
                      {t('safetyTools.admin.cancelEditBtn')}
                    </Button>
                  )}
                </div>
              </form>

              {isLoadingSafetyTools ? (
                <Spinner className="w-6 h-6 text-teal-700" />
              ) : (
                <div
                  className="divide-y divide-slate-200 dark:divide-slate-800 text-left"
                  data-testid="admin-safety-tools-list"
                >
                  {SAFETY_TOOL_CATEGORY_OPTIONS.map((cat) => {
                    const catTools = safetyTools.filter(
                      (tItem) => tItem.category.toLowerCase() === cat
                    );
                    if (catTools.length === 0) {
                      return (
                        <div
                          key={cat}
                          data-testid={`admin-tool-category-${cat}`}
                          className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                        >
                          <div className="space-y-0.5">
                            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {t(`safetyTools.categories.${cat}`, {
                                defaultValue: cat,
                              })}
                            </p>
                            <p className="text-xs text-slate-600 dark:text-slate-400">
                              {t(`safetyTools.categories.${cat}`, {
                                defaultValue: cat,
                              })}{' '}
                              · {t('safetyTools.noLinksAddedYet')}
                            </p>
                          </div>
                        </div>
                      );
                    }
                    return catTools.map((tool) => (
                      <div
                        key={tool.id}
                        data-testid={`admin-tool-row-${tool.id}`}
                        className="py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                              {tool.title}
                            </p>
                            {tool.is_affiliate && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                                Affiliate
                              </span>
                            )}
                            {!tool.active && (
                              <span className="text-[10px] font-medium px-2 py-0.5 rounded bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400">
                                Inactive
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600 dark:text-slate-400">
                            {t(`safetyTools.categories.${tool.category}`, {
                              defaultValue: tool.category,
                            })}{' '}
                            · Last checked: {tool.last_checked} ·{' '}
                            {tool.link_url ? (
                              <a
                                href={tool.link_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="underline font-medium text-teal-700 dark:text-teal-400"
                              >
                                {tool.link_label || tool.title}
                              </a>
                            ) : (
                              t('safetyTools.noLinksAddedYet')
                            )}
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            data-testid={`admin-edit-tool-${tool.id}`}
                            onClick={() => handleEditToolClick(tool)}
                            className="min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold border border-slate-300 dark:border-slate-700 inline-flex items-center gap-1"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                            {t('safetyTools.admin.editToolBtn')}
                          </button>
                          <button
                            type="button"
                            data-testid={`admin-delete-tool-${tool.id}`}
                            onClick={() => void handleDeleteSafetyTool(tool.id)}
                            className="min-h-[40px] px-3 py-1.5 rounded-xl text-xs font-semibold border border-rose-300 text-rose-700 inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            {t('safetyTools.admin.deleteToolBtn')}
                          </button>
                        </div>
                      </div>
                    ));
                  })}
                </div>
              )}
            </Card>
          </section>
        )}
      </div>
    </PageLayout>
  );
};
