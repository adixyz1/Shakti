import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  Navigation,
  PhoneCall,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';
import { BigButton, Card, Spinner } from '../components/ui';
import { PageLayout } from '../components/PageLayout';
import {
  responderApi,
  type ResponderActionType,
  type ResponderIncidentDetailDto,
  type ResponderIncidentListItemDto,
  type ResponderProfileDto,
} from '../lib/api';

const OPEN_STATUSES = [
  'TRIGGERED',
  'ACTIVE',
  'NOTIFIED',
  'ACKNOWLEDGED',
  'RESPONDING',
];

const ResponderLeafletMap: React.FC<{
  lat: number;
  lng: number;
  label: string;
}> = ({ lat, lng, label }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    try {
      if (!mapInstanceRef.current) {
        const map = L.map(el, {
          center: [lat, lng],
          zoom: 15,
          attributionControl: true,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);

        const marker = L.circleMarker([lat, lng], {
          radius: 10,
          color: '#0f766e',
          fillColor: '#14b8a6',
          fillOpacity: 0.85,
          weight: 3,
        })
          .addTo(map)
          .bindPopup(label);

        mapInstanceRef.current = map;
        markerRef.current = marker;
      } else {
        mapInstanceRef.current.setView([lat, lng], 15);
        if (markerRef.current) {
          markerRef.current.setLatLng([lat, lng]);
          markerRef.current.setPopupContent(label);
        }
      }
    } catch {
      // Fallback gracefully in environments without full layout canvas (e.g. JSDOM)
    }

    return () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch {
          // ignore
        }
        mapInstanceRef.current = null;
        markerRef.current = null;
      }
    };
  }, [lat, lng, label]);

  return (
    <div
      ref={containerRef}
      role="region"
      data-testid="responder-leaflet-map"
      aria-label={`Map showing latest location (${lat.toFixed(5)}, ${lng.toFixed(5)})`}
      className="w-full h-60 rounded-2xl border border-slate-300 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-900"
    />
  );
};

