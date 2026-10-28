import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Users,
  Plus,
  Trash2,
  Edit2,
  AlertTriangle,
  CheckCircle2,
  Phone,
  Shield,
} from 'lucide-react';
import { Card, Button, BigButton, Input } from './ui';
import {
  CachedEmergencyContact,
  addGuestEmergencyContact,
  updateGuestEmergencyContact,
  removeGuestEmergencyContact,
  clearAllDeviceData,
  MAX_GUEST_CONTACTS,
} from '../lib/offlineQueue';

interface GuestContactsCardProps {
  contacts: CachedEmergencyContact[];
  onContactsUpdated: () => Promise<void> | void;
}

export const GuestContactsCard: React.FC<GuestContactsCardProps> = ({
  contacts,
  onContactsUpdated,
}) => {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const startAdd = () => {
    setEditingId(null);
    setNameInput('');
    setPhoneInput('');
    setFormError(null);
    setIsEditing(true);
  };

  const startEdit = (c: CachedEmergencyContact) => {
    setEditingId(c.id);
    setNameInput(c.name);
    setPhoneInput(c.phone_e164);
    setFormError(null);
    setIsEditing(true);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditingId(null);
    setNameInput('');
    setPhoneInput('');
    setFormError(null);
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = nameInput.trim();
    const trimmedPhone = phoneInput.trim();

    if (!trimmedName || trimmedName.length < 2) {
      setFormError('Please enter a valid contact name (at least 2 characters).');
      return;
    }

    const digitsOnly = trimmedPhone.replace(/\D/g, '');
    if (digitsOnly.length < 8) {
      setFormError('Please enter a valid phone number with country code (e.g. +919876543210).');
      return;
    }

    const formattedPhone = trimmedPhone.startsWith('+')
      ? `+${digitsOnly}`
      : `+91${digitsOnly.slice(-10)}`;

    try {
      if (editingId) {
        await updateGuestEmergencyContact(editingId, {
          name: trimmedName,
          phone_e164: formattedPhone,
        });
      } else {
        await addGuestEmergencyContact({
          name: trimmedName,
          phone_e164: formattedPhone,
        });
      }
      setIsEditing(false);
      setEditingId(null);
      setNameInput('');
      setPhoneInput('');
      await onContactsUpdated();
    } catch (err: any) {
      setFormError(err?.message || 'Could not save contact.');
    }
  };

  const handleRemove = async (id: string) => {
    try {
      await removeGuestEmergencyContact(id);
      await onContactsUpdated();
    } catch (err: any) {
      setFormError(err?.message || 'Could not remove contact.');
    }
  };

  const handleClearAllData = async () => {
    setIsClearing(true);
    try {
      await clearAllDeviceData();
      setShowClearConfirm(false);
      setToastMsg(t('guestContacts.dataClearedToast'));
      await onContactsUpdated();
      setTimeout(() => setToastMsg(null), 3500);
    } finally {
      setIsClearing(false);
    }
  };

  const canAddMore = contacts.length < MAX_GUEST_CONTACTS;

  return (
    <Card
      data-testid="guest-contacts-card"
      className="space-y-4 border border-line dark:border-night-line bg-surface dark:bg-night-surface text-left"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-teal-700 dark:text-teal-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              {t('guestContacts.title')}
            </h2>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-300">
            {t('guestContacts.subtitle')}
          </p>
        </div>
        <span
          data-testid="guest-contacts-count-badge"
          className="text-xs font-mono font-semibold px-2.5 py-1 rounded-lg bg-teal-50 dark:bg-teal-950/60 border border-teal-200 dark:border-teal-800 text-teal-800 dark:text-teal-300 self-start sm:self-auto"
        >
          {contacts.length} / {MAX_GUEST_CONTACTS}
        </span>
      </div>

      {toastMsg && (
        <div
          role="status"
          data-testid="guest-toast-msg"
          className="p-3 bg-teal-50 dark:bg-teal-950/50 border border-teal-200 dark:border-teal-800 rounded-xl text-xs font-semibold text-teal-900 dark:text-teal-200 flex items-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4 text-teal-700 dark:text-teal-400 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Warning regarding device-only storage */}
      <div
        data-testid="guest-storage-warning"
        className="rounded-xl border border-amber-300 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/30 p-3 flex items-start gap-2.5"
      >
        <AlertTriangle className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed font-medium">
          {t('guestContacts.warningBrowserData')}
        </p>
      </div>

      {/* Contact List */}
      <div className="space-y-2">
        {contacts.length === 0 ? (
          <p
            data-testid="guest-no-contacts"
            className="text-xs text-slate-500 dark:text-slate-400 italic py-2 text-center"
          >
            {t('guestSos.noContactsSaved')}
          </p>
        ) : (
          contacts.map((contact, index) => (
            <div
              key={contact.id}
              data-testid={`guest-contact-row-${contact.id}`}
              className="flex items-center justify-between gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800"
            >
              <div className="space-y-0.5 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-slate-400">
                    #{index + 1}
                  </span>
                  <span className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                    {contact.name}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400 font-mono">
                  <Phone className="w-3 h-3 text-slate-400" />
                  <span>{contact.phone_e164}</span>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  data-testid={`edit-guest-contact-${contact.id}`}
                  onClick={() => startEdit(contact)}
                  className="min-h-[44px] min-w-[44px] p-2 rounded-lg text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors inline-flex items-center justify-center"
                  aria-label={`Edit ${contact.name}`}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  data-testid={`remove-guest-contact-${contact.id}`}
                  onClick={() => void handleRemove(contact.id)}
                  className="min-h-[44px] min-w-[44px] p-2 rounded-lg text-rose-600 hover:text-rose-800 dark:text-rose-400 dark:hover:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors inline-flex items-center justify-center"
                  aria-label={`Remove ${contact.name}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Inline Form to Add / Edit Contact */}
      {isEditing ? (
        <form
          data-testid="guest-contact-form"
          onSubmit={(e) => void handleSaveContact(e)}
          className="p-4 rounded-xl border border-teal-600 bg-slate-50 dark:bg-slate-900 space-y-3"
        >
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {editingId ? t('guestContacts.editBtn') : t('guestContacts.addBtn')}
          </h3>

          <Input
            label={t('guestContacts.nameLabel')}
            data-testid="guest-contact-name-input"
            type="text"
            placeholder="e.g. Maya Sharma"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            required
          />

          <Input
            label={t('guestContacts.phoneLabel')}
            data-testid="guest-contact-phone-input"
            type="tel"
            placeholder="e.g. +91 98765 43210"
            value={phoneInput}
            onChange={(e) => setPhoneInput(e.target.value)}
            required
          />

          {formError && (
            <p
              role="alert"
              data-testid="guest-contact-form-error"
              className="text-xs font-semibold text-rose-700 dark:text-rose-400"
            >
              {formError}
            </p>
          )}

          <div className="grid grid-cols-2 gap-2 pt-1">
            <Button
              type="submit"
              variant="primary"
              data-testid="save-guest-contact-btn"
            >
              {t('guestContacts.saveBtn')}
            </Button>
            <Button
              type="button"
              variant="outline"
              data-testid="cancel-guest-contact-btn"
              onClick={cancelEdit}
            >
              {t('guestContacts.cancelBtn')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 pt-1">
          {canAddMore ? (
            <Button
              type="button"
              variant="outline"
              data-testid="add-guest-contact-btn"
              onClick={startAdd}
              className="inline-flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>{t('guestContacts.addBtn')}</span>
            </Button>
          ) : (
            <p
              data-testid="guest-max-contacts-msg"
              className="text-xs font-medium text-amber-700 dark:text-amber-400"
            >
              {t('guestContacts.maxWarning')}
            </p>
          )}

          {!showClearConfirm ? (
            <Button
              type="button"
              variant="outline"
              data-testid="clear-phone-data-btn"
              onClick={() => setShowClearConfirm(true)}
              className="text-rose-700 dark:text-rose-400 hover:text-rose-800 border-rose-300 dark:border-rose-800"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              <span>{t('guestContacts.clearDataBtn')}</span>
            </Button>
          ) : (
            <div
              data-testid="clear-phone-confirm-box"
              className="p-3 border border-rose-400 bg-rose-50 dark:bg-rose-950/60 rounded-xl space-y-2 text-left"
            >
              <p className="text-xs font-semibold text-rose-950 dark:text-rose-100">
                {t('guestContacts.clearConfirm')}
              </p>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="danger"
                  data-testid="confirm-clear-phone-data-btn"
                  isLoading={isClearing}
                  onClick={() => void handleClearAllData()}
                >
                  {t('guestContacts.clearDataBtn')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowClearConfirm(false)}
                >
                  {t('guestContacts.cancelBtn')}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
};
