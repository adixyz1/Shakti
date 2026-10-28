import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import {
  ExternalLink,
  Shield,
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Info,
} from 'lucide-react';
import { PageLayout } from '../components/PageLayout';
import { Card, Button, Spinner } from '../components/ui';
import { safetyToolsApi, type SafetyToolDto } from '../lib/api';
import { useTriggerSettingsStore } from '../store/triggerSettingsStore';
import { DisguiseCalculator } from '../components/DisguiseCalculator';

export const OFFLINE_DEFAULT_SAFETY_TOOLS: SafetyToolDto[] = [
  {
    id: 'tool_personal_alarm_keychain',
    category: 'personal_alarm_keychain',
    title: 'Devil Will Emergency Keychain Personal Protection Alarm',
    description:
      'A battery-powered sound device attached to keys or bags that emits a high-decibel (120-130 dB) siren when the pull pin or emergency button is triggered.',
    safe_use_notes:
      'Keep it easily accessible on the outside of your bag or keys. Test battery health periodically in a sound-muffled area. Do not pull the pin directly next to ears to avoid acoustic harm.',
    legal_note:
      'Audible personal alarms are legal in public spaces in India and internationally as non-weapon personal signaling tools.',
    link_url:
      'https://www.amazon.in/Devil-Will-Emergency-Keychain-Protection/dp/B0BPPZFZJD/ref=mp_s_a_1_9_sspa?dib=eyJ2IjoiMSJ9.AgkpYmaW4M8wZkglFdgjcWWd37kjFeKJ02ObUhz-YuoltfN0EyTfJF07Cn8fSf7_cwTctzZi7_XMdBBboPbjTEsZCWi6rFOkzKQq6MNTNV27QNxObNiEfiBY2Y0SvePDArz6UZvHv45lUYWaT9YCySsbm_JoircgmIB0VWsCdKkKH1VLy3sORph7QvJaxzSxMNbTEuAs5kUHj9LPM2WSSA.-XNM5KroO6JesL_hiNQ3MIr0d20HgKwG724Brso4ZeI&dib_tag=se&keywords=self+defence+tools+for+men&qid=1793179756&sr=8-9-spons&aref=G8bI5MTDeF&sp_csd=d2lkZ2V0TmFtZT1zcF9waG9uZV9zZWFyY2hfbXRm&psc=1&smid=A123OED1AUH9IH',
    link_label: 'Devil Will Emergency Keychain Personal Protection Alarm',
    last_checked: '2026-10-28',
    active: true,
    is_affiliate: false,
  },
  {
    id: 'tool_whistle',
    category: 'whistle',
    title: 'Safety Whistle',
    description:
      'A pealess high-frequency emergency whistle capable of producing sharp sound signals over long distances without moving parts or batteries.',
    safe_use_notes:
      'Blow with short, sharp, repeated bursts (such as the standard international distress signal of three blasts). Keep attached to a neck lanyard or bag zipper.',
    legal_note:
      'Emergency whistles are universally legal signaling and distress devices across all jurisdictions.',
    link_url: null,
    link_label: 'Add a trusted seller link',
    last_checked: '2026-10-28',
    active: true,
    is_affiliate: false,
  },
  {
    id: 'tool_torch_keyring',
    category: 'torch_keyring',
    title: 'Eveready DL102 Rechargeable Decibels Personal Safety Alarm & Torch',
    description:
      'A rechargeable high-lumen LED flashlight with built-in high-decibel personal safety siren that illuminates dark paths and signals for help.',
    safe_use_notes:
      'Recharge batteries regularly. Use the torch mode to scan poorly lit routes, stairwells, and doorways, and trigger the siren in emergencies.',
    legal_note:
      'Standard LED flashlights and audible personal alarms are universally legal tools without carrying restrictions.',
    link_url:
      'https://www.amazon.in/Eveready-DL102-Rechargeable-Decibels-Personal/dp/B0D89WZ6N3/ref=sxin_31_pa_sp_phone_search_thematic_sspa?content-id=amzn1.sym.526195bb-f554-43e3-9974-2b6aa831a7a8%3Aamzn1.sym.526195bb-f554-43e3-9974-2b6aa831a7a8&cv_ct_cx=self+defence+tools+for+men&keywords=self+defence+tools+for+men&pd_rd_i=B0D89WZ6N3&pd_rd_r=5bec543d-9d2b-4370-a579-24b96d3ffa56&pd_rd_w=U7EMx&pd_rd_wg=MXs6i&pf_rd_p=526195bb-f554-43e3-9974-2b6aa831a7a8&pf_rd_r=931VB4RH1XWBKPH299TC&qid=1793179756&sr=1-2-66673dcf-083f-43ba-b782-d4a436cc5cfb-spons&aref=Kua9dENCZs&sp_csd=d2lkZ2V0TmFtZT1zcF9waG9uZV9zZWFyY2hfdGhlbWF0aWM&psc=1',
    link_label: 'Eveready DL102 Rechargeable Decibels Personal Safety Alarm & Torch',
    last_checked: '2026-10-28',
    active: true,
    is_affiliate: false,
  },
  {
    id: 'tool_portable_door_alarm',
    category: 'portable_door_alarm',
    title: 'Portable Door Alarm',
    description:
      'A travel security device placed under or between a closed door and doorframe that sounds a loud siren upon detecting unauthorized door movement.',
    safe_use_notes:
      'Deploy on hotel, hostel, or temporary accommodation doors when resting. Test the sensor contact before sleeping.',
    legal_note:
      'Portable door alarms are legal security alert devices designed for private rooms and rental dwellings.',
    link_url: null,
    link_label: 'Add a trusted seller link',
    last_checked: '2026-10-28',
    active: true,
    is_affiliate: false,
  },
  {
    id: 'tool_pepper_spray',
    category: 'pepper_spray',
    title: 'Pepper Spray for Women Safety - Self Defense Spray (55ml each, Pack of 2)',
    description:
      'A handheld pressurized canister containing pepper stream spray designed to temporarily irritate eyes and respiratory tract to facilitate escape from immediate physical danger.',
    safe_use_notes:
      'Practice deploying the safety catch with your thumb, not index finger. Be aware of wind direction to avoid self-contamination. Spray in short bursts and immediately retreat to a crowded or secure area.',
    legal_note:
      'Under Indian law (including Arms Act provisions), pepper spray carried for bona fide self-defence is lawful. However, carriage may be restricted on commercial aircraft, metro transit systems, and sensitive high-security facilities.',
    link_url: 'https://dl.flipkart.com/s/gawwSQuuuN',
    link_label: 'Pepper Spray for Women Safety - Self Defense Spray (55ml each, Pack of 2)',
    last_checked: '2026-10-28',
    active: true,
    is_affiliate: false,
  },
  {
    id: 'tool_pepper_spray_impower_gel',
    category: 'pepper_spray',
    title: 'Impower Black Pepper Self-Defence Gel Spray (12 ft Range, Pocket Size)',
    description:
      'Pocket-size one-hand-use black pepper gel spray with a 12-foot range designed for targeted self-defence with reduced wind blowback.',
    safe_use_notes:
      'Hold firmly with thumb on the actuator. Aim toward the face and immediately move away to safety after spraying. Check expiry date periodically.',
    legal_note:
      'Under Indian law, pepper spray carried for bona fide self-defence is lawful, though restricted on flights, metro networks, and high-security premises.',
    link_url:
      'https://dl.flipkart.com/dl/impower-black-pepper-self-defence-spray-12-ft-range-pocket-size-one-hand-use-gel-spray/p/itm408d2cbcc02ae?pid=PSFEYDVAGWN4TNVG&lid=LSTPSFEYDVAGWN4TNVGLGEBTR&marketplace=FLIPKART&hl_lid=&store=hlc/iwt/mie&ctx=eyJkZWxpdmVyZWRCeSI6IiIsImRpc3BsYXlQcmljZSI6IjE5OSJ9&fm=eyJ3dHAiOiJwcm9kdWN0Q2FyZExpc3QiLCJwcnB0Ijoic3AiLCJtaWQiOiJBRFMifQ&_refId=&_appId=CL',
    link_label: 'Impower Black Pepper Self-Defence Gel Spray (12 ft Range)',
    last_checked: '2026-10-28',
    active: true,
    is_affiliate: false,
  },
  {
    id: 'tool_self_defence_expandable_baton',
    category: 'self_defence',
    title: 'Expandable Self-Defence Baton',
    description:
      'A collapsible telescopic baton designed to create distance and deter physical assault in emergency self-defence situations.',
    safe_use_notes:
      'Maintain a firm grip and only deploy when facing imminent physical threat where retreat is blocked. Prioritize creating space to escape to safety.',
    legal_note:
      'Carriage of expandable batons in public spaces, metro/rail transit, airports, and campuses may be restricted under the Indian Arms Act and local police regulations. Verify local rules before carrying.',
    link_url: 'https://safetygadgets.in/products/expandable-baton',
    link_label: 'Expandable Self-Defence Baton',
    last_checked: '2026-10-28',
    active: true,
    is_affiliate: false,
  },
  {
    id: 'tool_self_defence_foldable_stainless_knife',
    category: 'self_defence',
    title: 'Foldable Stainless Steel Knife',
    description:
      'Compact foldable stainless steel utility and self-defence pocket tool with a folding blade mechanism.',
    safe_use_notes:
      'Keep the blade securely folded when not in use. Handle with extreme care to prevent accidental self-injury.',
    legal_note:
      'Carrying knives in public places, public transport, metro stations, and flights is subject to strict blade-length limits and prohibitions under the Indian Arms Act and state laws. Check local regulations before purchasing or carrying.',
    link_url:
      'https://www.amazon.in/Foldable-Kitchen-Office-Stainless-Vegetable/dp/B0HJHG22QF/ref=mp_s_a_1_17?dib=eyJ2IjoiMSJ9.AgkpYmaW4M8wZkglFdgjcWWd37kjFeKJ02ObUhz-YuoltfN0EyTfJF07Cn8fSf7_cwTctzZi7_XMdBBboPbjTEsZCWi6rFOkzKQq6MNTNV27QNxObNiEfiBY2Y0SvePDArz6UZvHv45lUYWaT9YCySsbm_JoircgmIB0VWsCdKkKH1VLy3sORph7QvJaxzSxMNbTEuAs5kUHj9LPM2WSSA.-XNM5KroO6JesL_hiNQ3MIr0d20HgKwG724Brso4ZeI&dib_tag=se&keywords=self+defence+tools+for+men&qid=1793179756&sr=8-17',
    link_label: 'Foldable Stainless Steel Knife',
    last_checked: '2026-10-28',
    active: true,
    is_affiliate: false,
  },
  {
    id: 'tool_self_defence_pocket_folding_knife_wooden',
    category: 'self_defence',
    title: 'Pocket Folding Knife with Wooden Handle',
    description:
      'Folding pocket knife with a wooden handle designed for compact storage and emergency utility or self-defence.',
    safe_use_notes:
      'Ensure the locking mechanism is fully engaged before handling and keep safely closed when stored.',
    legal_note:
      'Carrying folding knives is restricted on flights, metro networks, campuses, and under local police notifications and the Indian Arms Act. Verify local laws before buying or carrying.',
    link_url:
      'https://www.amazon.in/Pocket-Folding-Knife-Wooden-Handle/dp/B0HJZJHTP6/ref=mp_s_a_1_12?dib=eyJ2IjoiMSJ9.AgkpYmaW4M8wZkglFdgjcWWd37kjFeKJ02ObUhz-YuoltfN0EyTfJF07Cn8fSf7_cwTctzZi7_XMdBBboPbjTEsZCWi6rFOkzKQq6MNTNV27QNxObNiEfiBY2Y0SvePDArz6UZvHv45lUYWaT9YCySsbm_JoircgmIB0VWsCdKkKH1VLy3sORph7QvJaxzSxMNbTEuAs5kUHj9LPM2WSSA.-XNM5KroO6JesL_hiNQ3MIr0d20HgKwG724Brso4ZeI&dib_tag=se&keywords=self+defence+tools+for+men&qid=1793179756&sr=8-12',
    link_label: 'Pocket Folding Knife with Wooden Handle',
    last_checked: '2026-10-28',
    active: true,
    is_affiliate: false,
  },
];

