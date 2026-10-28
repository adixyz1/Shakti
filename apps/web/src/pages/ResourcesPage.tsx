import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { PageLayout } from '../components/PageLayout';
import { Card, Spinner, Button } from '../components/ui';
import { resourcesPulseApi, type ResourceDto } from '../lib/api';

const RESOURCE_CATEGORIES = [
  'all',
  'emergency',
  'women_helpline',
  'one_stop_centre',
  'campus_security',
  'legal_aid',
  'counseling',
] as const;

export const OFFLINE_LOCAL_RESOURCES: ResourceDto[] = [
  {
    id: 'res_offline_181',
    name: '181 Women Helpline',
    category: 'women_helpline',
    phone: '181',
    description:
      'Toll-free 24-hour telecom helpline for women seeking support, crisis intervention, and referral.',
    available_hours: '24x7',
    active: true,
  },
  {
    id: 'res_offline_112',
    name: '112 Emergency Response Support System (ERSS)',
    category: 'emergency',
    phone: '112',
    description:
      'National pan-India emergency response number for police, fire, and medical assistance.',
    available_hours: '24x7',
    active: true,
  },
];

export function sortResourcesForSupport(items: ResourceDto[]): ResourceDto[] {
  const getRank = (item: ResourceDto): number => {
    const cat = (item.category || '').toLowerCase();
    const phone = (item.phone || '').trim();
    const name = (item.name || '').toLowerCase();
    const id = (item.id || '').toLowerCase();

    // 1. counseling
    if (cat === 'counseling' || name.includes('counsel') || id.includes('counsel')) {
      return 1;
    }
    // 2. legal-aid
    if (cat === 'legal_aid' || cat === 'legal' || name.includes('legal') || id.includes('legal')) {
      return 2;
    }
    // 3. One Stop Centre
    if (
      cat === 'one_stop_centre' ||
      cat === 'one_stop' ||
      name.includes('one stop') ||
      name.includes('sakhi') ||
      id.includes('osc') ||
      id.includes('one_stop')
    ) {
      return 3;
    }
    // 4. 181 / Women Helpline
    if (
      phone === '181' ||
      cat === 'women_helpline' ||
      name.includes('181') ||
      id.includes('181')
    ) {
      return 4;
    }
    return 10;
  };

  return [...items].sort((a, b) => getRank(a) - getRank(b));
}

