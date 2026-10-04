import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowDown, ArrowUp } from 'lucide-react';
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
      <div className="space-y-8 py-4">
        <header className="space-y-2 border-b border-slate-200 dark:border-slate-800 pb-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-2xl md:text-3xl font-semibold text-slate-900 dark:text-slate-50">
              {t('circle.title')}
            </h1>
            <span className="text-xs font-mono tabular-nums text-teal-800 dark:text-teal-400">
              {t('circle.countLabel', { count: contacts.length })}
            </span>
          </div>
          <p className="text-sm md:text-base text-slate-600 dark:text-slate-300 max-w-3xl leading-relaxed">
            {t('circle.subtitle')}
          </p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Contact List Column */}
          <section className="lg:col-span-7 space-y-4">
            {isLoading ? (
              <div className="py-12 flex justify-center text-teal-700 dark:text-teal-400">
                <Spinner className="w-8 h-8" />
              </div>
            ) : contacts.length === 0 ? (
              <Card>
                <p className="text-sm text-slate-600 dark:text-slate-300">
                  {t('circle.emptyState')}
                </p>
              </Card>
            ) : (
              contacts.map((contact, idx) => (
                <Card key={contact.id} className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      {/* Clean unboxed metadata per Zero-Pill Discipline */}
                      <div className="flex flex-wrap items-center gap-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                        <span>
                          {t('circle.priorityLabel', {
                            order: contact.priority_order,
                          })}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            contact.status === 'accepted'
                              ? 'font-semibold text-teal-700 dark:text-teal-400'
                              : contact.status === 'paused'
                              ? 'font-semibold text-amber-700 dark:text-amber-400'
                              : 'text-slate-600 dark:text-slate-300'
                          }
                        >
                          {t(`circle.status.${contact.status}`)}
                        </span>
                      </div>
                      <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                        {contact.name}
                      </h2>
                      <p className="text-xs font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {contact.phone_e164}
                      </p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => handleMove(idx, -1)}
                        aria-label={`${t('circle.moveUp')} ${contact.name}`}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                      >
                        <ArrowUp className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === contacts.length - 1}
                        onClick={() => handleMove(idx, 1)}
                        aria-label={`${t('circle.moveDown')} ${contact.name}`}
                        className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40"
                      >
                        <ArrowDown className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Unboxed Permission Summary */}
                  <div className="text-xs text-slate-600 dark:text-slate-300 flex flex-wrap items-center gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
                    <span>
                      SOS: {contact.permissions.receives_sos ? 'Yes' : 'No'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Check-In:{' '}
                      {contact.permissions.receives_checkin ? 'Yes' : 'No'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>
                      Live Location:{' '}
                      {contact.permissions.can_see_live_location ? 'Yes' : 'No'}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => openEditModal(contact)}
                    >
                      {t('circle.editBtn')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => handlePauseResume(contact)}
                    >
                      {contact.status === 'paused'
                        ? t('circle.resumeBtn')
                        : t('circle.pauseBtn')}
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      onClick={() => handleRemove(contact.id)}
                    >
                      {t('circle.removeBtn')}
                    </Button>
                  </div>
                </Card>
              ))
            )}

            {/* Development Outbox Viewer */}
            <Card className="space-y-3 bg-slate-100/70 dark:bg-slate-900/60">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                  {t('circle.outboxTitle')}
                </h2>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={loadData}
                  className="text-xs"
                >
                  {t('circle.refreshOutboxBtn')}
                </Button>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t('circle.outboxSubtitle')}
              </p>

              {outbox.length === 0 ? (
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {t('circle.outboxEmpty')}
                </p>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-slate-800 text-xs">
                  {outbox.slice(0, 5).map((msg) => (
                    <div
                      key={msg.id}
                      className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="space-y-0.5">
                        <p className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200">
                          To: {msg.to_phone_e164} ({msg.metadata?.contact_name})
                        </p>
                        <p className="text-slate-600 dark:text-slate-400">
                          {msg.body}
                        </p>
                      </div>
                      {msg.metadata?.invitation_url && (
                        <Link
                          to={msg.metadata.invitation_url}
                          className="min-h-[44px] px-3 inline-flex items-center font-semibold text-teal-700 dark:text-teal-400 underline underline-offset-4"
                        >
                          {t('circle.openInviteLink')}
                        </Link>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </section>

          {/* Add Contact Form Column */}
          <section className="lg:col-span-5">
            <Card className="space-y-5">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                {t('circle.addTitle')}
              </h2>

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

                <fieldset className="space-y-2 pt-1">
                  <legend className="text-sm font-medium text-slate-800 dark:text-slate-200">
                    {t('circle.permissionsLegend')}
                  </legend>

                  <label className="min-h-[44px] flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissions.receives_sos}
                      onChange={(e) =>
                        setPermissions((p) => ({
                          ...p,
                          receives_sos: e.target.checked,
                        }))
                      }
                      className="w-5 h-5 accent-teal-700 rounded"
                    />
                    <span>{t('circle.permSos')}</span>
                  </label>

                  <label className="min-h-[44px] flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissions.receives_checkin}
                      onChange={(e) =>
                        setPermissions((p) => ({
                          ...p,
                          receives_checkin: e.target.checked,
                        }))
                      }
                      className="w-5 h-5 accent-teal-700 rounded"
                    />
                    <span>{t('circle.permCheckin')}</span>
                  </label>

                  <label className="min-h-[44px] flex items-center gap-3 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={permissions.can_see_live_location}
                      onChange={(e) =>
                        setPermissions((p) => ({
                          ...p,
                          can_see_live_location: e.target.checked,
                        }))
                      }
                      className="w-5 h-5 accent-teal-700 rounded"
                    />
                    <span>{t('circle.permLocation')}</span>
                  </label>
                </fieldset>

                <BigButton
                  type="submit"
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
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {t('circle.permissionsLegend')}
              </legend>
              <label className="min-h-[44px] flex items-center gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editPermissions.receives_sos}
                  onChange={(e) =>
                    setEditPermissions((p) => ({
                      ...p,
                      receives_sos: e.target.checked,
                    }))
                  }
                  className="w-5 h-5 accent-teal-700"
                />
                <span>{t('circle.permSos')}</span>
              </label>
              <label className="min-h-[44px] flex items-center gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editPermissions.receives_checkin}
                  onChange={(e) =>
                    setEditPermissions((p) => ({
                      ...p,
                      receives_checkin: e.target.checked,
                    }))
                  }
                  className="w-5 h-5 accent-teal-700"
                />
                <span>{t('circle.permCheckin')}</span>
              </label>
              <label className="min-h-[44px] flex items-center gap-3 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={editPermissions.can_see_live_location}
                  onChange={(e) =>
                    setEditPermissions((p) => ({
                      ...p,
                      can_see_live_location: e.target.checked,
                    }))
                  }
                  className="w-5 h-5 accent-teal-700"
                />
                <span>{t('circle.permLocation')}</span>
              </label>
            </fieldset>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="ghost"
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
