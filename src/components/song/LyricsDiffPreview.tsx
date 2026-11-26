'use client';

import { useState } from 'react';
import type { LyricsDiff } from '@/lib/lyrics-diff';
import { useI18n } from '@/lib/i18n';

/**
 * Compact line-level diff shown in the re-sync confirmation dialog (issue
 * #493). The summary (added / removed / changed counts) is always visible;
 * the first few change rows are listed, with an expand control for the rest.
 * Line numbers index `lyrics_raw`, i.e. the same rows furigana / translation
 * use, so the user can judge exactly what a confirm will wipe.
 */
export default function LyricsDiffPreview({ diff }: { diff: LyricsDiff }) {
  const { t } = useI18n();
  const [expanded, setExpanded] = useState(false);
  const DEFAULT_ROWS = 4;
  const shown = expanded ? diff.rows : diff.rows.slice(0, DEFAULT_ROWS);

  return (
    <>
      <div className="preview-meta lyrics-diff-summary">
        {t('song.syncDiffSummary', {
          added: String(diff.added),
          removed: String(diff.removed),
          changed: String(diff.changed),
        })}
      </div>
      {diff.rows.length > 0 && (
        <div className="lyrics-diff-rows">
          {shown.map((row, idx) => {
            const label = row.type === 'added'
              ? `+${row.newLine}`
              : row.type === 'removed'
                ? `-${row.oldLine}`
                : `~${row.newLine}`;
            const text = row.type === 'removed' ? row.oldText : row.text;
            return (
              <div key={`${row.type}-${row.newLine}-${row.oldLine}-${idx}`} className={`lyrics-diff-row lyrics-diff-row--${row.type}`}>
                <span className="lyrics-diff-label">{label}</span>
                <span className="lyrics-diff-text">
                  {row.type === 'changed' ? `${row.oldText} → ${row.text}` : text}
                </span>
              </div>
            );
          })}
          {!expanded && diff.totalChanges > shown.length && (
            <div className="lyrics-diff-more">…</div>
          )}
        </div>
      )}
      {diff.totalChanges > DEFAULT_ROWS && (
        <button
          type="button"
          className="preview-toggle"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded
            ? t('song.syncCandidatePreviewCollapse')
            : t('song.syncDiffExpand', { count: String(diff.totalChanges) })}
        </button>
      )}
    </>
  );
}
