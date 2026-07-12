import React from 'react';

interface Props {
  page: number;
  totalPages: number;
  total: number;
  showing: number;
  onPageChange: (page: number) => void;
}

/** Shared pagination controls for the public and authenticated profile history. */
const ProfileMatchesPagination: React.FC<Props> = ({ page, totalPages, total, showing, onPageChange }) => {
  if (totalPages <= 1 && total === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4 text-sm text-gray-600">
      <span>{showing} of {total} matches</span>
      <div className="flex items-center gap-2">
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(1)} className="px-2 py-1 rounded bg-gray-200 disabled:opacity-40">First</button>
        <button type="button" disabled={page <= 1} onClick={() => onPageChange(page - 1)} className="px-2 py-1 rounded bg-gray-200 disabled:opacity-40">Previous</button>
        <span>Page {page} of {Math.max(totalPages, 1)}</span>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} className="px-2 py-1 rounded bg-gray-200 disabled:opacity-40">Next</button>
        <button type="button" disabled={page >= totalPages} onClick={() => onPageChange(totalPages)} className="px-2 py-1 rounded bg-gray-200 disabled:opacity-40">Last</button>
      </div>
    </div>
  );
};

export default ProfileMatchesPagination;
