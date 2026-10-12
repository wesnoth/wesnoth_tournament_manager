import React from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  page: number;
  totalPages: number;
  total: number;
  showing: number;
  onPageChange: (page: number) => void;
}

/** Shared pagination controls for the public and authenticated profile history. */
const ProfileMatchesPagination: React.FC<Props> = ({ page, totalPages, total, showing, onPageChange }) => {
  const { t } = useTranslation();
  if (totalPages <= 1 && total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-gray-600">
      <span>{t('profile_pagination.showing', { showing, total })}</span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(1)} className="px-2 py-1 rounded bg-gray-200 disabled:opacity-40">{t('pagination_first')}</button>
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="px-2 py-1 rounded bg-gray-200 disabled:opacity-40">{t('pagination_prev')}</button>
        <span>{t('pagination_page_info', { page, totalPages: Math.max(totalPages, 1) })}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="px-2 py-1 rounded bg-gray-200 disabled:opacity-40">{t('pagination_next')}</button>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} className="px-2 py-1 rounded bg-gray-200 disabled:opacity-40">{t('pagination_last')}</button>
      </div>
    </div>
  );
};

export default ProfileMatchesPagination;