export const ResourcesPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const [query, setQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [resources, setResources] = useState<ResourceDto[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadResources = useCallback(
    async (qVal: string, catVal: string) => {
      setIsLoading(true);
      try {
        const res = await resourcesPulseApi.listResources({
          q: qVal.trim() || undefined,
          category: catVal === 'all' ? undefined : catVal,
        });
        const items = res.resources || [];
        setResources(sortResourcesForSupport(items));
      } catch {
        // If resources are not available offline, show 181 and 112 call links from local constants
        const qNorm = qVal.trim().toLowerCase();
        const fallback = OFFLINE_LOCAL_RESOURCES.filter((r) => {
          if (catVal !== 'all' && r.category !== catVal) {
            return false;
          }
          if (
            qNorm &&
            !`${r.name} ${r.phone} ${r.description}`.toLowerCase().includes(qNorm)
          ) {
            return false;
          }
          return true;
        });
        setResources(fallback.length > 0 ? fallback : OFFLINE_LOCAL_RESOURCES);
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    void loadResources(query, selectedCategory);
  }, [loadResources, query, selectedCategory]);

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto space-y-6 py-2" data-testid="resources-page">
        {/* Page Header */}
        <header className="flex items-center justify-between pb-2 border-b border-line">
          <div className="flex items-center gap-2">
            <svg
              className="w-6 h-6 stroke-ink fill-none stroke-2 shrink-0"
              strokeLinecap="square"
              strokeLinejoin="miter"
              viewBox="0 0 24 24"
            >
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
            </svg>
            <h1 className="text-xl md:text-2xl font-bold text-ink tracking-tight">
              {t('resources.title')}
            </h1>
          </div>
          <div aria-label="Status: 24x7 Direct Lines" className="px-2 py-0.5 bg-surface border border-line rounded-xl">
            <span className="text-[11px] font-mono text-ink uppercase tracking-wider font-semibold">
              24x7 DIRECT LINES
            </span>
          </div>
        </header>

        {/* Verification Notice per Stitch helplines */}
        <section aria-label="Verification Notice" className="bg-surface p-4 border border-line rounded-xl">
          <div className="flex items-start gap-3">
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
              All lines are directly dialed over your cellular voice network. Verification tests are conducted every Monday at 06:00 IST.
            </p>
          </div>
        </section>

        {/* Link to Safety Tools Guide */}
        <section aria-label="Safety Tools Guide Navigation" className="bg-surface p-4 border border-line rounded-xl flex items-center justify-between gap-3 text-left">
          <div className="space-y-0.5">
            <h2 className="text-sm font-bold text-ink">
              {t('safetyTools.title')}
            </h2>
            <p className="text-xs text-muted">
              {t('safetyTools.subtitle')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            data-testid="nav-safety-tools-guide-btn"
            onClick={() => navigate('/safety-tools')}
            className="shrink-0 text-xs font-semibold"
          >
            {t('safetyTools.navLink')}
          </Button>
        </section>

        {/* Search & Category Filter Controls */}
        <Card className="p-4 space-y-4 border border-line bg-surface">
          <div className="space-y-1.5">
            <label
              htmlFor="resources-search-input"
              className="text-xs font-mono uppercase tracking-wider text-ink font-semibold block"
            >
              {t('resources.searchLabel')}
            </label>
            <div className="relative">
              <svg
                className="w-4 h-4 stroke-muted fill-none stroke-2 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                strokeLinecap="square"
                strokeLinejoin="miter"
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="8" />
                <line x1="21" x2="16.65" y1="21" y2="16.65" />
              </svg>
              <input
                id="resources-search-input"
                type="search"
                data-testid="resources-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('resources.searchPlaceholder')}
                className="w-full h-11 pl-10 pr-4 rounded-xl border border-line bg-paper text-xs text-ink placeholder:text-muted focus:outline-none focus:border-teal-700"
              />
            </div>
          </div>

          <div className="space-y-1.5 border-t border-line pt-3">
            <p className="text-xs font-mono uppercase tracking-wider text-muted font-medium">
              {t('resources.categoryFilterLabel')}
            </p>
            <div className="flex flex-wrap gap-1.5">
              {RESOURCE_CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    data-testid={`resources-cat-chip-${cat}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedCategory(cat)}
                    className={`h-9 px-3 rounded-xl text-xs font-mono border transition-none cursor-pointer ${
                      isSelected
                        ? 'bg-teal-700 text-surface border-teal-700 font-bold'
                        : 'bg-paper text-ink border-line hover:bg-surface'
                    }`}
                  >
                    {t(`resources.categories.${cat}`, { defaultValue: cat })}
                  </button>
                );
              })}
            </div>
          </div>
        </Card>

        {/* Directory List */}
        {isLoading ? (
          <div className="py-12 flex justify-center text-teal-700">
            <Spinner className="w-8 h-8" />
          </div>
        ) : resources.length === 0 ? (
          <Card className="p-6 text-center text-xs font-mono text-muted border border-line bg-surface">
            <p data-testid="resources-empty-state">
              {t('resources.emptyState')}
            </p>
          </Card>
        ) : (
          <div className="space-y-3" data-testid="resources-list">
            {resources.map((item) => {
              const isPlaceholder = item.phone
                .toLowerCase()
                .includes('add your local number');
              return (
                <article
                  key={item.id}
                  data-testid={`resource-card-${item.id}`}
                  className="p-4 bg-surface border border-line rounded-xl flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-ink">
                        {item.name}
                      </h2>
                      <span className="text-[11px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-xl bg-surface-container border border-line text-ink font-semibold">
                        {t(`resources.categories.${item.category}`, {
                          defaultValue: item.category,
                        })}
                      </span>
                    </div>
                    <p className="text-xs md:text-sm text-ink leading-relaxed">
                      {item.description}
                    </p>
                    <div className="flex items-center gap-2 text-xs font-mono text-muted pt-0.5">
                      <span className="w-2 h-2 bg-teal-700 rounded-full shrink-0" />
                      <span>
                        {t('resources.hoursLabel', {
                          hours: item.available_hours,
                        })}
                      </span>
                    </div>
                    {isPlaceholder && (
                      <p
                        data-testid={`resource-placeholder-note-${item.id}`}
                        className="text-xs font-mono text-amber-900 bg-amber-50 border border-amber-300 p-2 rounded-xl"
                      >
                        {t('resources.placeholderPhoneBadge')} ({item.phone})
                      </p>
                    )}
                  </div>

                  {/* One-tap tel: button */}
                  <div className="shrink-0">
                    <a
                      href={`tel:${item.phone}`}
                      data-testid={`resource-tel-link-${item.id}`}
                      className="min-h-[56px] px-5 py-2.5 rounded-xl font-mono font-bold text-xs uppercase tracking-wider bg-teal-700 hover:bg-teal-800 active:bg-teal-800 text-surface inline-flex items-center justify-center gap-2 transition-colors w-full md:w-auto"
                    >
                      <svg className="w-4 h-4 stroke-current fill-none stroke-2 shrink-0" strokeLinecap="square" strokeLinejoin="miter" viewBox="0 0 24 24">
                        <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                      </svg>
                      <span>{t('resources.callBtn', { phone: item.phone })}</span>
                    </a>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
};
