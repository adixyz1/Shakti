import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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
          color: '#9f1239',
          fillColor: '#e11d48',
          fillOpacity: 0.85,
          weight: 2,
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
      // Fallback gracefully in headless test environments
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
      className="w-full h-64 rounded-xl border border-line overflow-hidden bg-paper"
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
    <div className="min-h-screen flex flex-col bg-paper text-ink selection:bg-teal-700 selection:text-surface">
      <DemoModeBanner />
      {/* Paper Utility 3-Zone Public Header */}
      <header className="sticky top-0 z-30 h-14 px-4 border-b border-line bg-paper/95 backdrop-blur-md flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-bold tracking-tight text-ink font-mono" translate="no">
            {t('app.name')}
          </span>
          <span className="text-line">|</span>
          <div aria-label="Operational status: Online" className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-teal-700' : 'bg-crimson-800'}`}></span>
            <span className="text-[11px] font-mono text-muted uppercase tracking-wider">
              {isOnline ? 'ONLINE' : 'OFFLINE'}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <LanguageToggle />
          <button
            type="button"
            onClick={toggleDarkMode}
            aria-label={darkMode ? t('app.theme.light') : t('app.theme.dark')}
            className="h-9 px-2 inline-flex items-center justify-center rounded-xl border border-line bg-surface text-ink hover:bg-surface-container text-xs font-mono"
          >
            {darkMode ? 'LIGHT' : 'DARK'}
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-xl mx-auto px-4 py-6 space-y-5">
        {isLoading ? (
          <div className="py-16 flex flex-col items-center justify-center gap-3 text-teal-700">
            <Spinner className="w-8 h-8" />
            <span className="text-xs font-mono">{t('sos.loading')}</span>
          </div>
        ) : isExpiredOrClosed || !summary ? (
          <Card
            data-testid="contact-alert-expired-card"
            className="border border-line bg-surface space-y-5 text-center py-8 rounded-2xl"
          >
            <div className="w-12 h-12 border-2 border-teal-700 text-teal-700 mx-auto flex items-center justify-center rounded-full">
              <svg className="w-6 h-6 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </div>
            <div className="space-y-1">
              <h1
                data-testid="contact-alert-expired-title"
                className="text-xl md:text-2xl font-bold text-ink"
              >
                {t('contactAlert.expiredOrClosedTitle')}
              </h1>
              <p className="text-xs md:text-sm text-muted max-w-md mx-auto leading-relaxed">
                {closedMessage || t('contactAlert.expiredOrClosedBody')}
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2">
              <a
                href="tel:112"
                data-testid="contact-expired-call-112"
                className="min-h-[48px] px-4 py-3 bg-crimson-800 active:bg-crimson-900 text-surface font-mono font-bold text-xs uppercase tracking-wider rounded-xl inline-flex items-center justify-center gap-2"
              >
                {t('contactAlert.call112Btn')}
              </a>
              <a
                href="tel:181"
                className="min-h-[48px] px-4 py-3 border border-line bg-surface text-ink hover:bg-surface-container font-mono font-semibold text-xs rounded-xl inline-flex items-center justify-center gap-2"
              >
                {t('sos.live.call181Btn')}
              </a>
            </div>
          </Card>
        ) : (
          <div data-testid="contact-alert-active-view" className="space-y-5">
            {/* Urgent Broadcast Banner per Stitch contact_responder_view */}
            <div
              aria-live="assertive"
              className="w-full bg-crimson-800 text-surface p-4 rounded-xl flex flex-col gap-2"
              role="alert"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-surface rounded-full" />
                  <span className="font-mono text-[11px] uppercase tracking-wider font-bold">
                    LIVE RESPONDER LINK
                  </span>
                </div>
                <span className="font-mono text-surface/90 text-xs">
                  {new Date(summary.triggered_at).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <p
                data-testid="contact-alert-heading"
                className="font-bold text-base text-surface leading-snug"
              >
                {t('contactAlert.heading', { firstName: summary.user_first_name })}
              </p>
              <p className="font-mono text-xs text-surface/80">
                No SHAKTI account required to review or coordinate response.
              </p>
            </div>

            {/* Duress Awareness Notice for Contacts */}
            {summary.is_duress && (
              <div
                role="alert"
                data-testid="contact-duress-warning-banner"
                className="p-4 bg-paper border-2 border-crimson-800 rounded-xl space-y-1.5"
              >
                <div className="flex items-center gap-2 text-crimson-800 font-bold text-sm font-mono">
                  <span className="w-2.5 h-2.5 bg-crimson-800 rounded-full shrink-0" />
                  <span>{t('contactAlert.duressTitle')}</span>
                </div>
                <p
                  data-testid="contact-duress-notice-text"
                  className="text-xs text-ink leading-relaxed"
                >
                  {t('contactAlert.duressNotice')}
                </p>
              </div>
            )}

            {/* Alert Summary Card */}
            <Card className="border border-line bg-surface space-y-4 rounded-2xl">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-muted font-medium">
                  {t('contactAlert.kicker')}
                </span>
                <span
                  data-testid="contact-alert-real-status"
                  className="text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 bg-surface-container border border-line text-ink font-semibold"
                >
                  {summary.status.toUpperCase()}
                </span>
              </div>

              <div className="space-y-1">
                <h1
                  className="text-xl md:text-2xl font-bold text-ink"
                >
                  {summary.user_first_name}
                </h1>
                <p className="text-xs font-mono text-muted tabular-nums">
                  {summary.user_phone_e164}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs font-mono border-t border-line pt-3">
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted uppercase text-[11px]">Triggered</span>
                  <span data-testid="contact-alert-time" className="font-semibold text-ink">
                    {new Date(summary.triggered_at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-muted uppercase text-[11px]">Nature</span>
                  <span data-testid="contact-alert-type" className="font-semibold text-ink">
                    {summary.emergency_type
                      ? t(`sos.emergencyType.${summary.emergency_type}`, summary.emergency_type)
                      : 'Unspecified'}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between gap-2 text-xs font-mono border-t border-line pt-3">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="contact-data-saver-toggle"
                    checked={lowPowerDataSaverMode}
                    onChange={(e) =>
                      setLowPowerDataSaverMode(e.target.checked)
                    }
                    className="w-4 h-4 accent-teal-700 rounded-xl"
                  />
                  <span className="text-muted">{t('contactAlert.dataSaverToggle')}</span>
                </label>
              </div>
            </Card>

            {/* Location Card */}
            <Card className="space-y-3 border border-line bg-surface rounded-2xl" data-testid="contact-location-card">
              <div className="flex items-center justify-between gap-2 border-b border-line pb-2">
                <h2 className="text-xs font-mono uppercase tracking-wider text-ink font-semibold">
                  {t('contactAlert.locationSectionTitle')}
                </h2>
                {summary.location && (
                  <span
                    data-testid="contact-location-last-updated"
                    className="text-[11px] font-mono text-muted"
                  >
                    {formatFreshness(summary.location_freshness_seconds)}
                  </span>
                )}
              </div>

              {!summary.can_see_live_location ? (
                <p
                  data-testid="contact-location-omitted"
                  className="text-xs text-muted"
                >
                  {t('contactAlert.locationOmittedNotice')}
                </p>
              ) : !summary.location ? (
                <p
                  data-testid="contact-location-waiting"
                  className="text-xs text-muted"
                >
                  {t('contactAlert.locationWaitingNotice')}
                </p>
              ) : (
                <div className="space-y-3">
                  {useTextOnlyCoordinates ? (
                    <div
                      data-testid="contact-location-text-only"
                      className="rounded-xl border border-line bg-paper p-3 space-y-1 font-mono"
                    >
                      <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">
                        {t('contactAlert.locationTextOnlyNotice')}
                      </span>
                      <p
                        data-testid="contact-location-coords-text"
                        className="text-sm font-bold text-ink"
                      >
                        {summary.location.lat.toFixed(5)}, {summary.location.lng.toFixed(5)}
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
                        className="text-xs font-mono text-muted"
                      >
                        {summary.location.lat.toFixed(5)}, {summary.location.lng.toFixed(5)}
                      </p>
                    </>
                  )}

                  {summary.location.accuracy_m !== null && (
                    <div className="flex items-center gap-1.5 text-xs font-mono text-muted">
                      <span className="w-1.5 h-1.5 bg-teal-700 rounded-full"></span>
                      <span>
                        {t('contactAlert.locationAccuracy', {
                          meters: Math.round(summary.location.accuracy_m),
                        })}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </Card>

            {/* Response Action Buttons */}
            <Card className="space-y-3 border border-line bg-surface rounded-2xl" data-testid="contact-actions-card">
              <h2 className="text-xs font-mono uppercase tracking-wider text-ink font-semibold border-b border-line pb-2">
                {t('contactAlert.actionsTitle')}
              </h2>

              {lastRecordedAction && (
                <div
                  role="status"
                  data-testid="contact-response-feedback"
                  className="bg-paper border border-teal-700 p-2.5 rounded-xl flex items-center gap-2 text-xs font-mono text-teal-800"
                >
                  <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
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
                  className="text-xs font-mono text-crimson-800"
                >
                  {actionError}
                </p>
              )}

              <div className="space-y-2">
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
                  {t('contactAlert.actionOnMyWay')}
                </BigButton>

                {/* Hide "I'm calling her" button when incident is is_duress */}
                {!summary.is_duress && (
                  <BigButton
                    type="button"
                    variant="outline"
                    data-testid="contact-btn-calling-her"
                    isLoading={submittingAction === 'calling_her'}
                    onClick={() => void handleAction('calling_her')}
                  >
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
                  variant="outline"
                  data-testid="contact-btn-confirm-safe"
                  isLoading={submittingAction === 'confirm_safe'}
                  onClick={() => void handleAction('confirm_safe')}
                >
                  {t('contactAlert.actionConfirmSafe')}
                </BigButton>
              </div>

              {/* Direct Call 112 and Call her (tel:) links */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-line">
                <a
                  href="tel:112"
                  data-testid="contact-call-112-btn"
                  className="min-h-[48px] px-4 py-2.5 rounded-xl font-mono font-bold text-xs uppercase tracking-wider bg-crimson-800 active:bg-crimson-900 text-surface inline-flex items-center justify-center gap-2"
                >
                  {t('contactAlert.call112Btn')}
                </a>

                {!summary.is_duress && (
                  <a
                    href={`tel:${summary.user_phone_e164}`}
                    data-testid="contact-call-her-btn"
                    className="min-h-[48px] px-4 py-2.5 rounded-xl font-mono font-bold text-xs uppercase tracking-wider border border-line bg-surface text-ink hover:bg-surface-container inline-flex items-center justify-center gap-2"
                  >
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

      <footer className="border-t border-line py-4 px-4 text-center font-mono text-[11px] text-muted">
        {t('app.disclaimer')}
      </footer>
    </div>
  );
};
