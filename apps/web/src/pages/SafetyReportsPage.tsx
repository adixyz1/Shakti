import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { PageLayout } from '../components/PageLayout';
import { Button, Card, Spinner } from '../components/ui';
import {
  consentsApi,
  reportsApi,
  type ReportCategory,
  type SafetyLayerCellDto,
} from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';

const REPORT_CATEGORY_LIST: ReportCategory[] = [
  'poor_lighting',
  'harassment',
  'stalking',
  'unsafe_area',
  'broken_cctv',
  'other',
];

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export const SafetyReportsPage: React.FC = () => {
  const { t } = useTranslation();
  const { addToast } = useAuthStore();
  const { lowPowerDataSaverMode } = useTriggerSettingsStore();

  const [category, setCategory] = useState<ReportCategory>('poor_lighting');
  const [pinLat, setPinLat] = useState<number>(28.614);
  const [pinLng, setPinLng] = useState<number>(77.209);
  const [note, setNote] = useState<string>('');
  const [anonymous, setAnonymous] = useState<boolean>(true);
  const [locationConsentGranted, setLocationConsentGranted] =
    useState<boolean>(false);

  const [kThreshold, setKThreshold] = useState<number>(5);
  const [cells, setCells] = useState<SafetyLayerCellDto[]>([]);
  const [isLoadingLayer, setIsLoadingLayer] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [lastSubmittedReceipt, setLastSubmittedReceipt] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine !== false : true
  );

  const pinMapContainerRef = useRef<HTMLDivElement | null>(null);
  const pinMapInstanceRef = useRef<L.Map | null>(null);
  const pinMarkerRef = useRef<L.CircleMarker | null>(null);

  const layerMapContainerRef = useRef<HTMLDivElement | null>(null);
  const layerMapInstanceRef = useRef<L.Map | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  const loadSafetyLayerAndConsent = useCallback(async () => {
    setIsLoadingLayer(true);
    try {
      const [layerRes, consentsRes] = await Promise.all([
        reportsApi
          .getSafetyLayer()
          .catch(() => ({ k_threshold: 5, cells: [] as SafetyLayerCellDto[] })),
        consentsApi
          .getConsents()
          .catch(() => ({ current: { location: false } as Record<string, boolean> })),
      ]);
      setKThreshold(layerRes.k_threshold ?? 5);
      setCells(layerRes.cells || []);
      setLocationConsentGranted(Boolean(consentsRes.current?.location));
    } finally {
      setIsLoadingLayer(false);
    }
  }, []);

  useEffect(() => {
    void loadSafetyLayerAndConsent();
  }, [loadSafetyLayerAndConsent]);

  const showInteractiveMaps = isOnline && !lowPowerDataSaverMode;

  // Initialize / update Leaflet Pin Picker map when online & not in data-saver mode
  useEffect(() => {
    if (!showInteractiveMaps || !pinMapContainerRef.current) {
      if (pinMapInstanceRef.current) {
        pinMapInstanceRef.current.remove();
        pinMapInstanceRef.current = null;
        pinMarkerRef.current = null;
      }
      return;
    }

    try {
      if (!pinMapInstanceRef.current) {
        const map = L.map(pinMapContainerRef.current, {
          center: [pinLat, pinLng],
          zoom: 15,
          attributionControl: true,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);

        const marker = L.circleMarker([pinLat, pinLng], {
          radius: 10,
          color: '#0f766e',
          fillColor: '#14b8a6',
          fillOpacity: 0.85,
        }).addTo(map);

        map.on('click', (ev: L.LeafletMouseEvent) => {
          const rLat = round3(ev.latlng.lat);
          const rLng = round3(ev.latlng.lng);
          setPinLat(rLat);
          setPinLng(rLng);
        });

        pinMapInstanceRef.current = map;
        pinMarkerRef.current = marker;
      } else {
        pinMarkerRef.current?.setLatLng([pinLat, pinLng]);
      }
    } catch {
      // Ignore Leaflet canvas/SVG init errors in headless JSDOM
    }
  }, [showInteractiveMaps, pinLat, pinLng]);

  // Initialize / update Aggregated Safety Layer map
  useEffect(() => {
    if (!showInteractiveMaps || !layerMapContainerRef.current) {
      if (layerMapInstanceRef.current) {
        layerMapInstanceRef.current.remove();
        layerMapInstanceRef.current = null;
        layerGroupRef.current = null;
      }
      return;
    }

    try {
      if (!layerMapInstanceRef.current) {
        const centerLat = cells[0]?.lat ?? 28.614;
        const centerLng = cells[0]?.lng ?? 77.209;
        const map = L.map(layerMapContainerRef.current, {
          center: [centerLat, centerLng],
          zoom: 14,
          attributionControl: true,
        });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
        }).addTo(map);
        const group = L.layerGroup().addTo(map);
        layerMapInstanceRef.current = map;
        layerGroupRef.current = group;
      }

      if (layerGroupRef.current) {
        layerGroupRef.current.clearLayers();
        for (const cell of cells) {
          L.circle([cell.lat, cell.lng], {
            radius: 65,
            color: '#9f1239',
            fillColor: '#e11d48',
            fillOpacity: 0.35,
          }).addTo(layerGroupRef.current);
        }
      }
    } catch {
      // Ignore Leaflet init errors in headless JSDOM
    }
  }, [showInteractiveMaps, cells]);

  useEffect(() => {
    return () => {
      if (pinMapInstanceRef.current) {
        pinMapInstanceRef.current.remove();
        pinMapInstanceRef.current = null;
      }
      if (layerMapInstanceRef.current) {
        layerMapInstanceRef.current.remove();
        layerMapInstanceRef.current = null;
      }
    };
  }, []);

  const handleUseCurrentLocation = () => {
    if (!locationConsentGranted) {
      return;
    }
    if (
      typeof navigator !== 'undefined' &&
      navigator.geolocation &&
      typeof navigator.geolocation.getCurrentPosition === 'function'
    ) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setPinLat(round3(pos.coords.latitude));
          setPinLng(round3(pos.coords.longitude));
        },
        () => {
          addToast('Could not read GPS location.', 'error');
        },
        { enableHighAccuracy: false, timeout: 5000 }
      );
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const trimmedNote = note.trim();
      const res = await reportsApi.createReport({
        category,
        lat: pinLat,
        lng: pinLng,
        note: trimmedNote ? trimmedNote.slice(0, 500) : null,
        anonymous,
      });
      setLastSubmittedReceipt({
        lat: res.report.lat,
        lng: res.report.lng,
      });
      setNote('');
      addToast(
        t('reports.submittedSuccess', {
          lat: res.report.lat.toFixed(3),
          lng: res.report.lng.toFixed(3),
        }),
        'success'
      );
      await loadSafetyLayerAndConsent();
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Could not submit safety report',
        'error'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <PageLayout>
      <div
        className="max-w-3xl mx-auto space-y-6 py-2"
        data-testid="safety-reports-page"
      >
        {/* Title */}
        <header className="space-y-1 pb-3 border-b border-line">
          <div className="flex items-center gap-2">
            <svg
              aria-hidden="true"
              className="w-6 h-6 stroke-ink fill-none stroke-2 shrink-0"
              strokeLinecap="square"
              strokeLinejoin="miter"
              viewBox="0 0 24 24"
            >
              <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" />
              <circle cx="12" cy="9" r="2.5" />
            </svg>
            <h1
              className="text-xl md:text-2xl font-bold text-ink tracking-tight"
              data-testid="safety-reports-title"
            >
              {t('reports.title')}
            </h1>
          </div>
          <p className="text-xs md:text-sm text-muted">
            {t('reports.subtitle')}
          </p>
        </header>

        {/* K-Anonymity Privacy Banner per Paper Utility */}
        <div
          role="note"
          data-testid="reports-k-anonymity-banner"
          className="p-4 bg-surface border border-line rounded-xl flex items-start gap-3"
        >
          <svg
            className="w-5 h-5 stroke-teal-700 fill-none stroke-2 shrink-0 mt-0.5"
            strokeLinecap="square"
            strokeLinejoin="miter"
            viewBox="0 0 24 24"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="16" y2="12" />
            <line x1="12" x2="12.01" y1="8" y2="8" />
          </svg>
          <p className="text-xs text-muted leading-relaxed">
            {t('reports.privacyBanner', { k: kThreshold })}
          </p>
        </div>

        {/* Quick Report Form */}
        <Card data-testid="report-submit-card" className="space-y-5 border border-line bg-surface">
          <h2 className="text-base font-bold text-ink border-b border-line pb-2">
            {t('reports.formSectionTitle')}
          </h2>

          <form onSubmit={handleSubmitReport} className="space-y-5">
            {/* Category Chips */}
            <div className="space-y-2">
              <label className="text-xs font-mono uppercase tracking-wider text-ink font-semibold block">
                {t('reports.categoryLabel')}
              </label>
              <div
                className="grid grid-cols-2 sm:grid-cols-3 gap-2"
                role="group"
                aria-label={t('reports.categoryLabel')}
              >
                {REPORT_CATEGORY_LIST.map((cat) => {
                  const selected = category === cat;
                  return (
                    <button
                      key={cat}
                      type="button"
                      data-testid={`report-category-chip-${cat}`}
                      aria-pressed={selected}
                      onClick={() => setCategory(cat)}
                      className={`h-11 px-3 border rounded-xl text-xs font-mono transition-none cursor-pointer select-none flex items-center justify-center text-center ${
                        selected
                          ? 'border-teal-700 bg-teal-700 text-surface font-bold'
                          : 'border-line bg-paper text-ink hover:bg-surface'
                      }`}
                    >
                      {t(`reports.categories.${cat}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Location Selection */}
            <div className="space-y-2 pt-2 border-t border-line">
              <label className="text-xs font-mono uppercase tracking-wider text-ink font-semibold block">
                {t('reports.locationSectionTitle')}
              </label>
              <p className="text-xs text-muted">
                {t('reports.dropPinHint')}
              </p>

              {showInteractiveMaps && (
                <div
                  ref={pinMapContainerRef}
                  data-testid="report-pin-leaflet-map"
                  className="w-full h-56 rounded-xl border border-line overflow-hidden bg-paper"
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="report-lat-input"
                    className="block text-xs font-mono text-muted mb-1"
                  >
                    Latitude
                  </label>
                  <input
                    id="report-lat-input"
                    data-testid="report-lat-input"
                    type="number"
                    step="0.001"
                    value={pinLat}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (Number.isFinite(val)) setPinLat(round3(val));
                    }}
                    className="w-full h-11 px-3 rounded-xl border border-line bg-paper text-ink font-mono text-xs tabular-nums focus:outline-none focus:border-teal-700"
                  />
                </div>
                <div>
                  <label
                    htmlFor="report-lng-input"
                    className="block text-xs font-mono text-muted mb-1"
                  >
                    Longitude
                  </label>
                  <input
                    id="report-lng-input"
                    data-testid="report-lng-input"
                    type="number"
                    step="0.001"
                    value={pinLng}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      if (Number.isFinite(val)) setPinLng(round3(val));
                    }}
                    className="w-full h-11 px-3 rounded-xl border border-line bg-paper text-ink font-mono text-xs tabular-nums focus:outline-none focus:border-teal-700"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <span
                  data-testid="report-rounded-coords-preview"
                  className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-teal-700"
                >
                  <svg className="w-3.5 h-3.5 stroke-current fill-none stroke-2" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                    <path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7z" />
                    <circle cx="12" cy="9" r="2.5" />
                  </svg>
                  {t('reports.selectedGridCoords', {
                    lat: round3(pinLat).toFixed(3),
                    lng: round3(pinLng).toFixed(3),
                  })}
                </span>

                {locationConsentGranted ? (
                  <Button
                    type="button"
                    variant="outline"
                    data-testid="report-use-current-location-btn"
                    onClick={handleUseCurrentLocation}
                    className="h-10 text-xs"
                  >
                    {t('reports.useCurrentLocationBtn')}
                  </Button>
                ) : (
                  <p
                    data-testid="report-location-consent-note"
                    className="text-xs font-mono text-muted"
                  >
                    {t('reports.locationConsentRequiredNote')}
                  </p>
                )}
              </div>
            </div>

            {/* Note */}
            <div className="space-y-1.5 pt-2 border-t border-line">
              <label
                htmlFor="report-note-input"
                className="text-xs font-mono uppercase tracking-wider text-ink font-semibold block"
              >
                {t('reports.noteLabel')}
              </label>
              <textarea
                id="report-note-input"
                data-testid="report-note-input"
                rows={3}
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value.slice(0, 500))}
                placeholder={t('reports.notePlaceholder')}
                className="w-full p-3 rounded-xl border border-line bg-paper text-ink text-xs focus:outline-none focus:border-teal-700"
              />
            </div>

            {/* Anonymous Toggle */}
            <div className="p-3 bg-paper border border-line rounded-xl space-y-1.5">
              <div className="flex items-center justify-between gap-4">
                <label
                  htmlFor="report-anonymous-toggle"
                  className="text-xs font-mono uppercase tracking-wider text-ink font-bold flex items-center gap-2 cursor-pointer select-none"
                >
                  {t('reports.anonymousToggleLabel')}
                </label>
                <input
                  id="report-anonymous-toggle"
                  data-testid="report-anonymous-toggle"
                  type="checkbox"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                  className="w-5 h-5 accent-teal-700 rounded-xl cursor-pointer"
                />
              </div>
              <p
                data-testid="report-anonymous-explanation"
                className="text-xs text-muted leading-relaxed"
              >
                {anonymous
                  ? t('reports.anonymousExplanationOn')
                  : t('reports.anonymousExplanationOff')}
              </p>
            </div>

            {lastSubmittedReceipt && (
              <div
                role="status"
                data-testid="report-submitted-banner"
                className="bg-paper border border-teal-700 p-3 text-xs font-mono text-teal-800 flex items-center gap-2 rounded-xl"
              >
                <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0"></span>
                <span>
                  {t('reports.submittedSuccess', {
                    lat: lastSubmittedReceipt.lat.toFixed(3),
                    lng: lastSubmittedReceipt.lng.toFixed(3),
                  })}
                </span>
              </div>
            )}

            <button
              type="submit"
              data-testid="report-submit-btn"
              disabled={isSubmitting}
              className="w-full min-h-[48px] px-4 py-3 bg-teal-700 active:bg-teal-800 text-surface font-mono font-bold text-xs uppercase tracking-wider rounded-xl flex items-center justify-center gap-2 cursor-pointer transition-colors disabled:opacity-50"
            >
              {isSubmitting
                ? t('reports.submittingBtn')
                : t('reports.submitBtn')}
            </button>
          </form>
        </Card>

        {/* Aggregated Safety Layer Section */}
        <Card data-testid="safety-layer-section" className="space-y-4 border border-line bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
            <h2
              className="text-base font-bold text-ink"
              data-testid="safety-layer-heading"
            >
              {t('reports.layerSectionTitle', { k: kThreshold })}
            </h2>
            <Button
              type="button"
              variant="outline"
              data-testid="safety-layer-refresh-btn"
              onClick={() => void loadSafetyLayerAndConsent()}
              className="h-9 text-xs"
            >
              {t('reports.layerRefreshBtn')}
            </Button>
          </div>

          {!showInteractiveMaps && (
            <p
              data-testid="safety-layer-datasaver-note"
              className="text-xs font-mono text-amber-900 bg-amber-50 border border-amber-300 rounded-xl p-2.5"
            >
              {t('reports.layerDataSaverNote')}
            </p>
          )}

          {showInteractiveMaps && (
            <div
              ref={layerMapContainerRef}
              data-testid="safety-layer-leaflet-map"
              className="w-full h-64 rounded-xl border border-line overflow-hidden bg-paper"
            />
          )}

          {isLoadingLayer ? (
            <div className="py-8 flex justify-center text-teal-700">
              <Spinner className="w-6 h-6" />
            </div>
          ) : cells.length === 0 ? (
            <p
              data-testid="safety-layer-empty"
              className="text-xs font-mono text-muted py-4 text-center"
            >
              {t('reports.layerEmpty', { k: kThreshold })}
            </p>
          ) : (
            <ul
              data-testid="safety-layer-cell-list"
              className="space-y-2"
            >
              {cells.map((cell) => {
                const summaryParts = Object.entries(cell.categories).map(
                  ([catKey, count]) =>
                    `${t(`reports.categories.${catKey}`, { defaultValue: catKey })}: ${count}`
                );
                return (
                  <li
                    key={cell.cell_id}
                    data-testid={`safety-layer-cell-${cell.cell_id}`}
                    className="border border-line bg-paper p-3 rounded-xl space-y-1 font-mono text-xs"
                  >
                    <p className="font-bold text-ink">
                      {t('reports.cellSummaryTitle', {
                        lat: cell.lat.toFixed(3),
                        lng: cell.lng.toFixed(3),
                        count: cell.total_count,
                      })}
                    </p>
                    <p className="text-muted">
                      {t('reports.cellCategoriesLabel', {
                        summary: summaryParts.join(', '),
                      })}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    </PageLayout>
  );
};
