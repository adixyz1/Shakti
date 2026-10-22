import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, PhoneCall, Search, ShieldCheck } from 'lucide-react';
import { PageLayout } from '../components/PageLayout';
import { Card, Spinner } from '../components/ui';
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
      <div className="max-w-3xl mx-auto space-y-6" data-testid="resources-page">
        <header className="space-y-1">
          <div className="flex items-center gap-2 text-teal-800 dark:text-teal-400">
            <ShieldCheck className="w-6 h-6" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight">
              {t('resources.title')}
            </h1>
          </div>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('resources.subtitle')}
          </p>
        </header>

        {/* Search & Category Filter Controls */}
        <Card className="p-5 space-y-4">
          <div className="space-y-1.5">
            <label
              htmlFor="resources-search-input"
              className="block text-sm font-semibold text-slate-800 dark:text-slate-200"
            >
              {t('resources.searchLabel')}
            </label>
            <div className="relative">
              <Search
                className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                id="resources-search-input"
                type="search"
                data-testid="resources-search-input"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('resources.searchPlaceholder')}
                className="w-full min-h-[56px] pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              {t('resources.categoryFilterLabel')}
            </p>
            <div className="flex flex-wrap gap-2">
              {RESOURCE_CATEGORIES.map((cat) => {
                const isSelected = selectedCategory === cat;
                return (
                  <button
                    key={cat}
                    type="button"
                    data-testid={`resources-cat-chip-${cat}`}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedCategory(cat)}
                    className={`min-h-[44px] px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                      isSelected
                        ? 'bg-teal-800 text-white border-teal-800 dark:bg-teal-600 dark:border-teal-600'
                        : 'bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800'
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
          <div className="py-12 flex justify-center">
            <Spinner className="w-8 h-8 text-teal-700 dark:text-teal-400" />
          </div>
        ) : resources.length === 0 ? (
          <Card className="p-6 text-center text-sm text-slate-600 dark:text-slate-400">
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
                <Card
                  key={item.id}
                  data-testid={`resource-card-${item.id}`}
                  className="p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
                >
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                        {item.name}
                      </h2>
                      <span className="text-xs font-semibold px-2.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                        {t(`resources.categories.${item.category}`, {
                          defaultValue: item.category,
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-slate-700 dark:text-slate-300">
                      {item.description}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                      {t('resources.hoursLabel', {
                        hours: item.available_hours,
                      })}
                    </p>
                    {isPlaceholder && (
                      <p
                        data-testid={`resource-placeholder-note-${item.id}`}
                        className="text-xs font-medium text-amber-800 dark:text-amber-300"
                      >
                        {t('resources.placeholderPhoneBadge')} ({item.phone})
                      </p>
                    )}
                  </div>

                  {/* One-tap tel: button (56px minimum touch target) */}
                  <div className="shrink-0">
                    <a
                      href={`tel:${item.phone}`}
                      data-testid={`resource-tel-link-${item.id}`}
                      className="min-h-[56px] min-w-[56px] w-full sm:w-auto px-5 py-3 rounded-2xl font-bold text-sm bg-teal-800 hover:bg-teal-900 text-white dark:bg-teal-600 dark:hover:bg-teal-500 inline-flex items-center justify-center gap-2 shadow-sm focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-500/50"
                    >
                      <PhoneCall className="w-4 h-4" aria-hidden="true" />
                      {t('resources.callBtn', { phone: item.phone })}
                    </a>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </PageLayout>
  );
};
