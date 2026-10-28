import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import i18n from '../i18n';
import { SafetyToolsPage, OFFLINE_DEFAULT_SAFETY_TOOLS } from '../pages/SafetyToolsPage';
import { AdminPage } from '../pages/AdminPage';
import { ResourcesPage } from '../pages/ResourcesPage';
import { SettingsPage } from '../pages/SettingsPage';
import { HomePage } from '../pages/HomePage';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import * as apiModule from '../lib/api';

describe('Safety Tools UI & Navigation Suite', () => {
  beforeEach(async () => {
    localStorage.clear();
    sessionStorage.clear();
    useTriggerSettingsStore.getState().resetTriggerSettings();
    await i18n.changeLanguage('en');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. Top of page mandatory disclosure text is rendered in English and Hindi', async () => {
    vi.spyOn(apiModule.safetyToolsApi, 'listSafetyTools').mockResolvedValue({
      safety_tools: [],
    });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/safety-tools']}>
        <SafetyToolsPage />
      </MemoryRouter>
    );

    const disclosureBox = await screen.findByTestId('safety-tools-disclosure');
    expect(disclosureBox).toBeInTheDocument();
    expect(disclosureBox.textContent).toContain(
      'SHAKTI does not sell these items and does not track clicks or purchases. Tools do not guarantee safety. Rules about carrying them can differ by place and change over time, so check before you buy or carry. Ask a qualified person for legal advice.'
    );

    unmount();

    // Hindi disclosure text
    await i18n.changeLanguage('hi');
    render(
      <MemoryRouter initialEntries={['/safety-tools']}>
        <SafetyToolsPage />
      </MemoryRouter>
    );

    const hiDisclosureBox = await screen.findByTestId('safety-tools-disclosure');
    expect(hiDisclosureBox.textContent).toContain(
      'SHAKTI इन वस्तुओं को नहीं बेचता है और क्लिक या खरीदारी को ट्रैक नहीं करता है। उपकरण सुरक्षा की गारंटी नहीं देते हैं। इन्हें साथ रखने के नियम स्थान के अनुसार भिन्न हो सकते हैं और समय के साथ बदल सकते हैं, इसलिए खरीदने या साथ ले जाने से पहले जांच लें। कानूनी सलाह के लिए किसी योग्य व्यक्ति से पूछें।'
    );

    await i18n.changeLanguage('en');
  });

  it('2. Empty state shown with zero links: calm sentence ("No tools are listed yet.", English and Hindi) and disclosure text, nothing else; admin editor still shows every category with "No links added yet"', async () => {
    const toolsWithoutLinks = OFFLINE_DEFAULT_SAFETY_TOOLS.map((t) => ({
      ...t,
      link_url: null,
    }));
    // All tools have link_url: null
    vi.spyOn(apiModule.safetyToolsApi, 'listSafetyTools').mockResolvedValue({
      safety_tools: toolsWithoutLinks,
    });
    vi.spyOn(apiModule.adminAuditApi, 'listAuditLogs').mockResolvedValue({ entries: [] });
    vi.spyOn(apiModule.adminRespondersApi, 'listResponders').mockResolvedValue({ responders: [] });
    vi.spyOn(apiModule.resourcesPulseApi, 'listResources').mockResolvedValue({ resources: [] });

    const { unmount } = render(
      <MemoryRouter initialEntries={['/safety-tools']}>
        <SafetyToolsPage />
      </MemoryRouter>
    );

    const emptySentence = await screen.findByTestId('safety-tools-empty-sentence');
    expect(emptySentence).toBeInTheDocument();
    expect(emptySentence.textContent?.trim()).toBe('No tools are listed yet.');

    // Mandatory disclosure text is present
    expect(screen.getByTestId('safety-tools-disclosure')).toBeInTheDocument();

    // No category filters or tool cards are shown
    expect(screen.queryByTestId('safety-tool-cat-all')).toBeNull();
    expect(screen.queryByTestId('safety-tools-list')).toBeNull();

    unmount();

    // Verify Hindi empty state sentence + disclosure text
    await i18n.changeLanguage('hi');
    const { unmount: unmountHi } = render(
      <MemoryRouter initialEntries={['/safety-tools']}>
        <SafetyToolsPage />
      </MemoryRouter>
    );

    const hiEmptySentence = await screen.findByTestId('safety-tools-empty-sentence');
    expect(hiEmptySentence.textContent?.trim()).toBe('अभी तक कोई उपकरण सूचीबद्ध नहीं हैं।');
    expect(screen.getByTestId('safety-tools-disclosure')).toBeInTheDocument();
    expect(screen.queryByTestId('safety-tools-list')).toBeNull();

    unmountHi();
    await i18n.changeLanguage('en');

    // Admin editor still shows every category with "No links added yet"
    render(
      <MemoryRouter initialEntries={['/admin/tools']}>
        <AdminPage />
      </MemoryRouter>
    );

    const adminList = await screen.findByTestId('admin-safety-tools-list');
    expect(adminList.textContent).toContain('Personal Alarm Keychain');
    expect(adminList.textContent).toContain('Whistle');
    expect(adminList.textContent).toContain('Torch Keyring');
    expect(adminList.textContent).toContain('Portable Door Alarm');
    expect(adminList.textContent).toContain('Pepper Spray');
    expect(adminList.textContent).toContain('Self Defence');
    expect(adminList.textContent).toContain('No links added yet');
  });

  it('3. Category with one link appears while others stay hidden; link has target="_blank" and rel="noopener noreferrer"; affiliate notice appears only for flagged links', async () => {
    const mockTools: apiModule.SafetyToolDto[] = [
      ...OFFLINE_DEFAULT_SAFETY_TOOLS.map((t) => ({ ...t, link_url: null })),
      {
        id: 'tool_whistle_affiliate',
        category: 'whistle',
        title: 'Lanyard Safety Whistle (Affiliate)',
        description: 'Standard orange safety whistle.',
        safe_use_notes: 'Blow 3 short bursts.',
        legal_note: 'Universally legal.',
        link_url: 'https://example.org/whistle-supplier',
        link_label: 'View certified supplier',
        last_checked: '2026-10-28',
        active: true,
        is_affiliate: true,
      },
      {
        id: 'tool_whistle_non_affiliate',
        category: 'whistle',
        title: 'Pealess Whistle (Non-Affiliate)',
        description: 'High-decibel pealess whistle.',
        safe_use_notes: 'Attach to lanyard.',
        legal_note: 'Universally legal.',
        link_url: 'https://example.org/whistle-direct',
        link_label: 'View direct link',
        last_checked: '2026-10-28',
        active: true,
        is_affiliate: false,
      },
    ];

    vi.spyOn(apiModule.safetyToolsApi, 'listSafetyTools').mockResolvedValue({
      safety_tools: mockTools,
    });

    render(
      <MemoryRouter initialEntries={['/safety-tools']}>
        <SafetyToolsPage />
      </MemoryRouter>
    );

    await screen.findByTestId('safety-tool-card-tool_whistle_affiliate');

    // 1. Category with active link (whistle) appears
    expect(screen.getByTestId('safety-tool-card-tool_whistle_affiliate')).toBeInTheDocument();
    expect(screen.getByTestId('safety-tool-card-tool_whistle_non_affiliate')).toBeInTheDocument();

    // 2. Other categories with no links stay completely hidden
    expect(screen.queryByTestId('safety-tool-card-tool_personal_alarm_keychain')).toBeNull();
    expect(screen.queryByTestId('safety-tool-card-tool_pepper_spray')).toBeNull();
    expect(screen.queryByTestId('safety-tool-card-tool_torch_keyring')).toBeNull();
    expect(screen.queryByTestId('safety-tool-card-tool_portable_door_alarm')).toBeNull();
    expect(screen.queryByTestId('safety-tool-cat-personal_alarm_keychain')).toBeNull();
    expect(screen.queryByTestId('safety-tool-cat-pepper_spray')).toBeNull();
    expect(screen.queryByTestId('safety-tool-cat-torch_keyring')).toBeNull();
    expect(screen.queryByTestId('safety-tool-cat-portable_door_alarm')).toBeNull();

    // 3. The link has target="_blank" and rel="noopener noreferrer"
    const linkEl = screen.getByTestId('safety-tool-link-tool_whistle_affiliate');
    expect(linkEl).toBeInTheDocument();
    expect(linkEl).toHaveAttribute('href', 'https://example.org/whistle-supplier');
    expect(linkEl).toHaveAttribute('target', '_blank');
    expect(linkEl).toHaveAttribute('rel', 'noopener noreferrer');

    // 4. Affiliate notice appears ONLY for flagged links (is_affiliate: true) and NOT for unflagged links (is_affiliate: false)
    const affiliateBadge = screen.getByTestId('safety-tool-affiliate-badge-tool_whistle_affiliate');
    expect(affiliateBadge).toBeInTheDocument();
    expect(affiliateBadge.textContent).toContain('We may earn a commission');
    expect(
      screen.queryByTestId('safety-tool-affiliate-badge-tool_whistle_non_affiliate')
    ).toBeNull();
  });

  it('4. Reachable from Resources and Settings pages only', async () => {
    vi.spyOn(apiModule.resourcesPulseApi, 'listResources').mockResolvedValue({
      resources: [],
    });

    // 4a. Reachable from Resources
    const { unmount } = render(
      <MemoryRouter initialEntries={['/resources']}>
        <Routes>
          <Route path="/resources" element={<ResourcesPage />} />
          <Route path="/safety-tools" element={<div data-testid="target-safety-tools">Safety Tools Target</div>} />
        </Routes>
      </MemoryRouter>
    );

    const resLink = await screen.findByTestId('nav-safety-tools-guide-btn');
    expect(resLink).toBeInTheDocument();
    fireEvent.click(resLink);
    expect(await screen.findByTestId('target-safety-tools')).toBeInTheDocument();

    unmount();

    // 4b. Reachable from Settings
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/safety-tools" element={<div data-testid="target-safety-tools-from-settings">Safety Tools Target Settings</div>} />
        </Routes>
      </MemoryRouter>
    );

    const settingsLink = await screen.findByTestId('settings-safety-tools-link');
    expect(settingsLink).toBeInTheDocument();
    fireEvent.click(settingsLink);
    expect(await screen.findByTestId('target-safety-tools-from-settings')).toBeInTheDocument();
  });

  it('5. Absent from emergency and SOS screens on HomePage', async () => {
    render(
      <MemoryRouter initialEntries={['/home']}>
        <HomePage />
      </MemoryRouter>
    );

    await screen.findByTestId('sos-hold-button');

    // Safety tools guide must NEVER appear on the SOS screen
    expect(screen.queryByTestId('safety-tools-page')).toBeNull();
    expect(screen.queryByTestId('safety-tools-disclosure')).toBeNull();
    expect(screen.queryByTestId('nav-safety-tools-guide-btn')).toBeNull();
    expect(screen.queryByTestId('settings-safety-tools-link')).toBeNull();
  });

  it('6. Hidden in Disguise Mode (renders calculator and conceals safety tools)', async () => {
    useTriggerSettingsStore.setState({
      disguiseSequenceHash: 'mock_pbkdf2_hash_value',
      disguiseEnabled: true,
      disguiseUnlockedSession: false,
    });

    render(
      <MemoryRouter initialEntries={['/safety-tools']}>
        <SafetyToolsPage />
      </MemoryRouter>
    );

    // Disguise calculator is shown
    expect(await screen.findByTestId('disguise-calculator')).toBeInTheDocument();
    // Safety tools page content is hidden
    expect(screen.queryByTestId('safety-tools-page')).toBeNull();
    expect(screen.queryByTestId('safety-tools-disclosure')).toBeNull();
  });

  it('7. Offline caching: loads tools from local cache and displays offline badge when network fails', async () => {
    const cachedItems: apiModule.SafetyToolDto[] = [
      {
        ...OFFLINE_DEFAULT_SAFETY_TOOLS[1],
        link_url: 'https://example.org/offline-whistle',
        link_label: 'Offline Whistle Supplier',
        active: true,
      },
    ];

    localStorage.setItem(
      'saathi_cached_safety_tools',
      JSON.stringify(cachedItems)
    );

    // Network call rejects (simulating offline)
    vi.spyOn(apiModule.safetyToolsApi, 'listSafetyTools').mockRejectedValue(
      new Error('Failed to fetch')
    );

    render(
      <MemoryRouter initialEntries={['/safety-tools']}>
        <SafetyToolsPage />
      </MemoryRouter>
    );

    await screen.findByTestId('safety-tools-page');

    // Shows cached item with active link
    expect(screen.getByTestId('safety-tool-card-tool_whistle')).toBeInTheDocument();

    // Shows offline cached badge
    const badge = screen.getByTestId('safety-tools-offline-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).toContain('Cached for offline viewing');
  });
});
