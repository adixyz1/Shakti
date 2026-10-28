import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PageLayout } from '../components/PageLayout';
import { Button, Card, Spinner } from '../components/ui';
import {
  contactsApi,
  journeysApi,
  type JourneyDto,
  type TrustedContact,
} from '../lib/api';
import { triggerSos } from '../lib/sos';
import { useAuthStore } from '../store/authStore';

const DURATION_OPTIONS_MINUTES = [15, 30, 45, 60] as const;

function formatCountdownMMSS(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export const SafeJourneyPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { addToast } = useAuthStore();

  const [journey, setJourney] = useState<JourneyDto | null>(null);
  const [acceptedContacts, setAcceptedContacts] = useState<TrustedContact[]>([]);
  const [selectedDuration, setSelectedDuration] = useState<number>(30);
  const [selectedContactId, setSelectedContactId] = useState<string>('');
  const [journeyNote, setJourneyNote] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const loadJourneyAndContacts = useCallback(async () => {
    try {
      const [activeRes, contactsRes] = await Promise.all([
        journeysApi.getActive().catch(() => ({ journey: null })),
        contactsApi.listContacts().catch(() => ({ contacts: [] })),
      ]);
      setJourney(activeRes.journey);
      const accepted = (contactsRes.contacts || []).filter(
        (c) => c.status === 'accepted'
      );
      setAcceptedContacts(accepted);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadJourneyAndContacts();
  }, [loadJourneyAndContacts]);

  // Live 1-second tick for countdown and reminder / lapse detection
  useEffect(() => {
    if (!journey || journey.status !== 'active') {
      return;
    }

    const interval = setInterval(() => {
      const current = Date.now();
      setNowMs(current);
      const endMs = new Date(journey.ends_at).getTime();
      if (current >= endMs) {
        void journeysApi
          .getActive()
          .then((res) => {
            if (res.journey) {
              setJourney(res.journey);
            }
          })
          .catch(() => {
            // If offline when timer reaches 0, transition locally to lapsed view
            setJourney((prev) =>
              prev && prev.status === 'active'
                ? { ...prev, status: 'lapsed' }
                : prev
            );
          });
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [journey]);

  const handleStartJourney = async () => {
    setIsSubmitting(true);
    try {
      const trimmedNote = journeyNote.trim();
      const res = await journeysApi.start({
        duration_minutes: selectedDuration,
        contact_id: selectedContactId ? selectedContactId : null,
        ...(trimmedNote ? { note: trimmedNote.slice(0, 100) } : {}),
      });
      setNowMs(Date.now());
      setJourneyNote('');
      setJourney(res.journey);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not start walk timer',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCompleteSafe = async () => {
    if (!journey) return;
    setIsSubmitting(true);
    try {
      await journeysApi.complete(journey.id);
      setJourney(null);
      addToast(t('journeys.completedToast'), 'success');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not complete timer',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleExtend10Min = async () => {
    if (!journey) return;
    setIsSubmitting(true);
    try {
      const res = await journeysApi.extend(journey.id, 10);
      setNowMs(Date.now());
      setJourney(res.journey);
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not extend timer',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelJourney = async () => {
    if (!journey) return;
    setIsSubmitting(true);
    try {
      await journeysApi.cancel(journey.id);
      setJourney(null);
      addToast(t('journeys.cancelledToast'), 'info');
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not cancel timer',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendSosFromLapsed = async () => {
    setIsSubmitting(true);
    try {
      await triggerSos('button');
      navigate('/home');
    } finally {
      setIsSubmitting(false);
    }
  };

  const endsAtMs = journey ? new Date(journey.ends_at).getTime() : 0;
  const remainingMs = journey ? Math.max(0, endsAtMs - nowMs) : 0;
  const isEffectiveLapsed =
    journey?.status === 'lapsed' ||
    (journey?.status === 'active' && endsAtMs > 0 && nowMs >= endsAtMs);
  const isReminderDue =
    journey?.status === 'active' &&
    !isEffectiveLapsed &&
    (Boolean(journey.reminder_sent_at) || remainingMs <= 3 * 60 * 1000);

  const expectedByFormatted = journey
    ? new Date(journey.ends_at).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';

  return (
    <PageLayout>
      <div
        className="max-w-xl mx-auto space-y-6 py-2"
        data-testid="safe-journey-page"
      >
        {/* Header & Status */}
        <div className="flex items-center justify-between pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <svg
              className="w-6 h-6 stroke-ink fill-none stroke-2 shrink-0"
              strokeLinecap="square"
              strokeLinejoin="miter"
              viewBox="0 0 24 24"
            >
              <circle cx="13" cy="4" r="2" />
              <path d="M7 21l3-7 3 2v6" />
              <path d="M11 10l3-3 4 2v5" />
              <path d="M6 12l4-2" />
            </svg>
            <h1
              className="text-xl md:text-2xl font-bold text-ink tracking-tight"
              data-testid="safe-journey-title"
            >
              {t('journeys.title')}
            </h1>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-surface border border-line rounded-xl">
            <span
              className={`w-2 h-2 rounded-full ${
                journey && journey.status === 'active'
                  ? 'bg-teal-700 animate-pulse'
                  : 'bg-muted'
              }`}
            />
            <span className="text-[11px] font-mono uppercase tracking-wider text-muted font-semibold">
              {journey && journey.status === 'active' ? 'RUNNING' : 'IDLE'}
            </span>
          </div>
        </div>

        {/* Mandatory Statutory Honest No-Tracking Rule Banner */}
        <div
          role="note"
          data-testid="journey-honest-no-tracking-note"
          className="p-4 bg-surface border border-line rounded-xl flex items-start gap-3"
        >
          <svg
            className="w-5 h-5 stroke-teal-700 fill-none stroke-2 shrink-0 mt-0.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            viewBox="0 0 24 24"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
          </svg>
          <p className="text-xs text-muted leading-relaxed">
            {t('journeys.honestNoTrackingNote')}
          </p>
        </div>

        {isLoading ? (
          <div className="py-12 flex justify-center text-teal-700">
            <Spinner className="w-8 h-8" />
          </div>
        ) : isEffectiveLapsed && journey ? (
          /* LAPSED SCREEN */
          <Card
            data-testid="journey-lapsed-screen"
            className="border-2 border-crimson-800 bg-surface space-y-5 rounded-2xl"
          >
            <div className="flex items-start gap-3">
              <svg
                aria-hidden="true"
                className="w-6 h-6 stroke-crimson-800 fill-none stroke-2 shrink-0 mt-0.5"
                strokeLinecap="square"
                strokeLinejoin="miter"
                viewBox="0 0 24 24"
              >
                <polygon points="12 2 2 22 22 22 12 2" />
                <line x1="12" x2="12" y1="9" y2="13" />
                <line x1="12" x2="12.01" y1="17" y2="17" />
              </svg>
              <div className="space-y-1">
                <h2
                  className="text-lg font-bold text-crimson-800"
                  data-testid="journey-lapsed-heading"
                >
                  {t('journeys.lapsedTitle')}
                </h2>
                <p
                  className="text-xs md:text-sm text-ink leading-relaxed"
                  data-testid="journey-lapsed-body"
                >
                  {journey.contact_name
                    ? t('journeys.lapsedBodyWithContact', {
                        time: expectedByFormatted,
                        name: journey.contact_name,
                      })
                    : t('journeys.lapsedBodyNoContact', {
                        time: expectedByFormatted,
                      })}
                </p>
              </div>
            </div>

            <div className="space-y-2 pt-2 border-t border-line">
              <button
                type="button"
                data-testid="journey-lapsed-send-sos-btn"
                disabled={isSubmitting}
                onClick={handleSendSosFromLapsed}
                className="w-full min-h-[52px] px-4 py-3 bg-crimson-800 active:bg-crimson-900 text-surface font-mono font-bold text-sm uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 cursor-pointer"
              >
                <svg className="w-4 h-4 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <path d="M12 8v4" />
                  <path d="M12 16h.01" />
                </svg>
                {t('journeys.sendSosBtn')}
              </button>

              <a
                href="tel:112"
                data-testid="journey-lapsed-call-112-btn"
                className="w-full min-h-[48px] px-4 py-3 bg-surface border border-line text-ink hover:bg-surface-container font-mono font-bold text-sm rounded-xl flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                {t('journeys.call112Btn')}
              </a>

              <Button
                variant="outline"
                fullWidth
                data-testid="journey-lapsed-im-safe-btn"
                disabled={isSubmitting}
                onClick={handleCompleteSafe}
                className="min-h-[48px]"
              >
                {t('journeys.imSafeDismissBtn')}
              </Button>
            </div>
          </Card>
        ) : journey && journey.status === 'active' ? (
          /* ACTIVE JOURNEY SCREEN per Stitch safe_journeys */
          <div
            data-testid="journey-active-screen"
            className="p-4 bg-surface border border-line rounded-xl flex flex-col gap-4"
          >
            {/* T-minus Reminder Prompt Banner */}
            {isReminderDue && (
              <div
                role="alert"
                data-testid="journey-reminder-prompt"
                className="bg-paper border border-amber-500/80 p-3 rounded-xl text-amber-900 space-y-1"
              >
                <p className="font-bold text-xs uppercase tracking-wider flex items-center gap-1.5 font-mono">
                  <span className="w-2 h-2 bg-amber-600 rounded-full"></span>
                  {t('journeys.reminderBannerTitle')}
                </p>
                <p className="text-xs text-ink leading-relaxed">
                  {t('journeys.reminderBannerBody')}
                </p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 bg-teal-700 rounded-full animate-pulse" />
                <span
                  className="text-xs font-mono font-semibold uppercase tracking-wider text-ink"
                  data-testid="journey-active-heading"
                >
                  {journey.note ? `Active walk: ${journey.note}` : t('journeys.activeTitle')}
                </span>
              </div>
              <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-teal-700">
                Running
              </span>
            </div>

            {/* Countdown Display */}
            <div className="flex items-baseline justify-between py-2 border-y border-line dark:border-slate-800 my-1">
              <span className="text-xs font-mono text-muted dark:text-slate-300 uppercase tracking-wider">
                Auto-alert triggers in
              </span>
              <span
                data-testid="journey-countdown-display"
                className="text-4xl md:text-5xl font-mono font-bold text-ink dark:text-slate-100 tabular-nums tracking-tight"
              >
                {formatCountdownMMSS(remainingMs)}
              </span>
            </div>

            <div className="space-y-0.5 text-xs font-mono text-muted dark:text-slate-300">
              <p data-testid="journey-expected-by">
                {t('journeys.expectedByLabel', { time: expectedByFormatted })}
              </p>
              <p data-testid="journey-contact-summary">
                {journey.contact_name
                  ? t('journeys.notifyingContactLabel', {
                      name: journey.contact_name,
                    })
                  : t('journeys.selfReminderOnlyLabel')}
              </p>
            </div>

            {/* Quick Action Controls */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1 border-t border-line dark:border-slate-800">
              <button
                type="button"
                data-testid="journey-im-safe-btn"
                disabled={isSubmitting}
                onClick={handleCompleteSafe}
                className="h-12 bg-teal-700 active:bg-teal-800 text-surface text-xs font-mono font-bold uppercase tracking-wider rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer select-none"
              >
                <svg className="w-4 h-4 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <span>{t('journeys.imSafeBtn')}</span>
              </button>

              <button
                type="button"
                data-testid="journey-extend-btn"
                disabled={isSubmitting}
                onClick={handleExtend10Min}
                className="h-12 bg-surface dark:bg-slate-800 hover:bg-surface-container dark:hover:bg-slate-700 active:bg-surface-container border border-line dark:border-slate-700 text-ink dark:text-slate-100 text-xs font-mono font-medium rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
                <span>+10 min</span>
              </button>

              <button
                type="button"
                data-testid="journey-cancel-btn"
                disabled={isSubmitting}
                onClick={handleCancelJourney}
                className="h-12 bg-transparent hover:bg-paper dark:hover:bg-slate-800 text-muted dark:text-slate-300 hover:text-ink dark:hover:text-white text-xs font-mono rounded-xl flex items-center justify-center gap-1 transition-colors cursor-pointer"
              >
                <svg className="w-4 h-4 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                  <rect height="16" width="16" x="4" y="4" />
                </svg>
                <span>{t('journeys.endCancelBtn')}</span>
              </button>
            </div>
          </div>
        ) : (
          /* START JOURNEY SCREEN per Stitch safe_journeys */
          <div data-testid="journey-start-screen" className="flex flex-col gap-5">
            {/* Destination Input Field */}
            <div className="flex flex-col gap-1.5">
              <label
                htmlFor="journey-note-input"
                className="text-xs font-mono uppercase tracking-wider text-ink dark:text-slate-100 font-semibold"
              >
                {t('journeys.noteLabel')}
              </label>
              <input
                id="journey-note-input"
                data-testid="journey-note-input"
                type="text"
                maxLength={100}
                value={journeyNote}
                onChange={(e) => setJourneyNote(e.target.value.slice(0, 100))}
                placeholder={t('journeys.notePlaceholder')}
                className="w-full h-12 px-4 bg-surface dark:bg-slate-900 border border-line dark:border-slate-700 rounded-xl text-sm text-ink dark:text-slate-100 placeholder:text-muted dark:placeholder:text-slate-400 focus:outline-none focus:border-teal-700"
              />
              <span className="text-[11px] font-mono text-muted dark:text-slate-300">
                Stored only on this phone for automatic circle alerts
              </span>
            </div>

            {/* Duration Selection Chips */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-mono uppercase tracking-wider text-ink dark:text-slate-100 font-semibold">
                {t('journeys.startSectionTitle')}
              </label>
              <div
                className="grid grid-cols-4 gap-2"
                role="radiogroup"
                aria-label={t('journeys.startSectionTitle')}
              >
                {DURATION_OPTIONS_MINUTES.map((mins) => {
                  const isSelected = selectedDuration === mins;
                  return (
                    <button
                      key={mins}
                      type="button"
                      data-testid={`journey-duration-chip-${mins}`}
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelectedDuration(mins)}
                      className={`h-12 border rounded-xl font-mono text-xs flex items-center justify-center transition-none cursor-pointer select-none ${
                        isSelected
                          ? 'bg-teal-700 text-surface border-teal-700 font-bold'
                          : 'bg-paper text-ink border-line hover:bg-surface'
                      }`}
                    >
                      {mins}m
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Contact Picker Card */}
            <div className="p-4 bg-surface border border-line rounded-2xl space-y-3">
              <div className="flex items-start gap-3">
                <svg
                  className="w-5 h-5 stroke-teal-700 fill-none stroke-2 shrink-0 mt-0.5"
                  strokeLinecap="square"
                  strokeLinejoin="miter"
                  viewBox="0 0 24 24"
                >
                  <circle cx="9" cy="8" r="4" />
                  <path d="M2 20c0-3.5 3.5-5 7-5s7 1.5 7 5" />
                  <circle cx="17" cy="7" r="3" />
                  <path d="M17 14c2.5 0 5 1 5 4" />
                </svg>
                <div className="flex-1 min-w-0">
                  <label
                    htmlFor="journey-contact-select"
                    className="text-xs font-mono uppercase tracking-wider text-ink font-semibold block"
                  >
                    {t('journeys.contactPickerLabel')}
                  </label>
                  <p className="text-xs text-muted mt-0.5">
                    Notifies your chosen responder only if you fail to check in
                  </p>
                </div>
              </div>

              <select
                id="journey-contact-select"
                data-testid="journey-contact-select"
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                className="w-full h-11 px-3 rounded-xl border border-line bg-paper text-ink text-sm focus:outline-none focus:border-teal-700"
              >
                <option value="">{t('journeys.contactNoneOption')}</option>
                {acceptedContacts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}{' '}
                    {!c.permissions?.receives_checkin
                      ? t('journeys.contactCheckinDisabledSuffix')
                      : ''}
                  </option>
                ))}
              </select>

              {(!selectedContactId || acceptedContacts.length === 0) && (
                <p
                  role="note"
                  data-testid="journey-no-contact-note"
                  className="text-xs text-muted bg-paper border border-line/60 p-2.5 rounded-xl"
                >
                  {t('journeys.noContactSelectedNote')}
                </p>
              )}
            </div>

            {/* Start Button */}
            <button
              type="button"
              data-testid="journey-start-btn"
              disabled={isSubmitting}
              onClick={handleStartJourney}
              className="w-full min-h-[52px] px-4 py-3 bg-teal-700 active:bg-teal-800 text-surface font-mono font-bold text-sm uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <svg className="w-5 h-5 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                <circle cx="13" cy="4" r="2" />
                <path d="M7 21l3-7 3 2v6" />
                <path d="M11 10l3-3 4 2v5" />
                <path d="M6 12l4-2" />
              </svg>
              <span>{isSubmitting ? t('journeys.startingBtn') : t('journeys.startBtn')}</span>
            </button>
          </div>
        )}
      </div>
    </PageLayout>
  );
};
