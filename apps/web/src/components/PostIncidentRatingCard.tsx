import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from './ui';
import { incidentsApi } from '../lib/api';

export interface PostIncidentRatingCardProps {
  incidentId: string;
  onComplete?: () => void;
}

export const PostIncidentRatingCard: React.FC<PostIncidentRatingCardProps> = ({
  incidentId,
  onComplete,
}) => {
  const { t } = useTranslation();
  const [selectedScore, setSelectedScore] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (skipped) {
    return null;
  }

  if (submitted) {
    return (
      <Card
        data-testid="post-incident-rating-thanks"
        className="p-4 text-center text-sm font-medium text-teal-800 dark:text-teal-300"
      >
        {t('postIncidentRating.thankYou')}
      </Card>
    );
  }

  const handleSubmit = async () => {
    if (!selectedScore) return;
    setIsSubmitting(true);
    setErrorMsg(null);
    try {
      await incidentsApi.submitRating(incidentId, selectedScore);
      setSubmitted(true);
      onComplete?.();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not save rating'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card
      data-testid="post-incident-rating-card"
      className="p-5 space-y-4 text-left border border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl shadow-sm"
    >
      <div className="space-y-1">
        <h2
          data-testid="post-incident-rating-prompt"
          className="text-base font-bold text-slate-900 dark:text-slate-100"
        >
          {t('postIncidentRating.prompt')}
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {t('postIncidentRating.subtitle')}
        </p>
      </div>

      <div
        role="group"
        aria-label={t('postIncidentRating.prompt')}
        className="grid grid-cols-5 gap-2"
      >
        {[1, 2, 3, 4, 5].map((score) => {
          const isSelected = selectedScore === score;
          return (
            <button
              key={score}
              type="button"
              data-testid={`post-incident-rating-score-${score}`}
              aria-pressed={isSelected}
              onClick={() => setSelectedScore(score)}
              className={`min-h-[48px] rounded-xl font-bold text-base tabular-nums border transition-colors ${
                isSelected
                  ? 'bg-teal-700 text-white border-teal-700 dark:bg-teal-600 dark:border-teal-600 shadow-sm'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
              }`}
            >
              {score}
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <p
          role="alert"
          data-testid="post-incident-rating-error"
          className="text-xs font-medium text-rose-700 dark:text-rose-400"
        >
          {errorMsg}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 pt-1">
        <button
          type="button"
          data-testid="post-incident-rating-skip-btn"
          onClick={() => {
            setSkipped(true);
            onComplete?.();
          }}
          className="min-h-[48px] px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 whitespace-nowrap"
        >
          {t('postIncidentRating.skipBtn')}
        </button>
        <button
          type="button"
          data-testid="post-incident-rating-submit-btn"
          disabled={!selectedScore || isSubmitting}
          onClick={() => void handleSubmit()}
          className="min-h-[48px] px-5 py-2 rounded-xl text-sm font-semibold bg-teal-700 text-white hover:bg-teal-800 dark:bg-teal-600 dark:hover:bg-teal-700 disabled:opacity-50 whitespace-nowrap shadow-sm"
        >
          {t('postIncidentRating.submitBtn')}
        </button>
      </div>
    </Card>
  );
};
