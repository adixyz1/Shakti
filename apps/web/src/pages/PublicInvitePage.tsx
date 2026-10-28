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
      <div className="max-w-lg mx-auto py-4 space-y-5 text-ink">
        {isLoading ? (
          <div className="py-12 flex justify-center text-teal-700">
            <Spinner className="w-8 h-8" />
          </div>
        ) : outcome === 'accepted' ? (
          <Card className="space-y-3 border border-line bg-surface rounded-2xl p-5">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
              <h1 className="text-xl font-bold text-teal-700">
                {t('invite.acceptedTitle')}
              </h1>
            </div>
            <p className="text-xs md:text-sm text-muted leading-relaxed">
              {t('invite.acceptedBody', {
                inviter: details?.inviter_name || 'your contact',
              })}
            </p>
          </Card>
        ) : outcome === 'declined' ? (
          <Card className="space-y-3 border border-line bg-surface rounded-2xl p-5">
            <h1 className="text-xl font-bold text-ink">
              {t('invite.declinedTitle')}
            </h1>
            <p className="text-xs md:text-sm text-muted leading-relaxed">
              {t('invite.declinedBody')}
            </p>
          </Card>
        ) : errorMsg || !details ? (
          <Card className="space-y-3 border-2 border-crimson-800 bg-surface rounded-2xl p-5">
            <h1 className="text-xl font-bold text-crimson-800">
              {t('invite.expiredTitle')}
            </h1>
            <p className="text-xs md:text-sm text-muted leading-relaxed">
              {errorMsg || t('invite.expiredBody')}
            </p>
          </Card>
        ) : (
          <Card className="space-y-5 border border-line bg-surface rounded-2xl p-5">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
                <p className="text-xs font-mono uppercase tracking-wider text-teal-700 font-semibold">
                  {t('invite.kicker')}
                </p>
              </div>
              <h1 className="text-xl md:text-2xl font-bold text-ink">
                {t('invite.title', { inviter: details.inviter_name })}
              </h1>
              <p className="text-xs text-muted leading-relaxed">
                {t('invite.subtitle', { contact: details.contact_name })}
              </p>
            </div>

            <div className="space-y-2 border-t border-b border-line py-3">
              <h2 className="text-xs font-mono uppercase tracking-wider font-bold text-ink">
                {t('invite.whatYouReceiveTitle')}
              </h2>
              <ul className="space-y-1.5 text-xs text-muted list-disc pl-4">
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

            <p className="text-xs font-mono text-muted leading-relaxed">
              {t('invite.privacyNotice', { inviter: details.inviter_name })}
            </p>

            <div className="space-y-2 pt-1 border-t border-line">
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
