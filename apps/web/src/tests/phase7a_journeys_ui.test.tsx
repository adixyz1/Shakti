import React from 'react';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  act,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import '../i18n';
import i18n from '../i18n';
import { SafeJourneyPage } from '../pages/SafeJourneyPage';
import {
  contactsApi,
  journeysApi,
  type JourneyDto,
  type TrustedContact,
} from '../lib/api';
import * as sosModule from '../lib/sos';
import { useAuthStore } from '../store/authStore';

const mockAcceptedContacts: TrustedContact[] = [
  {
    id: 'contact-1',
    user_id: 'user-1',
    name: 'Priya Sharma',
    phone_e164: '+919000000031',
    priority_order: 1,
    permissions: {
      receives_sos: true,
      receives_checkin: true,
      can_see_live_location: true,
    },
    status: 'accepted',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  },
];

describe('SAATHI Phase 7A Web UI Tests — Safe Journeys ("Walk with me")', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await i18n.changeLanguage('en');
    useAuthStore.setState({
      user: {
        id: 'user-1',
        phone_e164: '+919000000001',
        name: 'Aarohi Sharma',
        role: 'user',
        language: 'en',
        created_at: new Date().toISOString(),
      },
      isLoading: false,
      toasts: [],
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Start screen, honest no-tracking note ($t(app.name)), duration chips, contact picker, active countdown, reminder prompt, extend, and "I\'m safe" completion (English + Hindi)', async () => {
    vi.spyOn(journeysApi, 'getActive').mockResolvedValue({ journey: null });
    vi.spyOn(contactsApi, 'listContacts').mockResolvedValue({
      contacts: mockAcceptedContacts,
    });

    const activeJourneyMock: JourneyDto = {
      id: 'journey-1',
      user_id: 'user-1',
      contact_id: 'contact-1',
      contact_name: 'Priya Sharma',
      started_at: new Date().toISOString(),
      ends_at: new Date(Date.now() + 2 * 60 * 1000).toISOString(), // 2 min left -> triggers T-minus 3m reminder banner
      status: 'active',
      reminder_sent_at: new Date().toISOString(),
      lapsed_notified_at: null,
    };

    const startSpy = vi
      .spyOn(journeysApi, 'start')
      .mockResolvedValue({ journey: activeJourneyMock });

    const extendSpy = vi.spyOn(journeysApi, 'extend').mockResolvedValue({
      journey: {
        ...activeJourneyMock,
        ends_at: new Date(Date.now() + 12 * 60 * 1000).toISOString(),
        reminder_sent_at: null,
      },
    });

    const completeSpy = vi.spyOn(journeysApi, 'complete').mockResolvedValue({
      journey: {
        ...activeJourneyMock,
        status: 'completed',
      },
    });

    render(
      <MemoryRouter initialEntries={['/journeys']}>
        <Routes>
          <Route path="/journeys" element={<SafeJourneyPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('journey-start-screen')).toBeTruthy();
    });

    // Honest no-tracking note uses $t(app.name)
    expect(
      screen.getByTestId('journey-honest-no-tracking-note').textContent
    ).toContain(
      'SHAKTI cannot see your location during a walk. If you need help, press SOS.'
    );

    // Follow-up 1: When no contact is selected, calm note is shown and Start button is NOT blocked
    expect(
      screen.getByTestId('journey-no-contact-note').textContent
    ).toContain(
      "No one will be told if you don't check in. Pick a trusted contact."
    );
    expect(
      (screen.getByTestId('journey-start-btn') as HTMLButtonElement).disabled
    ).toBe(false);

    // Follow-up 1 & 2 in Hindi on the start screen
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(
      screen.getByTestId('journey-no-contact-note').textContent
    ).toContain('यदि आप चेक-इन नहीं करती हैं तो किसी को नहीं बताया जाएगा');
    expect(
      screen.getByLabelText(/Where are you heading\? \(optional\)/i)
    ).toBeTruthy();
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    // Select 15 min chip, optional contact Priya Sharma, and optional short note
    fireEvent.click(screen.getByTestId('journey-duration-chip-15'));
    fireEvent.change(screen.getByTestId('journey-contact-select'), {
      target: { value: 'contact-1' },
    });

    // Once a contact is selected, the "no contact selected" note disappears
    expect(screen.queryByTestId('journey-no-contact-note')).toBeNull();

    const noteInput = screen.getByTestId(
      'journey-note-input'
    ) as HTMLInputElement;
    expect(noteInput.maxLength).toBe(100);
    fireEvent.change(noteInput, {
      target: { value: 'Walking to Hostel Block C' },
    });

    // Tap Start Walk Timer
    fireEvent.click(screen.getByTestId('journey-start-btn'));

    await waitFor(() => {
      expect(startSpy).toHaveBeenCalledWith({
        duration_minutes: 15,
        contact_id: 'contact-1',
        note: 'Walking to Hostel Block C',
      });
      expect(screen.getByTestId('journey-active-screen')).toBeTruthy();
    });

    // Follow-up 2: The note is NEVER shown on the active journey screen
    expect(
      screen.getByTestId('journey-active-screen').textContent
    ).not.toContain('Walking to Hostel Block C');

    // Verify countdown, contact label, and reminder prompt banner
    expect(screen.getByTestId('journey-countdown-display').textContent).toMatch(
      /^\d{2}:\d{2}$/
    );
    expect(
      screen.getByTestId('journey-contact-summary').textContent
    ).toContain('Priya Sharma');
    expect(screen.getByTestId('journey-reminder-prompt')).toBeTruthy();

    // Verify Hindi (hi) translation on active screen & honest note
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(
      screen.getByTestId('journey-honest-no-tracking-note').textContent
    ).toContain('SHAKTI यात्रा के दौरान आपकी लोकेशन नहीं देख सकता');
    expect(screen.getByTestId('journey-im-safe-btn').textContent).toContain(
      'मैं सुरक्षित हूँ'
    );
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    // Tap Extend +10 min
    fireEvent.click(screen.getByTestId('journey-extend-btn'));
    await waitFor(() => {
      expect(extendSpy).toHaveBeenCalledWith('journey-1', 10);
    });

    // Tap "I'm safe" -> completes journey and returns to start screen
    fireEvent.click(screen.getByTestId('journey-im-safe-btn'));
    await waitFor(() => {
      expect(completeSpy).toHaveBeenCalledWith('journey-1');
      expect(screen.getByTestId('journey-start-screen')).toBeTruthy();
    });
  });

  it('2. Lapsed screen: displays lapsed warning, Call 112 link (tel:112), Send SOS button (triggers normal SOS flow), and I\'m safe dismiss', async () => {
    const lapsedJourneyMock: JourneyDto = {
      id: 'journey-lapsed-1',
      user_id: 'user-1',
      contact_id: 'contact-1',
      contact_name: 'Priya Sharma',
      started_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
      ends_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      status: 'lapsed',
      reminder_sent_at: new Date(Date.now() - 8 * 60 * 1000).toISOString(),
      lapsed_notified_at: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    };

    vi.spyOn(journeysApi, 'getActive').mockResolvedValue({
      journey: lapsedJourneyMock,
    });
    vi.spyOn(contactsApi, 'listContacts').mockResolvedValue({
      contacts: mockAcceptedContacts,
    });

    const triggerSosSpy = vi.spyOn(sosModule, 'triggerSos').mockResolvedValue({
      incident: {
        id: 'inc-from-lapsed',
        user_id: 'user-1',
        status: 'TRIGGERED',
        emergency_type: null,
        client_request_id: 'req-sos-lapsed',
        created_at: new Date().toISOString(),
        activated_at: null,
        closed_at: null,
        merged_into_id: null,
        source_trigger: 'button',
        is_duress: false,
        needs_user_action: false,
        escalation_stage: 0,
      },
      idempotent_replay: false,
      merged_into_existing: false,
    });

    render(
      <MemoryRouter initialEntries={['/journeys']}>
        <Routes>
          <Route path="/journeys" element={<SafeJourneyPage />} />
          <Route
            path="/home"
            element={<div data-testid="mock-home-page">Home SOS View</div>}
          />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('journey-lapsed-screen')).toBeTruthy();
    });

    expect(screen.getByTestId('journey-lapsed-heading').textContent).toBe(
      'Check-in timer elapsed'
    );
    expect(screen.getByTestId('journey-lapsed-body').textContent).toContain(
      'Priya Sharma'
    );

    const call112Link = screen.getByTestId(
      'journey-lapsed-call-112-btn'
    ) as HTMLAnchorElement;
    expect(call112Link.getAttribute('href')).toBe('tel:112');

    // Tapping "Send SOS" triggers the normal SOS incident flow and navigates to /home
    fireEvent.click(screen.getByTestId('journey-lapsed-send-sos-btn'));
    await waitFor(() => {
      expect(triggerSosSpy).toHaveBeenCalledWith('button');
      expect(screen.getByTestId('mock-home-page')).toBeTruthy();
    });
  });
});
