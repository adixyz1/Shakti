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
import { SafetyReportsPage } from '../pages/SafetyReportsPage';
import { consentsApi, reportsApi } from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';

describe('SAATHI Phase 7B Web UI Tests — Reports & Aggregated Safety Layer', () => {
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
    useTriggerSettingsStore.setState({
      lowPowerDataSaverMode: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it('1. Report flow, category chips, consent-gated current location, anonymous toggle with plain explanation, and English + Hindi i18n', async () => {
    vi.spyOn(reportsApi, 'getSafetyLayer').mockResolvedValue({
      k_threshold: 5,
      cell_precision_decimals: 3,
      approx_cell_size_meters: 110,
      cells: [
        {
          cell_id: '28.614,77.209',
          lat: 28.614,
          lng: 77.209,
          total_count: 6,
          categories: {
            poor_lighting: 4,
            unsafe_area: 2,
          },
          last_reported_at: new Date().toISOString(),
        },
      ],
    });

    vi.spyOn(consentsApi, 'getConsents').mockResolvedValue({
      current: {
        location: true,
        notifications: true,
        microphone: false,
        camera: false,
        data_processing: true,
      },
      history: [],
    });

    const createReportSpy = vi
      .spyOn(reportsApi, 'createReport')
      .mockResolvedValue({
        report: {
          id: 'rep-1',
          category: 'unsafe_area',
          lat: 28.619,
          lng: 77.214,
          anonymous: true,
          created_at: new Date().toISOString(),
        },
      });

    // Mock navigator.geolocation for "Use my current location" after consent
    (window.navigator as any).geolocation = {
      getCurrentPosition: (success: (pos: any) => void) => {
        success({
          coords: {
            latitude: 28.61888,
            longitude: 77.21412,
            accuracy: 12,
          },
        });
      },
    };

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<SafetyReportsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('safety-reports-page')).toBeTruthy();
      expect(screen.getByTestId('safety-layer-cell-28.614,77.209')).toBeTruthy();
    });

    // Privacy banner uses $t(app.name)
    expect(
      screen.getByTestId('reports-k-anonymity-banner').textContent
    ).toContain('SHAKTI rounds report coordinates to ~100 m grid cells');

    // Select category chip "Unsafe area"
    fireEvent.click(screen.getByTestId('report-category-chip-unsafe_area'));

    // Tap "Use my current location" (available because location consent is granted)
    fireEvent.click(screen.getByTestId('report-use-current-location-btn'));
    expect(
      screen.getByTestId('report-rounded-coords-preview').textContent
    ).toContain('28.619, 77.214');

    // Verify anonymous toggle defaults to ON with plain explanation
    const anonToggle = screen.getByTestId(
      'report-anonymous-toggle'
    ) as HTMLInputElement;
    expect(anonToggle.checked).toBe(true);
    expect(
      screen.getByTestId('report-anonymous-explanation').textContent
    ).toContain('SHAKTI will store NO user ID with this report');

    // Toggle anonymous OFF and back ON to verify explanation updates
    fireEvent.click(anonToggle);
    expect(anonToggle.checked).toBe(false);
    expect(
      screen.getByTestId('report-anonymous-explanation').textContent
    ).toContain('Your account ID will be stored for admin moderation only');
    fireEvent.click(anonToggle);
    expect(anonToggle.checked).toBe(true);

    // Enter optional note
    fireEvent.change(screen.getByTestId('report-note-input'), {
      target: { value: 'Broken footpath and unlit corner' },
    });

    // Verify Hindi (hi) localization
    await act(async () => {
      await i18n.changeLanguage('hi');
    });
    expect(screen.getByTestId('safety-reports-title').textContent).toContain(
      'सामुदायिक सुरक्षा रिपोर्ट'
    );
    expect(
      screen.getByTestId('report-anonymous-explanation').textContent
    ).toContain('SHAKTI इस रिपोर्ट के साथ कोई यूज़र ID सहेजेगा नहीं');
    await act(async () => {
      await i18n.changeLanguage('en');
    });

    // Submit report
    fireEvent.click(screen.getByTestId('report-submit-btn'));

    await waitFor(() => {
      expect(createReportSpy).toHaveBeenCalledWith({
        category: 'unsafe_area',
        lat: 28.619,
        lng: 77.214,
        note: 'Broken footpath and unlit corner',
        anonymous: true,
      });
      expect(screen.getByTestId('report-submitted-banner')).toBeTruthy();
    });
  });

  it('2. Aggregated map list in data-saver / offline mode and location consent off: hides map tiles, shows text list of aggregated cells, and blocks current-location GPS button when consent is off', async () => {
    useTriggerSettingsStore.setState({
      lowPowerDataSaverMode: true,
    });

    vi.spyOn(reportsApi, 'getSafetyLayer').mockResolvedValue({
      k_threshold: 5,
      cell_precision_decimals: 3,
      approx_cell_size_meters: 110,
      cells: [
        {
          cell_id: '28.614,77.209',
          lat: 28.614,
          lng: 77.209,
          total_count: 7,
          categories: {
            poor_lighting: 5,
            harassment: 2,
          },
          last_reported_at: new Date().toISOString(),
        },
      ],
    });

    vi.spyOn(consentsApi, 'getConsents').mockResolvedValue({
      current: {
        location: false,
        notifications: true,
        microphone: false,
        camera: false,
        data_processing: true,
      },
      history: [],
    });

    render(
      <MemoryRouter initialEntries={['/reports']}>
        <Routes>
          <Route path="/reports" element={<SafetyReportsPage />} />
        </Routes>
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByTestId('safety-layer-datasaver-note')).toBeTruthy();
      expect(screen.getByTestId('safety-layer-cell-list')).toBeTruthy();
    });

    // Map tiles are not rendered in data-saver mode
    expect(screen.queryByTestId('safety-layer-leaflet-map')).toBeNull();
    expect(screen.queryByTestId('report-pin-leaflet-map')).toBeNull();

    // Text list shows aggregated cell summary only (no individual report notes)
    const cellItem = screen.getByTestId('safety-layer-cell-28.614,77.209');
    expect(cellItem.textContent).toContain(
      'Grid Cell (28.614, 77.209) — 7 reports'
    );
    expect(cellItem.textContent).toContain('Poor lighting: 5');
    expect(cellItem.textContent).toContain('Harassment: 2');

    // Because location consent is false, "Use my current location" button is not rendered
    expect(screen.queryByTestId('report-use-current-location-btn')).toBeNull();
    expect(screen.getByTestId('report-location-consent-note')).toBeTruthy();
  });
});
