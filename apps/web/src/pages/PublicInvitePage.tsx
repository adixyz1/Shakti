import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BigButton, Card, Spinner } from '../components/ui';
import { PageLayout } from '../components/PageLayout';
import {
  invitationsApi,
  type PublicInvitationDetails,
  ApiError,
} from '../lib/api';

export const PublicInvitePage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const { t } = useTranslation();

  const [details, setDetails] = useState<PublicInvitationDetails | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<'accepted' | 'declined' | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!token) {
      setErrorMsg(t('invite.expiredBody'));
      setIsLoading(false);
      return;
    }

    (async () => {
      try {
        const res = await invitationsApi.getInvitation(token);
        if (mounted) {
          setDetails(res);
          if (res.status === 'accepted') {
            setOutcome('accepted');
          } else if (res.status === 'declined') {
            setOutcome('declined');
          } else if (res.status === 'expired') {
            setErrorMsg(t('invite.expiredBody'));
          }
        }
      } catch (err) {
        if (mounted) {
          setErrorMsg(
            err instanceof ApiError ? err.message : t('invite.expiredBody')
          );
        }
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    })();

    return () => {
      mounted = false;
    };
  }, [token, t]);

  const handleAccept = async () => {
    if (!token) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await invitationsApi.acceptInvitation(token);
      setOutcome('accepted');
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : t('invite.expiredBody')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDecline = async () => {
    if (!token) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await invitationsApi.declineInvitation(token);
      setOutcome('declined');
    } catch (err) {
      setErrorMsg(
        err instanceof ApiError ? err.message : t('invite.expiredBody')
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageLayout>
      <div className="max-w-lg mx-auto py-6 space-y-6">
        {isLoading ? (
          <div className="py-12 flex justify-center text-teal-700 dark:text-teal-400">
            <Spinner className="w-8 h-8" />
          </div>
        ) : outcome === 'accepted' ? (
          <Card className="space-y-3">
            <h1 className="text-2xl font-semibold text-teal-800 dark:text-teal-400">
              {t('invite.acceptedTitle')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('invite.acceptedBody', {
                inviter: details?.inviter_name || 'your contact',
              })}
            </p>
          </Card>
        ) : outcome === 'declined' ? (
          <Card className="space-y-3">
            <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
              {t('invite.declinedTitle')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {t('invite.declinedBody')}
            </p>
          </Card>
        ) : errorMsg || !details ? (
          <Card className="space-y-3">
            <h1 className="text-2xl font-semibold text-rose-700 dark:text-rose-400">
              {t('invite.expiredTitle')}
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
              {errorMsg || t('invite.expiredBody')}
            </p>
          </Card>
        ) : (
          <Card className="space-y-6">
            <div className="space-y-2">
              <p className="text-xs font-medium text-teal-700 dark:text-teal-400">
                {t('invite.kicker')}
              </p>
              <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-50">
                {t('invite.title', { inviter: details.inviter_name })}
              </h1>
              <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">
                {t('invite.subtitle', { contact: details.contact_name })}
              </p>
            </div>

            <div className="space-y-3 border-t border-b border-slate-100 dark:border-slate-800 py-4">
              <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                {t('invite.whatYouReceiveTitle')}
              </h2>
              <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300 list-disc pl-5">
                <li>
                  {details.permissions.receives_sos
                    ? t('invite.permSosYes', { inviter: details.inviter_name })
                    : t('invite.permSosNo')}
                </li>
                <li>
                  {details.permissions.receives_checkin
                    ? t('invite.permCheckinYes')
                    : t('invite.permCheckinNo')}
                </li>
                <li>
                  {details.permissions.can_see_live_location
                    ? t('invite.permLocationYes')
                    : t('invite.permLocationNo')}
                </li>
              </ul>
            </div>

            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {t('invite.privacyNotice', { inviter: details.inviter_name })}
            </p>

            <div className="space-y-3 pt-2">
              <BigButton
                type="button"
                variant="primary"
                isLoading={isSubmitting}
                onClick={handleAccept}
              >
                {t('invite.acceptBtn')}
              </BigButton>
              <BigButton
                type="button"
                variant="outline"
                isLoading={isSubmitting}
                onClick={handleDecline}
              >
                {t('invite.declineBtn')}
              </BigButton>
            </div>
          </Card>
        )}
      </div>
    </PageLayout>
  );
};