export const ResponderDashboardPage: React.FC = () => {
  const { t } = useTranslation();

  const [responderProfile, setResponderProfile] =
    useState<ResponderProfileDto | null>(null);
  const [colleagues, setColleagues] = useState<ResponderProfileDto[]>([]);
  const [incidents, setIncidents] = useState<ResponderIncidentListItemDto[]>(
    []
  );
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(
    null
  );
  const [selectedDetail, setSelectedDetail] =
    useState<ResponderIncidentDetailDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isDetailLoading, setIsDetailLoading] = useState<boolean>(false);
  const [submittingAction, setSubmittingAction] =
    useState<ResponderActionType | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const [noteInput, setNoteInput] = useState<string>('');
  const [falseAlarmReason, setFalseAlarmReason] = useState<string>('');
  const [showFalseAlarmForm, setShowFalseAlarmForm] = useState<boolean>(false);
  const [assignTargetUserId, setAssignTargetUserId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>(
    'ALL'
  );
  const [timerElapsedSec, setTimerElapsedSec] = useState<number>(0);

  const [wsConnected, setWsConnected] = useState<boolean>(false);
  const [lastFetchedAtMs, setLastFetchedAtMs] = useState<number>(Date.now());
  const [freshnessTick, setFreshnessTick] = useState<number>(0);

  const selectedIncidentIdRef = useRef<string | null>(null);
  selectedIncidentIdRef.current = selectedIncidentId;

  const loadIncidentDetail = useCallback(async (id: string) => {
    setIsDetailLoading(true);
    try {
      const res = await responderApi.getIncidentDetail(id);
      setSelectedDetail(res.incident);
      setLastFetchedAtMs(Date.now());
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Failed to load incident details.'
      );
    } finally {
      setIsDetailLoading(false);
    }
  }, []);

  const loadIncidentsList = useCallback(
    async (preserveSelection = true) => {
      try {
        const data = await responderApi.listIncidents();
        setResponderProfile(data.responder);
        setColleagues(data.colleagues);
        setIncidents(data.incidents);
        setLastFetchedAtMs(Date.now());

        if (!assignTargetUserId && data.responder?.user_id) {
          setAssignTargetUserId(data.responder.user_id);
        }

        const currentSelected = selectedIncidentIdRef.current;
        if (preserveSelection && currentSelected) {
          const stillExists = data.incidents.some(
            (i) => i.id === currentSelected
          );
          if (stillExists) {
            const detailRes = await responderApi.getIncidentDetail(
              currentSelected
            );
            setSelectedDetail(detailRes.incident);
          }
        } else if (!currentSelected && data.incidents.length > 0) {
          const firstId = data.incidents[0].id;
          setSelectedIncidentId(firstId);
          const detailRes = await responderApi.getIncidentDetail(firstId);
          setSelectedDetail(detailRes.incident);
        }
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : 'Failed to load incidents.'
        );
      } finally {
        setIsLoading(false);
      }
    },
    [assignTargetUserId]
  );

  useEffect(() => {
    void loadIncidentsList(false);
  }, [loadIncidentsList]);

  // Connect to /ws for live responder updates + periodic polling fallback
  useEffect(() => {
    let ws: WebSocket | null = null;
    try {
      const isJsdomDefaultHost =
        typeof navigator !== 'undefined' &&
        /jsdom/i.test(navigator.userAgent || '') &&
        typeof window !== 'undefined' &&
        window.location.port === '3000';

      if (
        !isJsdomDefaultHost &&
        typeof window !== 'undefined' &&
        typeof WebSocket !== 'undefined'
      ) {
        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const host = window.location.host || 'localhost:3000';
        ws = new WebSocket(`${proto}//${host}/ws`);

        ws.onopen = () => {
          setWsConnected(true);
        };
        ws.onmessage = (ev) => {
          try {
            const msg = JSON.parse(String(ev.data));
            if (msg?.type === 'incident_updated') {
              void loadIncidentsList(true);
            }
          } catch {
            // ignore
          }
        };
        ws.onclose = () => {
          setWsConnected(false);
        };
        ws.onerror = () => {
          setWsConnected(false);
        };
      }
    } catch {
      setWsConnected(false);
    }

    const pollInterval = setInterval(() => {
      setFreshnessTick((n) => n + 1);
    }, 5000);

    return () => {
      clearInterval(pollInterval);
      if (ws) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
    };
  }, [loadIncidentsList]);

  const handleSelectIncident = async (id: string) => {
    setSelectedIncidentId(id);
    setActionFeedback(null);
    setActionError(null);
    setShowFalseAlarmForm(false);
    await loadIncidentDetail(id);
  };

  const handleResponderAction = async (
    action: ResponderActionType,
    payload: { note?: string; target_responder_user_id?: string } = {}
  ) => {
    if (!selectedIncidentId) return;
    setSubmittingAction(action);
    setActionError(null);
    setActionFeedback(null);

    try {
      const res = await responderApi.performAction(
        selectedIncidentId,
        action,
        payload
      );
      setSelectedDetail(res.incident);
      setActionFeedback(t('responderDashboard.actionSuccess', { action }));
      if (action === 'note') {
        setNoteInput('');
      }
      if (action === 'false-alarm') {
        setFalseAlarmReason('');
        setShowFalseAlarmForm(false);
      }
      // Refresh list items so status badge in the left column updates immediately
      const listData = await responderApi.listIncidents();
      setIncidents(listData.incidents);
      setLastFetchedAtMs(Date.now());
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'Could not complete action.'
      );
    } finally {
      setSubmittingAction(null);
    }
  };

  const formatFreshnessSeconds = (msAgo: number): string => {
    const sec = Math.max(0, Math.round(msAgo / 1000));
    if (sec < 60) return `${sec}s ago`;
    return `${Math.round(sec / 60)}m ago`;
  };

  // reference freshnessTick to keep freshness label reactive
  void freshnessTick;
  const listFreshnessText = formatFreshnessSeconds(
    Date.now() - lastFetchedAtMs
  );

  const isSelectedOpen = selectedDetail
    ? OPEN_STATUSES.includes(selectedDetail.status)
    : false;

  const isResponseTimerStopped = Boolean(
    selectedDetail &&
      (selectedDetail.acknowledged_by_responder ||
        selectedDetail.status === 'ACKNOWLEDGED' ||
        selectedDetail.status === 'RESPONDING' ||
        !OPEN_STATUSES.includes(selectedDetail.status))
  );

  useEffect(() => {
    if (!selectedDetail) {
      setTimerElapsedSec(0);
      return;
    }
    const createdMs = new Date(
      selectedDetail.activated_at || selectedDetail.created_at
    ).getTime();
    const ackAssign = selectedDetail.assignments?.find(
      (a) => a.acknowledged_at
    );
    const ackMs = ackAssign?.acknowledged_at
      ? new Date(ackAssign.acknowledged_at).getTime()
      : null;

    if (isResponseTimerStopped) {
      if (ackMs && !Number.isNaN(ackMs) && !Number.isNaN(createdMs)) {
        setTimerElapsedSec(Math.max(0, Math.round((ackMs - createdMs) / 1000)));
      }
      return;
    }

    const computeElapsed = () => {
      if (Number.isNaN(createdMs)) return 0;
      return Math.max(0, Math.round((Date.now() - createdMs) / 1000));
    };

    setTimerElapsedSec((prev) => Math.max(prev, computeElapsed()));
    const timerId = setInterval(() => {
      setTimerElapsedSec((prev) => Math.max(prev + 1, computeElapsed()));
    }, 1000);

    return () => {
      clearInterval(timerId);
    };
  }, [
    selectedDetail?.id,
    selectedDetail?.activated_at,
    selectedDetail?.created_at,
    isResponseTimerStopped,
  ]);

  const filteredIncidents = incidents.filter((item) => {
    const isOpen = OPEN_STATUSES.includes(item.status);
    if (statusFilter === 'OPEN') return isOpen;
    if (statusFilter === 'CLOSED') return !isOpen;
    return true;
  });

  return (
    <PageLayout>
      <div
        data-testid="responder-dashboard-page"
        className="space-y-6 pb-8 text-slate-900 dark:text-slate-100"
      >
      {/* Header & Freshness Bar */}
      <Card className="border-2 border-teal-700 dark:border-teal-500 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
              {t('responderDashboard.kicker')}
            </p>
            <h1
              data-testid="responder-dashboard-title"
              className="text-2xl font-bold text-slate-900 dark:text-slate-50"
            >
              {t('responderDashboard.title')}
            </h1>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {responderProfile && (
              <>
                <span
                  data-testid="responder-zone-badge"
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-teal-100 dark:bg-teal-950 text-teal-900 dark:text-teal-200 border border-teal-300 dark:border-teal-800"
                >
                  {t('responderDashboard.zoneBadge', {
                    zone: responderProfile.organization_zone,
                  })}
                </span>
                <span
                  data-testid="responder-duty-badge"
                  className="px-3 py-1.5 rounded-xl text-xs font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-800"
                >
                  {responderProfile.on_duty
                    ? t('responderDashboard.dutyBadgeOn')
                    : t('responderDashboard.dutyBadgeOff')}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200 dark:border-slate-800 text-xs font-mono">
          <span
            data-testid="responder-list-freshness-label"
            className="text-slate-700 dark:text-slate-300"
          >
            {wsConnected
              ? t('responderDashboard.freshnessLiveWs', {
                  freshness: listFreshnessText,
                })
              : t('responderDashboard.freshnessPolling', {
                  freshness: listFreshnessText,
                })}
          </span>

          <button
            type="button"
            data-testid="responder-refresh-btn"
            onClick={() => void loadIncidentsList(true)}
            className="min-h-[44px] px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 font-sans font-semibold text-xs inline-flex items-center gap-1.5 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            {t('responderDashboard.refreshNowBtn')}
          </button>
        </div>
      </Card>

      {isLoading ? (
        <div className="py-12 flex flex-col items-center justify-center gap-3 text-teal-700 dark:text-teal-400">
          <Spinner className="w-8 h-8" />
          <span className="text-sm">{t('sos.loading')}</span>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Live Incident List (Open First) */}
          <div className="lg:col-span-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t('responderDashboard.incidentListTitle')} (
                {filteredIncidents.length})
              </h2>
              <div
                data-testid="responder-status-filter"
                className="inline-flex items-center gap-1 rounded-xl border border-slate-300 dark:border-slate-700 p-1 bg-white dark:bg-slate-900 text-xs font-bold"
                role="group"
                aria-label={t('responderDashboard.filterLabel')}
              >
                {(['ALL', 'OPEN', 'CLOSED'] as const).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    data-testid={`responder-filter-${mode.toLowerCase()}`}
                    onClick={() => setStatusFilter(mode)}
                    className={`px-2.5 py-1 rounded-lg transition-colors ${
                      statusFilter === mode
                        ? 'bg-teal-700 text-white'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {mode === 'ALL'
                      ? t('responderDashboard.filterAll')
                      : mode === 'OPEN'
                      ? t('responderDashboard.filterOpen')
                      : t('responderDashboard.filterClosed')}
                  </button>
                ))}
              </div>
            </div>

            {filteredIncidents.length === 0 ? (
              <Card
                data-testid="responder-empty-list"
                className="text-sm text-slate-600 dark:text-slate-300 py-8 text-center"
              >
                {t('responderDashboard.emptyList')}
              </Card>
            ) : (
              <div
                data-testid="responder-incident-list"
                className="space-y-3"
              >
                {filteredIncidents.map((item) => {
                  const isOpen = OPEN_STATUSES.includes(item.status);
                  const isSelected = item.id === selectedIncidentId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-testid={`responder-incident-item-${item.id}`}
                      onClick={() => void handleSelectIncident(item.id)}
                      className={`w-full text-left rounded-2xl p-4 border-2 transition-colors space-y-2 ${
                        isSelected
                          ? 'border-teal-700 dark:border-teal-400 bg-teal-50/70 dark:bg-teal-950/40'
                          : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-slate-300 dark:hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-base text-slate-900 dark:text-slate-50">
                          {item.user_first_name}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {item.is_duress && (
                            <span
                              data-testid={`responder-list-duress-badge-${item.id}`}
                              className="px-2 py-0.5 rounded-md text-xs font-bold bg-rose-700 text-white"
                            >
                              {t('responderDashboard.duressTag')}
                            </span>
                          )}
                          <span
                            data-testid={`responder-list-status-${item.id}`}
                            className={`px-2.5 py-0.5 rounded-md text-xs font-mono font-bold ${
                              isOpen
                                ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'
                                : 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {item.status}
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600 dark:text-slate-400">
                        <span>
                          {item.emergency_type ||
                            t('responderDashboard.emergencyTypeUnspecified')}
                        </span>
                        <span className="font-mono">
                          {new Date(item.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Right Column: Selected Incident Detail, Map, Responder Actions, Events Timeline */}
          <div className="lg:col-span-7 space-y-5">
            {isDetailLoading && !selectedDetail ? (
              <Card className="py-12 flex flex-col items-center justify-center gap-3">
                <Spinner className="w-7 h-7" />
              </Card>
            ) : !selectedDetail ? (
              <Card className="py-12 text-center text-sm text-slate-600 dark:text-slate-300">
                {t('responderDashboard.selectIncidentPrompt')}
              </Card>
            ) : (
              <div
                data-testid="responder-incident-detail"
                className="space-y-5"
              >
                {/* Duress Warning Banner (if incident is_duress) */}
                {selectedDetail.is_duress && (
                  <div
                    role="alert"
                    data-testid="responder-duress-banner"
                    className="rounded-2xl border-2 border-rose-600 bg-rose-50 dark:bg-rose-950/90 p-5 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-rose-900 dark:text-rose-200 font-bold text-base">
                      <ShieldAlert className="w-6 h-6 shrink-0 text-rose-700 dark:text-rose-400" />
                      <span>{t('responderDashboard.duressWarningTitle')}</span>
                    </div>
                    <p
                      data-testid="responder-duress-notice-text"
                      className="text-sm font-medium text-rose-950 dark:text-rose-100 leading-relaxed"
                    >
                      {selectedDetail.duress_notice ||
                        t('responderDashboard.duressWarningBody')}
                    </p>
                  </div>
                )}

                {/* Summary Card (Minimum needed: first name, phone ONLY after acknowledging, emergency type, time, real status) */}
                <Card className="space-y-4 border-2 border-slate-300 dark:border-slate-700">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h2
                        data-testid="responder-detail-victim-name"
                        className="text-xl font-bold text-slate-900 dark:text-slate-50"
                      >
                        {t('responderDashboard.victimLabel', {
                          firstName: selectedDetail.user_first_name,
                        })}
                      </h2>
                      <p
                        data-testid="responder-detail-phone"
                        className="text-sm font-mono mt-1 text-slate-700 dark:text-slate-300"
                      >
                        {selectedDetail.user_phone_e164
                          ? t('responderDashboard.phoneRevealed', {
                              phone: selectedDetail.user_phone_e164,
                            })
                          : t('responderDashboard.phoneHiddenUntilAck')}
                      </p>
                    </div>

                    <span
                      data-testid="responder-detail-status"
                      className="px-3 py-1 rounded-xl text-xs font-mono font-bold bg-teal-100 dark:bg-teal-950 text-teal-900 dark:text-teal-200 border border-teal-300 dark:border-teal-800"
                    >
                      {t('responderDashboard.statusLabel', {
                        status: selectedDetail.status,
                      })}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-sm">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
                      <span data-testid="responder-detail-type">
                        {t('responderDashboard.emergencyTypeLabel', {
                          type:
                            selectedDetail.emergency_type ||
                            t('responderDashboard.emergencyTypeUnspecified'),
                        })}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-teal-700 shrink-0" />
                      <span data-testid="responder-detail-time">
                        {t('responderDashboard.triggeredAtLabel', {
                          time: new Date(
                            selectedDetail.created_at
                          ).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                        })}
                      </span>
                    </div>
                  </div>

                  {/* Response Timer & Mock 112 Gateway Status */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800 text-xs font-mono">
                    <div
                      data-testid="responder-response-timer"
                      data-timer-state={
                        isResponseTimerStopped ? 'stopped' : 'running'
                      }
                      className="flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-semibold"
                    >
                      <Clock className="w-4 h-4 text-teal-700 shrink-0" />
                      <span>
                        {isResponseTimerStopped
                          ? t('responderDashboard.responseTimerStopped', {
                              elapsed: `${timerElapsedSec}s`,
                            })
                          : t('responderDashboard.responseTimerRunning', {
                              elapsed: `${timerElapsedSec}s`,
                            })}
                      </span>
                    </div>

                    <div
                      data-testid="responder-mock-112-status"
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/60 border border-amber-300 dark:border-amber-800 text-amber-950 dark:text-amber-100"
                    >
                      <span className="font-semibold">
                        {t('responderDashboard.mock112Status', {
                          provider:
                            selectedDetail.mock_112_gateway?.provider ||
                            'MockEmergencyGateway',
                          status:
                            selectedDetail.mock_112_gateway?.status ||
                            'standby',
                        })}
                      </span>
                      <span
                        data-testid="responder-mock-112-badge"
                        className="px-2 py-0.5 rounded-md bg-amber-700 text-white font-bold uppercase tracking-wider"
                      >
                        {selectedDetail.mock_112_gateway?.label ||
                          t('responderDashboard.mock112Label')}
                      </span>
                    </div>
                  </div>
                </Card>

                {/* Map & Latest Location Card with "last updated" label */}
                <Card
                  data-testid="responder-location-card"
                  className="space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <MapPin className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                      <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {t('responderDashboard.mapSectionTitle')}
                      </h3>
                    </div>

                    {selectedDetail.latest_location && (
                      <span
                        data-testid="responder-map-last-updated"
                        className="text-xs font-mono text-slate-600 dark:text-slate-300"
                      >
                        {t('responderDashboard.mapLastUpdated', {
                          time: new Date(
                            selectedDetail.latest_location.captured_at
                          ).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          }),
                          freshness: formatFreshnessSeconds(
                            Date.now() -
                              new Date(
                                selectedDetail.latest_location.captured_at
                              ).getTime()
                          ),
                        })}
                      </span>
                    )}
                  </div>

                  {!selectedDetail.latest_location ? (
                    <p
                      data-testid="responder-location-omitted"
                      className="text-sm text-slate-600 dark:text-slate-300"
                    >
                      {t('responderDashboard.mapNoConsent')}
                    </p>
                  ) : (
                    <div className="space-y-2">
                      <ResponderLeafletMap
                        lat={selectedDetail.latest_location.lat}
                        lng={selectedDetail.latest_location.lng}
                        label={`${selectedDetail.user_first_name}`}
                      />
                      <p
                        data-testid="responder-location-coords"
                        className="text-xs font-mono text-slate-700 dark:text-slate-300"
                      >
                        Coordinates:{' '}
                        {selectedDetail.latest_location.lat.toFixed(5)},{' '}
                        {selectedDetail.latest_location.lng.toFixed(5)}
                        {selectedDetail.latest_location.accuracy_m !== null
                          ? ` (±${Math.round(selectedDetail.latest_location.accuracy_m)}m)`
                          : ''}
                      </p>
                    </div>
                  )}
                </Card>

                {/* Responder Actions Card (Large targets >=56px, High contrast) */}
                <Card
                  data-testid="responder-actions-card"
                  className="space-y-4"
                >
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t('responderDashboard.actionsSectionTitle')}
                  </h3>

                  {actionFeedback && (
                    <div
                      role="status"
                      data-testid="responder-action-feedback"
                      className="rounded-xl border border-teal-500/60 bg-teal-50 dark:bg-teal-950/60 p-3 flex items-center gap-2 text-sm font-semibold text-teal-900 dark:text-teal-200"
                    >
                      <ShieldCheck className="w-5 h-5 shrink-0" />
                      <span>{actionFeedback}</span>
                    </div>
                  )}

                  {actionError && (
                    <p
                      role="alert"
                      data-testid="responder-action-error"
                      className="text-sm font-semibold text-rose-700 dark:text-rose-400"
                    >
                      {actionError}
                    </p>
                  )}

                  {isSelectedOpen && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <BigButton
                        type="button"
                        variant="primary"
                        data-testid="responder-btn-acknowledge"
                        isLoading={submittingAction === 'acknowledge'}
                        onClick={() =>
                          void handleResponderAction('acknowledge')
                        }
                      >
                        <ShieldCheck className="w-5 h-5" />
                        {t('responderDashboard.acknowledgeBtn')}
                      </BigButton>

                      <BigButton
                        type="button"
                        variant="primary"
                        data-testid="responder-btn-responding"
                        isLoading={submittingAction === 'responding'}
                        onClick={() => void handleResponderAction('responding')}
                      >
                        <Navigation className="w-5 h-5" />
                        {t('responderDashboard.respondingBtn')}
                      </BigButton>

                      <BigButton
                        type="button"
                        variant="secondary"
                        data-testid="responder-btn-resolve"
                        isLoading={submittingAction === 'resolve'}
                        onClick={() => void handleResponderAction('resolve')}
                      >
                        <CheckCircle2 className="w-5 h-5" />
                        {t('responderDashboard.resolveBtn')}
                      </BigButton>

                      <BigButton
                        type="button"
                        variant="outline"
                        data-testid="responder-btn-false-alarm-toggle"
                        onClick={() =>
                          setShowFalseAlarmForm((prev) => !prev)
                        }
                      >
                        <AlertTriangle className="w-5 h-5" />
                        {t('responderDashboard.falseAlarmBtn')}
                      </BigButton>
                    </div>
                  )}

                  {/* False Alarm Reason Input (Required note) */}
                  {showFalseAlarmForm && isSelectedOpen && (
                    <div
                      data-testid="responder-false-alarm-form"
                      className="rounded-xl border-2 border-amber-500/70 bg-amber-50/60 dark:bg-amber-950/40 p-4 space-y-3"
                    >
                      <input
                        type="text"
                        data-testid="responder-false-alarm-note-input"
                        aria-label={t(
                          'responderDashboard.falseAlarmReasonPlaceholder'
                        )}
                        value={falseAlarmReason}
                        onChange={(e) => setFalseAlarmReason(e.target.value)}
                        placeholder={t(
                          'responderDashboard.falseAlarmReasonPlaceholder'
                        )}
                        className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                      />
                      <BigButton
                        type="button"
                        variant="danger"
                        data-testid="responder-btn-false-alarm-confirm"
                        isLoading={submittingAction === 'false-alarm'}
                        onClick={() =>
                          void handleResponderAction('false-alarm', {
                            note: falseAlarmReason,
                          })
                        }
                      >
                        {t('responderDashboard.falseAlarmSubmitBtn')}
                      </BigButton>
                    </div>
                  )}

                  {/* Assign / Reassign Responder */}
                  {isSelectedOpen && colleagues.length > 0 && (
                    <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                      <label
                        htmlFor="responder-assign-select-id"
                        className="block text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400"
                      >
                        {t('responderDashboard.assignLabel')}
                      </label>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select
                          id="responder-assign-select-id"
                          aria-label={t('responderDashboard.assignLabel')}
                          data-testid="responder-assign-select"
                          value={assignTargetUserId}
                          onChange={(e) =>
                            setAssignTargetUserId(e.target.value)
                          }
                          className="flex-1 min-h-[48px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                        >
                          {colleagues.map((c) => (
                            <option key={c.user_id} value={c.user_id}>
                              {c.name} ({c.organization_zone})
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          data-testid="responder-btn-assign"
                          disabled={submittingAction === 'assign'}
                          onClick={() =>
                            void handleResponderAction('assign', {
                              target_responder_user_id: assignTargetUserId,
                            })
                          }
                          className="min-h-[48px] px-5 py-2.5 rounded-xl font-bold text-sm bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 inline-flex items-center justify-center gap-2"
                        >
                          <UserCheck className="w-4 h-4" />
                          {t('responderDashboard.assignBtn')}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Add Operational Note */}
                  <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        data-testid="responder-note-input"
                        aria-label={t('responderDashboard.notePlaceholder')}
                        value={noteInput}
                        onChange={(e) => setNoteInput(e.target.value)}
                        placeholder={t('responderDashboard.notePlaceholder')}
                        className="flex-1 min-h-[48px] px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm"
                      />
                      <button
                        type="button"
                        data-testid="responder-btn-add-note"
                        disabled={submittingAction === 'note'}
                        onClick={() =>
                          void handleResponderAction('note', {
                            note: noteInput,
                          })
                        }
                        className="min-h-[48px] px-5 py-2.5 rounded-xl font-bold text-sm bg-teal-700 text-white hover:bg-teal-800 inline-flex items-center justify-center gap-2"
                      >
                        {t('responderDashboard.addNoteBtn')}
                      </button>
                    </div>
                  </div>

                  {/* Direct Call Victim button ONLY after acknowledging and ONLY if NOT duress */}
                  {selectedDetail.user_phone_e164 &&
                    !selectedDetail.is_duress && (
                      <div className="pt-3 border-t border-slate-200 dark:border-slate-800">
                        <a
                          href={`tel:${selectedDetail.user_phone_e164}`}
                          data-testid="responder-call-user-btn"
                          className="min-h-[56px] w-full px-5 py-3.5 rounded-2xl font-bold text-base border-2 border-teal-700 text-teal-800 dark:text-teal-300 inline-flex items-center justify-center gap-2"
                        >
                          <PhoneCall className="w-5 h-5" />
                          {selectedDetail.user_phone_e164}
                        </a>
                      </div>
                    )}
                </Card>

                {/* Incident Events Timeline */}
                <Card
                  data-testid="responder-timeline-card"
                  className="space-y-3"
                >
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t('responderDashboard.timelineTitle')}
                  </h3>
                  <ul
                    data-testid="responder-events-list"
                    className="space-y-2 text-xs"
                  >
                    {selectedDetail.events.map((ev) => (
                      <li
                        key={ev.id}
                        className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-1"
                      >
                        <div className="space-y-0.5">
                          <span className="font-mono font-bold text-teal-800 dark:text-teal-300">
                            {ev.from_status
                              ? `${ev.from_status} -> ${ev.to_status}`
                              : ev.to_status}{' '}
                            ({ev.actor_type})
                          </span>
                          {ev.note && (
                            <p className="text-slate-700 dark:text-slate-300">
                              {ev.note}
                            </p>
                          )}
                        </div>
                        <span className="font-mono text-slate-600 dark:text-slate-300">
                          {new Date(ev.created_at).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit',
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </PageLayout>
  );
};
