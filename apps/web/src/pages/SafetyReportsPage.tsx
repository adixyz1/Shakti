import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  CheckCircle2,
  EyeOff,
  LocateFixed,
  MapPin,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
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
            color: '#b45309',
            fillColor: '#f59e0b',
            fillOpacity: 0.45,
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
        className="max-w-3xl mx-auto space-y-8"
        data-testid="safety-reports-page"
      >
        {/* Header */}
        <header className="space-y-2">
          <h1
            className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white"
            data-testid="safety-reports-title"
          >
            {t('reports.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {t('reports.subtitle')}
          </p>
        </header>

        {/* K-Anonymity Privacy Banner */}
        <div
          role="note"
          data-testid="reports-k-anonymity-banner"
          className="rounded-2xl border-2 border-teal-700/30 bg-teal-50/90 dark:bg-teal-950/40 dark:border-teal-500/40 p-4 flex items-start gap-3 text-teal-950 dark:text-teal-100"
        >
          <ShieldCheck
            className="w-5 h-5 text-teal-700 dark:text-teal-400 shrink-0 mt-0.5"
            aria-hidden="true"
          />
          <p className="text-sm font-semibold leading-relaxed">
            {t('reports.privacyBanner', { k: kThreshold })}
          </p>
        </div>

        {/* Quick Report Form */}
        <Card data-testid="report-submit-card" className="space-y-6">
          <h2 className="text-lg font-extrabold text-slate-900 dark:text-white">
            {t('reports.formSectionTitle')}
          </h2>

          <form onSubmit={handleSubmitReport} className="space-y-6">
            {/* 1. Category Chips (56px targets) */}
            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                {t('reports.categoryLabel')}
              </label>
              <div
                className="grid grid-cols-2 sm:grid-cols-3 gap-3"
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
                      className={`min-h-[56px] px-4 py-3 rounded-xl font-bold text-sm border-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 ${
                        selected
                          ? 'border-teal-700 bg-teal-700 text-white dark:border-teal-500 dark:bg-teal-600'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-slate-800 dark:text-slate-200 hover:border-teal-600'
                      }`}
                    >
                      {t(`reports.categories.${cat}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 2. Location Selection (Drop Pin on Leaflet Map or Use Current Location ONLY after consent) */}
            <div className="space-y-3">
              <label className="block text-sm font-bold text-slate-900 dark:text-slate-100">
                {t('reports.locationSectionTitle')}
              </label>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {t('reports.dropPinHint')}
              </p>

              {showInteractiveMaps && (
                <div
                  ref={pinMapContainerRef}
                  data-testid="report-pin-leaflet-map"
                  className="w-full h-56 rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800"
                />
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="report-lat-input"
                    className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
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
                    className="w-full min-h-[56px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono text-sm"
                  />
                </div>
                <div>
                  <label
                    htmlFor="report-lng-input"
                    className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1"
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
                    className="w-full min-h-[56px] px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <span
                  data-testid="report-rounded-coords-preview"
                  className="inline-flex items-center gap-1.5 text-xs font-mono font-bold text-teal-800 dark:text-teal-300"
                >
                  <MapPin className="w-4 h-4" aria-hidden="true" />
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
                    className="min-h-[56px]"
                  >
                    <LocateFixed className="w-4 h-4 mr-2" aria-hidden="true" />
                    {t('reports.useCurrentLocationBtn')}
                  </Button>
                ) : (
                  <p
                    data-testid="report-location-consent-note"
                    className="text-xs text-slate-500 dark:text-slate-400"
                  >
                    {t('reports.locationConsentRequiredNote')}
                  </p>
                )}
              </div>
            </div>

            {/* 3. Optional Note (max 500 chars) */}
            <div className="space-y-2">
              <label
                htmlFor="report-note-input"
                className="block text-sm font-bold text-slate-900 dark:text-slate-100"
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
                className="w-full px-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-teal-600"
              />
            </div>

            {/* 4. Anonymous Toggle with Plain Explanation */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 p-4 space-y-2">
              <div className="flex items-center justify-between gap-4">
                <label
                  htmlFor="report-anonymous-toggle"
                  className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2 cursor-pointer"
                >
                  <EyeOff className="w-4 h-4 text-teal-700 dark:text-teal-400" />
                  {t('reports.anonymousToggleLabel')}
                </label>
                <input
                  id="report-anonymous-toggle"
                  data-testid="report-anonymous-toggle"
                  type="checkbox"
                  checked={anonymous}
                  onChange={(e) => setAnonymous(e.target.checked)}
                  className="w-6 h-6 accent-teal-700 rounded cursor-pointer"
                />
              </div>
              <p
                data-testid="report-anonymous-explanation"
                className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed"
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
                className="rounded-xl bg-teal-50 dark:bg-teal-950/60 border border-teal-600/40 p-3.5 text-xs font-semibold text-teal-900 dark:text-teal-200 flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
                {t('reports.submittedSuccess', {
                  lat: lastSubmittedReceipt.lat.toFixed(3),
                  lng: lastSubmittedReceipt.lng.toFixed(3),
                })}
              </div>
            )}

            <Button
              type="submit"
              variant="primary"
              fullWidth
              data-testid="report-submit-btn"
              disabled={isSubmitting}
              className="min-h-[56px] text-base font-bold"
            >
              {isSubmitting
                ? t('reports.submittingBtn')
                : t('reports.submitBtn')}
            </Button>
          </form>
        </Card>

        {/* Aggregated Safety Layer Section (Never shows individual reports) */}
        <Card data-testid="safety-layer-section" className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2
              className="text-lg font-extrabold text-slate-900 dark:text-white"
              data-testid="safety-layer-heading"
            >
              {t('reports.layerSectionTitle', { k: kThreshold })}
            </h2>
            <Button
              type="button"
              variant="outline"
              data-testid="safety-layer-refresh-btn"
              onClick={() => void loadSafetyLayerAndConsent()}
              className="min-h-[44px]"
            >
              <RefreshCw className="w-4 h-4 mr-1.5" aria-hidden="true" />
              {t('reports.layerRefreshBtn')}
            </Button>
          </div>

          {!showInteractiveMaps && (
            <p
              data-testid="safety-layer-datasaver-note"
              className="text-xs font-semibold text-amber-900 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-800 rounded-xl px-3.5 py-2.5"
            >
              {t('reports.layerDataSaverNote')}
            </p>
          )}

          {showInteractiveMaps && (
            <div
              ref={layerMapContainerRef}
              data-testid="safety-layer-leaflet-map"
              className="w-full h-64 rounded-xl border border-slate-300 dark:border-slate-700 overflow-hidden bg-slate-100 dark:bg-slate-800"
            />
          )}

          {isLoadingLayer ? (
            <div className="py-8 flex justify-center">
              <Spinner className="w-6 h-6" />
            </div>
          ) : cells.length === 0 ? (
            <p
              data-testid="safety-layer-empty"
              className="text-sm text-slate-600 dark:text-slate-400 py-4 text-center"
            >
              {t('reports.layerEmpty', { k: kThreshold })}
            </p>
          ) : (
            <ul
              data-testid="safety-layer-cell-list"
              className="space-y-3"
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
                    className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/50 p-4 space-y-1"
                  >
                    <p className="font-bold text-sm text-slate-900 dark:text-white">
                      {t('reports.cellSummaryTitle', {
                        lat: cell.lat.toFixed(3),
                        lng: cell.lng.toFixed(3),
                        count: cell.total_count,
                      })}
                    </p>
                    <p className="text-xs text-slate-600 dark:text-slate-300">
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