const SAFETY_TOOL_CATEGORIES = [
  'all',
  'personal_alarm_keychain',
  'whistle',
  'torch_keyring',
  'portable_door_alarm',
  'pepper_spray',
  'self_defence',
] as const;

export const SafetyToolsPage: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const {
    disguiseSequenceHash,
    disguiseEnabled,
    disguiseUnlockedSession,
    setDisguiseUnlockedSession,
  } = useTriggerSettingsStore();
  const isDisguised = Boolean(disguiseEnabled && !disguiseUnlockedSession);

  const [tools, setTools] = useState<SafetyToolDto[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isCachedOffline, setIsCachedOffline] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;

    async function loadTools() {
      setIsLoading(true);
      try {
        const res = await safetyToolsApi.listSafetyTools();
        if (isMounted && Array.isArray(res.safety_tools)) {
          setTools(res.safety_tools);
          setIsCachedOffline(false);
          try {
            localStorage.setItem(
              'saathi_cached_safety_tools',
              JSON.stringify(res.safety_tools)
            );
          } catch {
            // storage quota or private browsing
          }
        }
      } catch {
        // Offline fallback: load from cached localStorage or default list
        if (isMounted) {
          try {
            const cached = localStorage.getItem('saathi_cached_safety_tools');
            if (cached) {
              const parsed = JSON.parse(cached);
              if (Array.isArray(parsed) && parsed.length > 0) {
                setTools(parsed);
                setIsCachedOffline(true);
                return;
              }
            }
          } catch {
            // ignore
          }
          setTools(OFFLINE_DEFAULT_SAFETY_TOOLS);
          setIsCachedOffline(true);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadTools();

    return () => {
      isMounted = false;
    };
  }, []);

  if (isDisguised) {
    return (
      <DisguiseCalculator
        sequenceHash={disguiseSequenceHash}
        onUnlock={() => setDisguiseUnlockedSession(true)}
      />
    );
  }

  // Hide any category that has no active links
  const toolsWithActiveLinks = tools.filter(
    (tool) => Boolean(tool.active && tool.link_url && tool.link_url.trim() !== '')
  );

  const activeCategories = Array.from(
    new Set(toolsWithActiveLinks.map((t) => t.category.toLowerCase()))
  );

  const filteredTools = toolsWithActiveLinks.filter((tool) => {
    if (selectedCategory === 'all') return true;
    return tool.category.toLowerCase() === selectedCategory.toLowerCase();
  });

  return (
    <PageLayout>
      <div className="max-w-3xl mx-auto space-y-6 py-2" data-testid="safety-tools-page">
        {/* Back Link to Resources */}
        <div className="flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate('/resources')}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300"
            data-testid="back-to-resources-btn"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t('safetyTools.backToResources')}</span>
          </Button>

          {isCachedOffline && (
            <span
              data-testid="safety-tools-offline-badge"
              className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-200"
            >
              <Info className="w-3.5 h-3.5 text-slate-500" />
              {t('safetyTools.offlineCachedBadge')}
            </span>
          )}
        </div>

        {/* Header */}
        <div className="space-y-1.5 text-left">
          <h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-slate-50">
            {t('safetyTools.title')}
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {t('safetyTools.subtitle')}
          </p>
        </div>

        {/* Mandatory Top Disclosure Plain Text */}
        <Card
          data-testid="safety-tools-disclosure"
          className="p-4 border-2 border-slate-300 dark:border-slate-700 bg-slate-50/80 dark:bg-slate-900/60 rounded-xl space-y-2 text-left"
        >
          <div className="flex items-start gap-2.5">
            <Shield className="w-5 h-5 text-slate-700 dark:text-slate-300 shrink-0 mt-0.5" />
            <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 leading-relaxed font-medium">
              {t('safetyTools.disclosure')}
            </p>
          </div>
        </Card>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Spinner />
          </div>
        ) : toolsWithActiveLinks.length === 0 ? (
          /* When NO category has links: show one calm sentence and the disclosure text, nothing else */
          <p
            className="text-sm text-slate-600 dark:text-slate-400 text-left pt-1"
            data-testid="safety-tools-empty-sentence"
          >
            {t('safetyTools.emptyState')}
          </p>
        ) : (
          <>
            {/* Category Filter Chips for active categories only */}
            {activeCategories.length > 1 && (
              <div className="space-y-2 text-left">
                <label className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
                  {t('safetyTools.categoryFilterLabel')}
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    data-testid="safety-tool-cat-all"
                    onClick={() => setSelectedCategory('all')}
                    className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                      selectedCategory === 'all'
                        ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                    }`}
                  >
                    {t('safetyTools.categories.all')}
                  </button>
                  {activeCategories.map((cat) => {
                    const isActive = selectedCategory === cat;
                    return (
                      <button
                        key={cat}
                        type="button"
                        data-testid={`safety-tool-cat-${cat}`}
                        onClick={() => setSelectedCategory(cat)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-colors ${
                          isActive
                            ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700'
                        }`}
                      >
                        {t(`safetyTools.categories.${cat}`, { defaultValue: cat })}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Tools list */}
          <div className="space-y-4 text-left" data-testid="safety-tools-list">
            {filteredTools.map((tool) => (
              <Card
                key={tool.id}
                data-testid={`safety-tool-card-${tool.id}`}
                className="p-5 space-y-4 border border-slate-200 dark:border-slate-800 rounded-2xl"
              >
                {/* Title and Category Badge */}
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {tool.title}
                  </h2>
                  <span className="px-2.5 py-0.5 text-xs font-medium rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {t(`safetyTools.categories.${tool.category}`, {
                      defaultValue: tool.category,
                    })}
                  </span>
                </div>

                {/* Description */}
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {tool.description}
                </p>

                {/* Safe Use Notes */}
                <div className="p-3 bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50 rounded-xl space-y-1">
                  <h3 className="text-xs font-bold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                    <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                    <span>{t('safetyTools.safeUseLabel')}</span>
                  </h3>
                  <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    {tool.safe_use_notes}
                  </p>
                </div>

                {/* Legal Note */}
                <div className="p-3 bg-slate-100/70 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-xl space-y-1">
                  <h3 className="text-xs font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                    <Shield className="w-4 h-4 text-slate-600 dark:text-slate-400 shrink-0" />
                    <span>{t('safetyTools.legalNoteLabel')}</span>
                  </h3>
                  <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {tool.legal_note}
                  </p>
                </div>

                {/* Metadata and Link button (ONLY if link_url is set) */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-1 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5" />
                    <span>
                      {t('safetyTools.lastCheckedLabel')}: {tool.last_checked}
                    </span>
                  </div>

                  {tool.link_url && (
                    <div className="flex items-center gap-2">
                      {tool.is_affiliate && (
                        <span
                          data-testid={`safety-tool-affiliate-badge-${tool.id}`}
                          className="text-[11px] font-medium text-amber-700 dark:text-amber-400 bg-amber-100/70 dark:bg-amber-950/40 px-2 py-0.5 rounded-md"
                        >
                          {t('safetyTools.affiliateNotice')}
                        </span>
                      )}
                      <a
                        href={tool.link_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`safety-tool-link-${tool.id}`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-xs rounded-xl bg-slate-900 hover:bg-slate-800 text-white dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 transition-colors"
                      >
                        <span>{tool.link_label || t('safetyTools.openSellerLink')}</span>
                        <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                      </a>
                    </div>
                  )}
                </div>
              </Card>
            ))}
          </div>
          </>
        )}
      </div>
    </PageLayout>
  );
};
