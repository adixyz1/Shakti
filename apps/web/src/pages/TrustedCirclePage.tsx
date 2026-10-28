import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  BigButton,
  Button,
  Card,
  Input,
  Modal,
  Spinner,
} from '../components/ui';
import { PageLayout } from '../components/PageLayout';
import {
  contactsApi,
  devApi,
  type ContactPermissions,
  type OutboxMessage,
  type TrustedContact,
  ApiError,
} from '../lib/api';
import { syncOfflineEmergencyContactsCache } from '../lib/offlineQueue';
import { useAuthStore } from '../store/authStore';

export const TrustedCirclePage: React.FC = () => {
  const { t } = useTranslation();
  const { addToast } = useAuthStore();

  const [contacts, setContacts] = useState<TrustedContact[]>([]);
  const [outbox, setOutbox] = useState<OutboxMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Add Contact Form State
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [permissions, setPermissions] = useState<ContactPermissions>({
    receives_sos: true,
    receives_checkin: true,
    can_see_live_location: false,
  });
  const [formError, setFormError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Contact Modal State
  const [editingContact, setEditingContact] = useState<TrustedContact | null>(
    null
  );
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editPermissions, setEditPermissions] = useState<ContactPermissions>({
    receives_sos: true,
    receives_checkin: true,
    can_see_live_location: false,
  });

  const loadData = useCallback(async () => {
    try {
      const [contactsRes, outboxRes] = await Promise.all([
        contactsApi.listContacts(),
        devApi.getOutbox().catch(() => ({ provider: 'MockSmsProvider', messages: [] })),
      ]);
      setContacts(contactsRes.contacts);
      setOutbox(outboxRes.messages);
      await syncOfflineEmergencyContactsCache(contactsRes.contacts, true);
    } catch (err) {
      addToast(
        err instanceof ApiError ? err.message : 'Failed to load trusted circle',
        'error'
      );
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddContact = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(undefined);
    setIsSubmitting(true);
    try {
      await contactsApi.createContact({
        name: name.trim(),
        phone_e164: phone.trim(),
        permissions,
      });
      setName('');
      setPhone('');
      setPermissions({
        receives_sos: true,
        receives_checkin: true,
        can_see_live_location: false,
      });
      await loadData();
      addToast('Invitation sent via MockSmsProvider', 'success');
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : 'Failed to add contact'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (contact: TrustedContact) => {
    setEditingContact(contact);
    setEditName(contact.name);
    setEditPhone(contact.phone_e164);
    setEditPermissions({ ...contact.permissions });
  };

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingContact) return;
    try {
      await contactsApi.updateContact(editingContact.id, {
        name: editName.trim(),
        phone_e164: editPhone.trim(),
        permissions: editPermissions,
      });
      setEditingContact(null);
      await loadData();
    } catch (err) {
      addToast(
        err instanceof ApiError ? err.message : 'Failed to update contact',
        'error'
      );
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= contacts.length) return;
    const nextOrder = [...contacts];
    const [moved] = nextOrder.splice(index, 1);
    nextOrder.splice(targetIndex, 0, moved);
    try {
      const res = await contactsApi.reorderContacts(nextOrder.map((c) => c.id));
      setContacts(res.contacts);
    } catch (err) {
      addToast(
        err instanceof ApiError ? err.message : 'Failed to reorder contacts',
        'error'
      );
    }
  };

  const handlePauseResume = async (contact: TrustedContact) => {
    try {
      if (contact.status === 'paused') {
        await contactsApi.resumeContact(contact.id);
      } else {
        await contactsApi.pauseContact(contact.id);
      }
      await loadData();
    } catch (err) {
      addToast(
        err instanceof ApiError ? err.message : 'Failed to update contact status',
        'error'
      );
    }
  };

  const handleRemove = async (contactId: string) => {
    try {
      await contactsApi.removeContact(contactId);
      await loadData();
    } catch (err) {
      addToast(
        err instanceof ApiError ? err.message : 'Failed to remove contact',
        'error'
      );
    }
  };

  return (
    <PageLayout>
      <div className="space-y-6 py-2">
        {/* Top Summary Banner per Stitch emergency_circle */}
        <section aria-labelledby="circle-heading" className="bg-surface p-4 border border-line rounded-xl flex flex-col gap-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col">
              <h1 className="text-xl md:text-2xl font-bold text-ink tracking-tight" id="circle-heading">
                {t('circle.title')}
              </h1>
              <p className="text-xs font-mono text-muted tabular-nums mt-0.5">
                {t('circle.countLabel', { count: contacts.length })} (max 5)
              </p>
            </div>
            <div
              aria-label="System status: Escalation active"
              className="flex items-center gap-1.5 px-2 py-1 bg-surface-container border border-line rounded-xl"
            >
              <span className={`w-2 h-2 rounded-full ${contacts.length > 0 ? 'bg-teal-700' : 'bg-muted'}`}></span>
              <span className="text-[11px] font-semibold font-mono uppercase tracking-wider text-ink">
                {contacts.length > 0 ? 'ACTIVE' : 'READY'}
              </span>
            </div>
          </div>
          <div className="bg-paper p-3 border border-line/60 rounded-xl">
            <p className="text-xs text-muted leading-relaxed">
              {t('circle.subtitle')}
            </p>
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Escalation Contact List Column */}
          <section className="lg:col-span-7 space-y-4" aria-label="Escalation contact order">
            <div className="flex items-center justify-between px-1">
              <span className="text-xs font-mono uppercase tracking-wider text-muted font-medium">
                Dispatch Hierarchy
              </span>
              <span className="text-xs font-mono text-muted tabular-nums">
                {contacts.length} / 5
              </span>
            </div>

            {isLoading ? (
              <div className="py-12 flex justify-center text-teal-700">
                <Spinner className="w-8 h-8" />
              </div>
            ) : contacts.length === 0 ? (
              <Card>
                <p className="text-sm text-muted">
                  {t('circle.emptyState')}
                </p>
              </Card>
            ) : (
              contacts.map((contact, idx) => (
                <article
                  key={contact.id}
                  aria-label={`Priority ${idx + 1} Contact: ${contact.name}`}
                  className="bg-surface p-4 border border-line rounded-xl flex flex-col gap-3"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs font-mono uppercase tracking-wider font-semibold text-teal-700">
                      {idx === 0
                        ? '1. Primary Responder'
                        : idx === 1
                        ? '2. Secondary Responder'
                        : `${idx + 1}. Escalation Backup`}
                    </span>
                    <span
                      className={`px-2 py-0.5 text-[11px] font-mono tracking-wider font-semibold border rounded-xl ${
                        contact.status === 'accepted'
                          ? 'bg-ink text-surface border-ink'
                          : contact.status === 'paused'
                          ? 'bg-amber-100 text-amber-900 border-amber-300'
                          : 'bg-surface-container text-ink border-line'
                      }`}
                    >
                      {t(`circle.status.${contact.status}`).toUpperCase()}
                    </span>
                  </div>

                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col min-w-0">
                      <h2 className="text-base md:text-lg font-bold text-ink truncate">
                        {contact.name}
                      </h2>
                      <p className="text-xs md:text-sm font-mono text-muted tabular-nums">
                        {contact.phone_e164}
                      </p>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMove(idx, -1)}
                        aria-label={`${t('circle.moveUp')} ${contact.name}`}
                        className="w-10 h-10 flex items-center justify-center bg-paper border border-line rounded-xl text-ink hover:bg-surface-container disabled:opacity-30 disabled:pointer-events-none"
                      >
                        <svg
                          aria-hidden="true"
                          className="w-4 h-4 stroke-current fill-none stroke-2"
                          strokeLinecap="square"
                          strokeLinejoin="miter"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 19V5M5 12l7-7 7 7" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={idx === contacts.length - 1}
                        onClick={() => handleMove(idx, 1)}
                        aria-label={`${t('circle.moveDown')} ${contact.name}`}
                        className="w-10 h-10 flex items-center justify-center bg-paper border border-line rounded-xl text-ink hover:bg-surface-container disabled:opacity-30 disabled:pointer-events-none"
                      >
                        <svg
                          aria-hidden="true"
                          className="w-4 h-4 stroke-current fill-none stroke-2"
                          strokeLinecap="square"
                          strokeLinejoin="miter"
                          viewBox="0 0 24 24"
                        >
                          <path d="M12 5v14M19 12l-7 7-7-7" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {/* Permissions & Controls */}
                  <div className="pt-2 border-t border-line flex flex-wrap items-center justify-between gap-2 text-xs font-mono text-muted">
                    <div className="flex flex-wrap items-center gap-2">
                      <span>SOS: {contact.permissions.receives_sos ? 'Yes' : 'No'}</span>
                      <span aria-hidden="true">·</span>
                      <span>Check-In: {contact.permissions.receives_checkin ? 'Yes' : 'No'}</span>
                      <span aria-hidden="true">·</span>
                      <span>Location: {contact.permissions.can_see_live_location ? 'Yes' : 'No'}</span>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      className="text-xs h-9"
                      onClick={() => openEditModal(contact)}
                    >
                      {t('circle.editBtn')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="text-xs h-9"
                      onClick={() => handlePauseResume(contact)}
                    >
                      {contact.status === 'paused'
                        ? t('circle.resumeBtn')
                        : t('circle.pauseBtn')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      className="text-xs h-9"
                      onClick={() => handleRemove(contact.id)}
                    >
                      {t('circle.removeBtn')}
                    </Button>
                  </div>
                </article>
              ))
            )}

            {/* Development Outbox Viewer (Simulated SMS Gateway) */}
            <Card className="space-y-3 bg-surface border border-line">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 bg-teal-700 rounded-full"></span>
                  <h2 className="text-xs font-mono uppercase tracking-wider text-ink font-semibold">
                    {t('circle.outboxTitle')}
                  </h2>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={loadData}
                  className="text-xs h-8 px-2"
                >
                  {t('circle.refreshOutboxBtn')}
                </Button>
              </div>
              <p className="text-xs text-muted leading-relaxed">
                {t('circle.outboxSubtitle')}
              </p>

              {outbox.length === 0 ? (
                <p className="text-xs font-mono text-muted py-1">
                  {t('circle.outboxEmpty')}
                </p>
              ) : (
                <div className="divide-y divide-line text-xs font-mono">
                  {outbox.slice(0, 5).map((msg) => (
                    <div
                      key={msg.id}
                      className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <p className="tabular-nums font-semibold text-ink">
                          To: {msg.to_phone_e164} ({msg.metadata?.contact_name || 'Contact'})
                        </p>
                        <p className="text-muted font-sans text-xs">
                          {msg.body}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {msg.metadata?.invitation_url && (
                          <Link
                            to={msg.metadata.invitation_url}
                            data-testid={`outbox-invite-link-${msg.id}`}
                            className="min-h-[44px] px-3 inline-flex items-center text-xs font-semibold text-teal-700 underline underline-offset-4"
                          >
                            {t('circle.openInviteLink')}
                          </Link>
                        )}
                        {msg.metadata?.contact_url && (
                          <Link
                            to={msg.metadata.contact_url}
                            data-testid={`outbox-contact-alert-link-${msg.id}`}
                            className="min-h-[44px] px-3 inline-flex items-center text-xs font-semibold text-crimson-800 underline underline-offset-4"
                          >
                            Open Emergency Alert Link
                          </Link>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          {/* Add Contact Form Column */}
          <section className="lg:col-span-5">
            <Card className="space-y-4 border border-line">
              <div className="border-b border-line pb-3">
                <h2 className="text-base font-bold text-ink">
                  {t('circle.addTitle')}
                </h2>
                <p className="text-xs text-muted mt-0.5">
                  Designate up to 5 priority responders for instant dispatch
                </p>
              </div>

              <form onSubmit={handleAddContact} className="space-y-4">
                <Input
                  label={t('circle.nameLabel')}
                  placeholder={t('circle.namePlaceholder')}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <Input
                  label={t('circle.phoneLabel')}
                  placeholder={t('circle.phonePlaceholder')}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  error={formError}
                  required
                />

                <fieldset className="space-y-2 pt-1 border-t border-line">
                  <legend className="text-xs font-mono uppercase tracking-wider text-muted font-medium pt-2">
                    {t('circle.permissionsLegend')}
                  </legend>

                  <label className="min-h-[44px] flex items-center gap-3 text-xs md:text-sm text-ink cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={permissions.receives_sos}
                      onChange={(e) =>
                        setPermissions((p) => ({
                          ...p,
                          receives_sos: e.target.checked,
                        }))
                      }
                      className="w-5 h-5 accent-teal-700 rounded-xl"
                    />
                    <span>{t('circle.permSos')}</span>
                  </label>

                  <label className="min-h-[44px] flex items-center gap-3 text-xs md:text-sm text-ink cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={permissions.receives_checkin}
                      onChange={(e) =>
                        setPermissions((p) => ({
                          ...p,
                          receives_checkin: e.target.checked,
                        }))
                      }
                      className="w-5 h-5 accent-teal-700 rounded-xl"
                    />
                    <span>{t('circle.permCheckin')}</span>
                  </label>

                  <label className="min-h-[44px] flex items-center gap-3 text-xs md:text-sm text-ink cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={permissions.can_see_live_location}
                      onChange={(e) =>
                        setPermissions((p) => ({
                          ...p,
                          can_see_live_location: e.target.checked,
                        }))
                      }
                      className="w-5 h-5 accent-teal-700 rounded-xl"
                    />
                    <span>{t('circle.permLocation')}</span>
                  </label>
                </fieldset>

                <BigButton
                  type="submit"
                  variant="primary"
                  isLoading={isSubmitting}
                  disabled={contacts.length >= 5}
                >
                  {t('circle.addBtn')}
                </BigButton>
              </form>
            </Card>
          </section>
        </div>

        {/* Edit Contact Modal */}
        <Modal
          isOpen={Boolean(editingContact)}
          onClose={() => setEditingContact(null)}
          title={t('circle.editTitle')}
        >
          <form onSubmit={handleSaveEdit} className="space-y-4">
            <Input
              label={t('circle.nameLabel')}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              required
            />
            <Input
              label={t('circle.phoneLabel')}
              value={editPhone}
              onChange={(e) => setEditPhone(e.target.value)}
              required
            />
            <fieldset className="space-y-2 border-t border-line pt-2">
              <legend className="text-xs font-mono uppercase tracking-wider text-muted font-medium">
                {t('circle.permissionsLegend')}
              </legend>
              <label className="min-h-[44px] flex items-center gap-3 text-xs md:text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editPermissions.receives_sos}
                  onChange={(e) =>
                    setEditPermissions((p) => ({
                      ...p,
                      receives_sos: e.target.checked,
                    }))
                  }
                  className="w-5 h-5 accent-teal-700 rounded-xl"
                />
                <span>{t('circle.permSos')}</span>
              </label>
              <label className="min-h-[44px] flex items-center gap-3 text-xs md:text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editPermissions.receives_checkin}
                  onChange={(e) =>
                    setEditPermissions((p) => ({
                      ...p,
                      receives_checkin: e.target.checked,
                    }))
                  }
                  className="w-5 h-5 accent-teal-700 rounded-xl"
                />
                <span>{t('circle.permCheckin')}</span>
              </label>
              <label className="min-h-[44px] flex items-center gap-3 text-xs md:text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={editPermissions.can_see_live_location}
                  onChange={(e) =>
                    setEditPermissions((p) => ({
                      ...p,
                      can_see_live_location: e.target.checked,
                    }))
                  }
                  className="w-5 h-5 accent-teal-700 rounded-xl"
                />
                <span>{t('circle.permLocation')}</span>
              </label>
            </fieldset>
            <div className="flex justify-end gap-2 pt-2 border-t border-line">
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditingContact(null)}
              >
                {t('circle.cancelBtn')}
              </Button>
              <Button type="submit" variant="primary">
                {t('circle.saveBtn')}
              </Button>
            </div>
          </form>
        </Modal>
      </div>
    </PageLayout>
  );
};
