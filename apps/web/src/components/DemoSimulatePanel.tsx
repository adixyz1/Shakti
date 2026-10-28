import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, ShieldCheck, Users } from 'lucide-react';
import { Button, Card } from './ui';
import { demoApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useDemoStore } from '../store/demoStore';

export const DemoSimulatePanel: React.FC<{
  incidentId?: string;
  onSimulated?: () => void;
}> = ({ incidentId, onSimulated }) => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const { demoMode } = useDemoStore();

  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!demoMode || !user) {
    return null;
  }

  const isEligible =
    user.role === 'admin' ||
    user.phone_e164 === '+919000000001' ||
    user.role === 'user';

  if (!isEligible) {
    return null;
  }

  const handleSimulateContact = async (action: 'seen' | 'on_my_way') => {
    setBusyAction(`contact:${action}`);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const res = await demoApi.simulateContact({
        incident_id: incidentId,
        action,
        delay_ms: 150,
      });
      setFeedback(
        `Simulated contact (${res.contact_name}) → ${res.action} [status: ${res.incident_status}]`
      );
      onSimulated?.();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Simulation failed'
      );
    } finally {
      setBusyAction(null);
    }
  };

  const handleSimulateResponder = async (
    action: 'acknowledge' | 'responding' | 'resolve'
  ) => {
    setBusyAction(`responder:${action}`);
    setErrorMsg(null);
    setFeedback(null);
    try {
      const res = await demoApi.simulateResponder({
        incident_id: incidentId,
        action,
        delay_ms: 150,
      });
      setFeedback(
        `Simulated responder → ${res.action} [status: ${res.incident_status}]`
      );
      onSimulated?.();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Simulation failed'
      );
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <Card
      data-testid="demo-simulate-panel"
      className="border border-amber-500/70 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-950/20 rounded-2xl p-5 space-y-4"
    >
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-amber-950 dark:text-amber-200">
          <Play className="w-4 h-4 shrink-0" />
          <h3 className="text-sm font-bold">{t('demo.panel.title')}</h3>
        </div>
        <p className="text-xs text-muted dark:text-night-muted">
          {t('demo.panel.subtitle')}
        </p>
      </div>

      {feedback && (
        <div
          role="status"
          data-testid="demo-simulate-feedback"
          className="rounded-xl border border-teal-700/60 bg-teal-50 dark:bg-teal-950/60 px-3 py-2 text-xs font-semibold text-teal-900 dark:text-teal-200"
        >
          {feedback}
        </div>
      )}

      {errorMsg && (
        <div
          role="alert"
          data-testid="demo-simulate-error"
          className="rounded-xl border border-crimson-800/60 bg-red-50 dark:bg-red-950/60 px-3 py-2 text-xs font-semibold text-crimson-800 dark:text-red-300"
        >
          {errorMsg}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Simulate Contact Response */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
            <Users className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
            <span>{t('demo.panel.contactSection')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              data-testid="demo-sim-contact-seen-btn"
              isLoading={busyAction === 'contact:seen'}
              onClick={() => void handleSimulateContact('seen')}
              className="text-xs"
            >
              {t('demo.panel.contactSeenBtn')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="demo-sim-contact-on-my-way-btn"
              isLoading={busyAction === 'contact:on_my_way'}
              onClick={() => void handleSimulateContact('on_my_way')}
              className="text-xs"
            >
              {t('demo.panel.contactOnMyWayBtn')}
            </Button>
          </div>
        </div>

        {/* Simulate Responder */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 dark:text-slate-200">
            <ShieldCheck className="w-3.5 h-3.5 text-teal-700 dark:text-teal-400" />
            <span>{t('demo.panel.responderSection')}</span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              data-testid="demo-sim-responder-ack-btn"
              isLoading={busyAction === 'responder:acknowledge'}
              onClick={() => void handleSimulateResponder('acknowledge')}
              className="text-xs"
            >
              {t('demo.panel.responderAckBtn')}
            </Button>
            <Button
              type="button"
              variant="secondary"
              data-testid="demo-sim-responder-on-way-btn"
              isLoading={busyAction === 'responder:responding'}
              onClick={() => void handleSimulateResponder('responding')}
              className="text-xs"
            >
              {t('demo.panel.responderOnWayBtn')}
            </Button>
            <Button
              type="button"
              variant="primary"
              data-testid="demo-sim-responder-resolve-btn"
              isLoading={busyAction === 'responder:resolve'}
              onClick={() => void handleSimulateResponder('resolve')}
              className="text-xs"
            >
              {t('demo.panel.responderResolveBtn')}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
};
