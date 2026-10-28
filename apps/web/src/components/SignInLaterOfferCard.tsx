import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Users, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, Button } from './ui';
import { contactsApi, TrustedContact } from '../lib/api';
import {
  CachedEmergencyContact,
  clearGuestEmergencyContacts,
} from '../lib/offlineQueue';

interface SignInLaterOfferCardProps {
  cachedContacts: CachedEmergencyContact[];
  onlineContacts: TrustedContact[];
  onMigrated: () => Promise<void> | void;
}

export const SignInLaterOfferCard: React.FC<SignInLaterOfferCardProps> = ({
  cachedContacts,
  onlineContacts,
  onMigrated,
}) => {
  const { t } = useTranslation();
  const [isDismissed, setIsDismissed] = useState(false);
  const [isInviting, setIsInviting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [invitationSuccess, setInvitationSuccess] = useState(false);

  if (isDismissed) return null;

  // Find contacts saved locally that are marked as guest contacts or whose phone isn't in user's online circle
  const onlinePhones = new Set(onlineContacts.map((c) => c.phone_e164));
  const pendingMigrateContacts = cachedContacts.filter(
    (c) => c.is_guest_contact || !onlinePhones.has(c.phone_e164)
  );

  if (pendingMigrateContacts.length === 0) {
    return null;
  }

  const handleInviteAll = async () => {
    setIsInviting(true);
    setErrorMsg(null);
    try {
      for (const contact of pendingMigrateContacts) {
        await contactsApi.createContact({
          name: contact.name,
          phone_e164: contact.phone_e164,
          permissions: {
            receives_sos: true,
            receives_checkin: true,
            can_see_live_location: true,
          },
        });
      }

      // "clear the local copy only after she agrees"
      await clearGuestEmergencyContacts();
      setInvitationSuccess(true);
      await onMigrated();
      setTimeout(() => {
        setIsDismissed(true);
      }, 3000);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not invite contacts to your Circle.');
    } finally {
      setIsInviting(false);
    }
  };

  return (
    <Card
      data-testid="signin-later-offer-card"
      className="border-2 border-teal-600 bg-teal-50/70 dark:bg-teal-950/40 p-4 space-y-3 text-left"
    >
      <div className="flex items-start gap-3">
        <Users className="w-5 h-5 text-teal-800 dark:text-teal-300 shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-teal-950 dark:text-teal-100">
            {t('signInLaterOffer.title')}
          </h2>
          <p className="text-xs text-teal-900 dark:text-teal-200 leading-relaxed">
            {t('signInLaterOffer.body', { count: pendingMigrateContacts.length })}
          </p>
        </div>
      </div>

      {invitationSuccess && (
        <p
          role="status"
          data-testid="signin-later-success-msg"
          className="text-xs font-semibold text-teal-800 dark:text-teal-200 flex items-center gap-1.5"
        >
          <CheckCircle2 className="w-4 h-4 text-teal-700 dark:text-teal-400" />
          <span>{t('signInLaterOffer.invitedSuccess')}</span>
        </p>
      )}

      {errorMsg && (
        <p
          role="alert"
          data-testid="signin-later-error-msg"
          className="text-xs font-semibold text-rose-700 dark:text-rose-400 flex items-center gap-1.5"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </p>
      )}

      {!invitationSuccess && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="primary"
            data-testid="invite-local-contacts-btn"
            isLoading={isInviting}
            onClick={() => void handleInviteAll()}
          >
            {t('signInLaterOffer.inviteAllBtn')}
          </Button>
          <Button
            type="button"
            variant="outline"
            data-testid="keep-local-contacts-btn"
            onClick={() => setIsDismissed(true)}
          >
            {t('signInLaterOffer.keepLocalBtn')}
          </Button>
        </div>
      )}
    </Card>
  );
};
