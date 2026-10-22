import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  MapPin,
  Moon,
  Navigation,
  PhoneCall,
  ShieldAlert,
  ShieldCheck,
  Sun,
  WifiOff,
} from 'lucide-react';
import { LanguageToggle } from '../components/LanguageToggle';
import { DemoModeBanner } from '../components/DemoModeBanner';
import { BigButton, Card, Spinner } from '../components/ui';
import {
  ApiError,
  contactMagicApi,
  type ContactIncidentSummaryDto,
  type ContactResponseAction,
} from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';

const LeafletLatestPointMap: React.FC<{
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
          color: '#be123c',
          fillColor: '#f43f5e',
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
      // Fallback gracefully in environments without full layout canvas
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
      data-testid="contact-leaflet-map"
      aria-label={`Map showing latest location (${lat.toFixed(5)}, ${lng.toFixed(5)})`}
      className="w-full h-64 rounded-2xl border border-slate-300 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-900"
    />
  );
};

export const ContactAlertPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const { t } = useTranslation();
  const { darkMode, toggleDarkMode } = useAuthStore();
  const { lowPowerDataSaverMode, setLowPowerDataSaverMode } =
    useTriggerSettingsStore();

  const [summary, setSummary] = useState<ContactIncidentSummaryDto | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isExpiredOrClosed, setIsExpiredOrClosed] = useState<boolean>(false);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const [submittingAction, setSubmittingAction] =
    useState<ContactResponseAction | null>(null);
  const [lastRecordedAction, setLastRecordedAction] =
    useState<ContactResponseAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const fetchAlertSummary = useCallback(async () => {
    if (!token) {
      setIsExpiredOrClosed(true);
      setIsLoading(false);
      return;
    }

    try {
      const data = await contactMagicApi.getSummary(token);
      setSummary(data);
      setIsExpiredOrClosed(false);
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 403 || err.status === 404 || err.status === 410)
      ) {
        setIsExpiredOrClosed(true);
        setClosedMessage(err.message);
        setSummary(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, [token]);

  useEffect(() => {
    void fetchAlertSummary();
  }, [fetchAlertSummary]);

  const handleAction = async (action: ContactResponseAction) => {
    if (!token) return;
    setSubmittingAction(action);
    setActionError(null);
    try {
      const res = await contactMagicApi.respond(token, { action });
      setLastRecordedAction(action);
      if (res.closed || !res.summary) {
        setIsExpiredOrClosed(true);
        setClosedMessage(t('contactAlert.expiredOrClosedBody'));
        setSummary(null);
      } else {
        setSummary(res.summary);
      }
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.status === 403 || err.status === 404 || err.status === 410)
      ) {
        setIsExpiredOrClosed(true);
        setClosedMessage(err.message);
        setSummary(null);
      } else {
        setActionError(
          err instanceof Error
            ? err.message
            : 'Could not submit response. Please try again.'
        );
      }
    } finally {
      setSubmittingAction(null);
    }
  };

  const formatFreshness = (seconds: number | null): string => {
    if (seconds === null || seconds === undefined) return 'just now';
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.round(seconds / 60)}m ago`;
  };

  const actionLabelMap: Record<ContactResponseAction, string> = {
    seen: t('contactAlert.actionSeen'),
    on_my_way: t('contactAlert.actionOnMyWay'),
    calling_her: t('contactAlert.actionCallingHer'),
    cannot_help: t('contactAlert.actionCannotHelp'),
    confirm_safe: t('contactAlert.actionConfirmSafe'),
  };

  const useTextOnlyCoordinates = !isOnline || lowPowerDataSaverMode;

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      <DemoModeBanner />
      {/* Minimal Public Header (No Login Required) */}
      <header className="sticky top-0 z-30 h-16 px-4 md:px-8 border-b border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md flex items-center justify-between">
        <span className="text-lg font-bold tracking-tight text-teal-800 dark:text-teal-400">
          {t('app.name')}
        </span>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <button
            type="button"
            onClick={toggleDarkMode}
            aria-label={darkMode ? t('app.theme.light') : t('app.theme.dark')}
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            {darkMode ? (
              <Sun className="w-4 h-4" />
            ) : (
              <Moon className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-xl mx-auto px-4 py-6 space-y-6">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-teal-700 dark:text-teal-400">
            <Spinner className="w-8 h-8" />
            <span className="text-sm">{t('sos.loading')}</span>
          </div>
        ) : isExpiredOrClosed || !summary ? (
          <Card
            data-testid="contact-alert-expired-card"
            className="border-2 border-slate-300 dark:border-slate-700 space-y-5 text-center py-8"
          >
            <CheckCircle2 className="w-12 h-12 text-teal-700 dark:text-teal-400 mx-auto" />
            <div className="space-y-2">
              <h1
                data-testid="contact-alert-expired-title"
                className="text-2xl font-bold text-slate-900 dark:text-slate-50"
              >
                {t('contactAlert.expiredOrClosedTitle')}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 max-w-md mx-auto">
                {closedMessage || t('contactAlert.expiredOrClosedBody')}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <a
                href="tel:112"
                data-testid="contact-expired-call-112"
                className="min-h-[56px] px-5 py-3.5 rounded-2xl font-bold text-base bg-rose-700 text-white hover:bg-rose-800 inline-flex items-center justify-center gap-2"
              >
                <PhoneCall className="w-5 h-5" />
                {t('contactAlert.call112Btn')}
              </a>
              <a
                href="tel:181"
                className="min-h-[56px] px-5 py-3.5 rounded-2xl font-semibold text-base border-2 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 inline-flex items-center justify-center gap-2"
              >
                <PhoneCall className="w-5 h-5" />
                {t('sos.live.call181Btn')}
              </a>
            </div>
          </Card>
        ) : (
          <div data-testid="contact-alert-active-view" className="space-y-6">
            {/* Task 4: Duress Awareness Notice for Contacts */}
            {summary.is_duress && (
              <div
                role="alert"
                data-testid="contact-duress-warning-banner"
                className="rounded-2xl border-2 border-rose-600 bg-rose-50 dark:bg-rose-950/80 p-5 space-y-2"
              >
                <div className="flex items-center gap-2.5 text-rose-900 dark:text-rose-200 font-bold text-base">
                  <ShieldAlert className="w-6 h-6 shrink-0 text-rose-700 dark:text-rose-400" />
                  <span>{t('contactAlert.duressTitle')}</span>
                </div>
                <p
                  data-testid="contact-duress-notice-text"
                  className="text-sm font-medium text-rose-950 dark:text-rose-100 leading-relaxed"
                >
                  {t('contactAlert.duressNotice')}
                </p>
              </div>
            )}

            {/* Alert Summary Card */}
            <Card className="border-2 border-teal-600 dark:border-teal-500 space-y-4">
              <div className="space-y-1">
                <p className="text-xs font-bold uppercase tracking-wider text-teal-700 dark:text-teal-400">
                  {t('contactAlert.kicker')}
                </p>
                <h1
                  data-testid="contact-alert-heading"
                  className="text-2xl font-bold text-slate-900 dark:text-slate-50"
                >
                  {t('contactAlert.heading', {
                    firstName: summary.user_first_name,
                  })}
                </h1>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm text-slate-700 dark:text-slate-300 border-t border-slate-100 dark:border-slate-800 pt-3">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
                  <span data-testid="contact-alert-time">
                    {t('contactAlert.triggeredAt', {
                      time: new Date(summary.triggered_at).toLocaleTimeString(
                        [],
                        {
                          hour: '2-digit',
                          minute: '2-digit',
                        }
                      ),
                    })}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span data-testid="contact-alert-type">
                    {summary.emergency_type
                      ? t('contactAlert.emergencyTypeLabel', {
                          type: t(
                            `sos.emergencyType.${summary.emergency_type}`,
                            summary.emergency_type
                          ),
                        })
                      : t('contactAlert.emergencyTypeUnspecified')}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-xs font-mono border-t border-slate-100 dark:border-slate-800 pt-3">
                <span data-testid="contact-alert-real-status">
                  {t('contactAlert.statusLabel', { status: summary.status })}
                </span>
                <label className="inline-flex items-center gap-2 cursor-pointer font-sans">
                  <input
                    type="checkbox"
                    data-testid="contact-data-saver-toggle"
                    checked={lowPowerDataSaverMode}
                    onChange={(e) =>
                      setLowPowerDataSaverMode(e.target.checked)
                    }
                    className="w-4 h-4 accent-teal-700"
                  />
                  <span>{t('contactAlert.dataSaverToggle')}</span>
                </label>
              </div>
            </Card>

            {/* Location Card (Latest point only; no location history; omitted without permission/consent) */}
            <Card className="space-y-4" data-testid="contact-location-card">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-teal-700 dark:text-teal-400" />
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t('contactAlert.locationSectionTitle')}
                  </h2>
                </div>
                {summary.location && (
                  <span
                    data-testid="contact-location-last-updated"
                    className="text-xs font-mono text-slate-600 dark:text-slate-300"
                  >
                    {t('contactAlert.locationLastUpdated', {
                      time: new Date(
                        summary.location.captured_at
                      ).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      }),
                      freshness: formatFreshness(
                        summary.location_freshness_seconds
                      ),
                    })}
                  </span>
                )}
              </div>

              {!summary.can_see_live_location ? (
                <p
                  data-testid="contact-location-omitted"
                  className="text-sm text-slate-600 dark:text-slate-300"
                >
                  {t('contactAlert.locationOmittedNotice')}
                </p>
              ) : !summary.location ? (
                <p
                  data-testid="contact-location-waiting"
                  className="text-sm text-slate-600 dark:text-slate-300"
                >
                  {t('contactAlert.locationWaitingNotice')}
                </p>
              ) : (
                <div className="space-y-3">
                  {useTextOnlyCoordinates ? (
                    <div
                      data-testid="contact-location-text-only"
                      className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 p-4 space-y-1.5"
                    >
                      <div className="flex items-center gap-2 text-xs font-semibold text-amber-800 dark:text-amber-300">
                        <WifiOff className="w-4 h-4" />
                        <span>{t('contactAlert.locationTextOnlyNotice')}</span>
                      </div>
                      <p
                        data-testid="contact-location-coords-text"
                        className="text-base font-bold font-mono text-slate-900 dark:text-slate-100"
                      >
                        {t('contactAlert.locationCoordinates', {
                          lat: summary.location.lat.toFixed(5),
                          lng: summary.location.lng.toFixed(5),
                        })}
                      </p>
                    </div>
                  ) : (
                    <>
                      <LeafletLatestPointMap
                        lat={summary.location.lat}
                        lng={summary.location.lng}
                        label={`${summary.user_first_name} (${new Date(
                          summary.location.captured_at
                        ).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })})`}
                      />
                      <p
                        data-testid="contact-location-coords-text"
                        className="text-xs font-mono text-slate-600 dark:text-slate-400"
                      >
                        {t('contactAlert.locationCoordinates', {
                          lat: summary.location.lat.toFixed(5),
                          lng: summary.location.lng.toFixed(5),
                        })}
                      </p>
                    </>
                  )}

                  {summary.location.accuracy_m !== null && (
                    <p className="text-xs font-mono text-slate-600 dark:text-slate-400">
                      {t('contactAlert.locationAccuracy', {
                        meters: Math.round(summary.location.accuracy_m),
                      })}
                    </p>
                  )}
                </div>
              )}
            </Card>

            {/* 56px Response Action Buttons */}
            <Card className="space-y-4" data-testid="contact-actions-card">
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                {t('contactAlert.actionsTitle')}
              </h2>

              {lastRecordedAction && (
                <div
                  role="status"
                  data-testid="contact-response-feedback"
                  className="rounded-xl border border-teal-500/50 bg-teal-50 dark:bg-teal-950/60 p-3 flex items-center gap-2 text-sm font-semibold text-teal-900 dark:text-teal-200"
                >
                  <ShieldCheck className="w-5 h-5 shrink-0" />
                  <span>
                    {t('contactAlert.responseRecorded', {
                      action: actionLabelMap[lastRecordedAction],
                    })}
                  </span>
                </div>
              )}

              {actionError && (
                <p
                  role="alert"
                  data-testid="contact-action-error"
                  className="text-sm font-semibold text-rose-700 dark:text-rose-400"
                >
                  {actionError}
                </p>
              )}

              <div className="space-y-3">
                <BigButton
                  type="button"
                  variant="primary"
                  data-testid="contact-btn-seen"
                  isLoading={submittingAction === 'seen'}
                  onClick={() => void handleAction('seen')}
                >
                  {t('contactAlert.actionSeen')}
                </BigButton>

                <BigButton
                  type="button"
                  variant="primary"
                  data-testid="contact-btn-on-my-way"
                  isLoading={submittingAction === 'on_my_way'}
                  onClick={() => void handleAction('on_my_way')}
                >
                  <Navigation className="w-5 h-5" />
                  {t('contactAlert.actionOnMyWay')}
                </BigButton>

                {/* Task 4: Hide "I'm calling her" button when incident is is_duress */}
                {!summary.is_duress && (
                  <BigButton
                    type="button"
                    variant="secondary"
                    data-testid="contact-btn-calling-her"
                    isLoading={submittingAction === 'calling_her'}
                    onClick={() => void handleAction('calling_her')}
                  >
                    <PhoneCall className="w-5 h-5" />
                    {t('contactAlert.actionCallingHer')}
                  </BigButton>
                )}

                <BigButton
                  type="button"
                  variant="outline"
                  data-testid="contact-btn-cannot-help"
                  isLoading={submittingAction === 'cannot_help'}
                  onClick={() => void handleAction('cannot_help')}
                >
                  {t('contactAlert.actionCannotHelp')}
                </BigButton>

                <BigButton
                  type="button"
                  variant="secondary"
                  data-testid="contact-btn-confirm-safe"
                  isLoading={submittingAction === 'confirm_safe'}
                  onClick={() => void handleAction('confirm_safe')}
                >
                  <CheckCircle2 className="w-5 h-5" />
                  {t('contactAlert.actionConfirmSafe')}
                </BigButton>
              </div>

              {/* Direct Call 112 and Call her (tel:) links */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <a
                  href="tel:112"
                  data-testid="contact-call-112-btn"
                  className="min-h-[56px] px-5 py-3.5 rounded-2xl font-bold text-base bg-rose-700 text-white hover:bg-rose-800 inline-flex items-center justify-center gap-2"
                >
                  <PhoneCall className="w-5 h-5" />
                  {t('contactAlert.call112Btn')}
                </a>

                {!summary.is_duress && (
                  <a
                    href={`tel:${summary.user_phone_e164}`}
                    data-testid="contact-call-her-btn"
                    className="min-h-[56px] px-5 py-3.5 rounded-2xl font-semibold text-base border-2 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center gap-2"
                  >
                    <PhoneCall className="w-5 h-5" />
                    {t('contactAlert.callHerBtn', {
                      firstName: summary.user_first_name,
                    })}
                  </a>
                )}
              </div>
            </Card>
          </div>
        )}
      </main>

      <footer className="border-t border-slate-200 dark:border-slate-800 py-5 px-4 text-center text-xs text-slate-500 dark:text-slate-400">
        {t('app.disclaimer')}
      </footer>
    </div>
  );
};
