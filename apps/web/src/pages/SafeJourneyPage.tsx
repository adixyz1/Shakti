import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Footprints,
  PhoneCall,
  Plus,
  ShieldAlert,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
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
        className="max-w-xl mx-auto space-y-6"
        data-testid="safe-journey-page"
      >
        {/* Header */}
        <header className="space-y-2">
          <div className="inline-flex items-center gap-2 text-teal-800 dark:text-teal-300 font-semibold text-sm">
            <Footprints className="w-5 h-5" aria-hidden="true" />
            <span>{t('journeys.navLink')}</span>
          </div>
          <h1
            className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white"
            data-testid="safe-journey-title"
          >
            {t('journeys.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('journeys.subtitle')}
          </p>
        </header>

        {/* Honest No-Tracking Rule Banner (Always visible) */}
        <div
          role="note"
          data-testid="journey-honest-no-tracking-note"
          className="rounded-2xl border-2 border-teal-700/30 bg-teal-50/90 dark:bg-teal-950/40 dark:border-teal-500/40 p-4 flex items-start gap-3 text-teal-950 dark:text-teal-100"
        >
          <ShieldCheck
            className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold leading-relaxed">
            {t('journeys.honestNoTrackingNote')}
          </p>
        </div>

        {isLoading ? (
          <div className="py-12 flex justify-center">
            <Spinner className="w-8 h-8" />
          </div>
        ) : isEffectiveLapsed && journey ? (
          /* LAPSED SCREEN */
          <Card
            data-testid="journey-lapsed-screen"
            className="border-2 border-rose-600 dark:border-rose-500 space-y-6"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle
                className="w-7 h-7 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5"
                aria-hidden="true"
              />
              <div className="space-y-1">
                <h2
                  className="text-xl font-extrabold text-rose-800 dark:text-rose-300"
                  data-testid="journey-lapsed-heading"
                >
                  {t('journeys.lapsedTitle')}
                </h2>
                <p
                  className="text-sm text-slate-700 dark:text-slate-200"
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

            <div className="space-y-3">
              <button
                type="button"
                data-testid="journey-lapsed-send-sos-btn"
                disabled={isSubmitting}
                onClick={handleSendSosFromLapsed}
                className="w-full min-h-[56px] px-6 py-4 rounded-2xl bg-rose-700 hover:bg-rose-800 text-white font-extrabold text-base flex items-center justify-center gap-2 shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-rose-500/50"
              >
                <ShieldAlert className="w-5 h-5" aria-hidden="true" />
                {t('journeys.sendSosBtn')}
              </button>

              <a
                href="tel:112"
                data-testid="journey-lapsed-call-112-btn"
                className="w-full min-h-[56px] px-6 py-4 rounded-2xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 text-white font-bold text-base flex items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50"
              >
                <PhoneCall className="w-5 h-5" aria-hidden="true" />
                {t('journeys.call112Btn')}
              </a>

              <Button
                variant="outline"
                fullWidth
                data-testid="journey-lapsed-im-safe-btn"
                disabled={isSubmitting}
                onClick={handleCompleteSafe}
                className="min-h-[56px]"
              >
                <CheckCircle2 className="w-5 h-5 mr-2" aria-hidden="true" />
                {t('journeys.imSafeDismissBtn')}
              </Button>
            </div>
          </Card>
        ) : journey && journey.status === 'active' ? (
          /* ACTIVE JOURNEY SCREEN */
          <Card
            data-testid="journey-active-screen"
            className="space-y-6 border-2 border-teal-700/40 dark:border-teal-500/40"
          >
            {/* T-minus Reminder Prompt Banner */}
            {isReminderDue && (
              <div
                role="alert"
                data-testid="journey-reminder-prompt"
                className="rounded-xl border-2 border-amber-500 bg-amber-50 dark:bg-amber-950/60 p-4 text-amber-950 dark:text-amber-100 space-y-1"
              >
                <p className="font-bold text-sm flex items-center gap-2">
                  <Clock className="w-4 h-4 shrink-0" aria-hidden="true" />
                  {t('journeys.reminderBannerTitle')}
                </p>
                <p className="text-xs leading-relaxed">
                  {t('journeys.reminderBannerBody')}
                </p>
              </div>
            )}

            <div className="text-center space-y-2">
              <p
                className="text-sm font-bold uppercase tracking-wider text-teal-800 dark:text-teal-300"
                data-testid="journey-active-heading"
              >
                {t('journeys.activeTitle')}
              </p>
              <div
                data-testid="journey-countdown-display"
                className="text-5xl font-extrabold font-mono tracking-tight text-slate-900 dark:text-white py-2"
              >
                {formatCountdownMMSS(remainingMs)}
              </div>
              <p
                className="text-sm text-slate-600 dark:text-slate-300"
                data-testid="journey-expected-by"
              >
                {t('journeys.expectedByLabel', { time: expectedByFormatted })}
              </p>
              <p
                className="text-xs font-medium text-slate-500 dark:text-slate-400"
                data-testid="journey-contact-summary"
              >
                {journey.contact_name
                  ? t('journeys.notifyingContactLabel', {
                      name: journey.contact_name,
                    })
                  : t('journeys.selfReminderOnlyLabel')}
              </p>
            </div>

            {/* Primary Big "I'm safe" Button (>= 56px) */}
            <div className="space-y-3 pt-2">
              <button
                type="button"
                data-testid="journey-im-safe-btn"
                disabled={isSubmitting}
                onClick={handleCompleteSafe}
                className="w-full min-h-[64px] px-6 py-4 rounded-2xl bg-teal-700 hover:bg-teal-800 active:bg-teal-900 text-white font-extrabold text-lg flex items-center justify-center gap-2.5 shadow-md focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50"
              >
                <CheckCircle2 className="w-6 h-6" aria-hidden="true" />
                {t('journeys.imSafeBtn')}
              </button>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  data-testid="journey-extend-btn"
                  disabled={isSubmitting}
                  onClick={handleExtend10Min}
                  className="min-h-[56px] w-full"
                >
                  <Plus className="w-4 h-4 mr-1.5" aria-hidden="true" />
                  {t('journeys.extend10Btn')}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  data-testid="journey-cancel-btn"
                  disabled={isSubmitting}
                  onClick={handleCancelJourney}
                  className="min-h-[56px] w-full"
                >
                  <XCircle className="w-4 h-4 mr-1.5" aria-hidden="true" />
                  {t('journeys.endCancelBtn')}
                </Button>
              </div>
            </div>
          </Card>
        ) : (
          /* START JOURNEY SCREEN */
          <Card data-testid="journey-start-screen" className="space-y-6">
            {/* Duration Chips (56px targets) */}
            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                {t('journeys.startSectionTitle')}
              </label>
              <div
                className="grid grid-cols-2 sm:grid-cols-4 gap-3"
                role="group"
                aria-label={t('journeys.startSectionTitle')}
              >
                {DURATION_OPTIONS_MINUTES.map((mins) => {
                  const isSelected = selectedDuration === mins;
                  return (
                    <button
                      key={mins}
                      type="button"
                      data-testid={`journey-duration-chip-${mins}`}
                      aria-pressed={isSelected}
                      onClick={() => setSelectedDuration(mins)}
                      className={`min-h-[56px] px-4 py-3 rounded-xl font-bold text-sm border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                        isSelected
                          ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-600'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-800 dark:text-slate-200 hover:border-teal-600'
                      }`}
                    >
                      {t('journeys.durationChip', { minutes: mins })}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Optional Contact Picker from Accepted Contacts (56px target) */}
            <div className="space-y-2">
              <label
                htmlFor="journey-contact-select"
                className="block text-sm font-bold text-slate-900 dark:text-slate-100"
              >
                {t('journeys.contactPickerLabel')}
              </label>
              <select
                id="journey-contact-select"
                data-testid="journey-contact-select"
                value={selectedContactId}
                onChange={(e) => setSelectedContactId(e.target.value)}
                className="w-full min-h-[56px] px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
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
                  className="text-xs font-medium text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 rounded-xl px-3.5 py-2.5"
                >
                  {t('journeys.noContactSelectedNote')}
                </p>
              )}
            </div>

            {/* Optional Short Note Field (max 100 chars) - "Where are you heading? (optional)" */}
            <div className="space-y-2">
              <label
                htmlFor="journey-note-input"
                className="block text-sm font-bold text-slate-900 dark:text-slate-100"
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
                className="w-full min-h-[56px] px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-base focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            {/* Start Button (56px target) */}
            <Button
              type="button"
              variant="primary"
              fullWidth
              data-testid="journey-start-btn"
              disabled={isSubmitting}
              onClick={handleStartJourney}
              className="min-h-[56px] text-base font-bold"
            >
              <Footprints className="w-5 h-5 mr-2" aria-hidden="true" />
              {isSubmitting ? t('journeys.startingBtn') : t('journeys.startBtn')}
            </Button>
          </Card>
        )}
      </div>
    </PageLayout>
  );
};
