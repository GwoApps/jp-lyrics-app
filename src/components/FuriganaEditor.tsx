'use client';

import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { FuriganaLine, FuriganaSegment } from '@/lib/types';
import { useI18n } from '@/lib/i18n';

interface FuriganaEditorProps {
  lines: FuriganaLine[];
  rawLines?: string[];
  onChange: (lines: FuriganaLine[]) => void;
}

type EditTarget = { lineIndex: number; segIndex: number } | null;

const NON_EDITABLE_SEGMENT_RE = /^[\s\p{P}\p{S}\p{N}\p{Script=Latin}]+$/u;
const isNonEditableDisplaySegment = (text: string) => NON_EDITABLE_SEGMENT_RE.test(text);

type EditorDisplayPart =
  | { kind: 'plain'; key: number; text: string }
  | { kind: 'editable'; key: number; segment: FuriganaSegment; segmentIndex: number };

function groupEditorDisplaySegments(segments: FuriganaSegment[]): EditorDisplayPart[] {
  const parts: EditorDisplayPart[] = [];

  segments.forEach((segment, segmentIndex) => {
    if (isNonEditableDisplaySegment(segment.text)) {
      const previous = parts[parts.length - 1];
      if (previous?.kind === 'plain') {
        previous.text += segment.text;
      } else {
        parts.push({ kind: 'plain', key: segmentIndex, text: segment.text });
      }
      return;
    }

    parts.push({ kind: 'editable', key: segmentIndex, segment, segmentIndex });
  });

  return parts;
}

export default function FuriganaEditor({ lines, rawLines, onChange }: FuriganaEditorProps) {
  const { t } = useI18n();
  const [active, setActive] = useState<EditTarget>(null);
  const [draft, setDraft] = useState('');
  const [readingCandidates, setReadingCandidates] = useState<string[]>([]);
  const [readingCandidatesLoading, setReadingCandidatesLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [active]);

  const activeSeg = useMemo<FuriganaSegment | null>(() => {
    if (!active) return null;
    return lines[active.lineIndex]?.segments[active.segIndex] ?? null;
  }, [active, lines]);

  const activeText = activeSeg?.text ?? '';
  const hasActiveKanji = /[\u3400-\u4DBF\u4E00-\u9FFF]/.test(activeText);

  useEffect(() => {
    if (!hasActiveKanji) return;

    const controller = new AbortController();

    void fetch(`/api/furigana/readings?text=${encodeURIComponent(activeText)}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) return [];
        const payload = await response.json() as { candidates?: unknown };
        return Array.isArray(payload.candidates)
          ? payload.candidates.filter((candidate): candidate is string => typeof candidate === 'string')
          : [];
      })
      .then((candidates) => {
        if (!controller.signal.aborted) setReadingCandidates(candidates);
      })
      .catch(() => {
        if (!controller.signal.aborted) setReadingCandidates([]);
      })
      .finally(() => {
        if (!controller.signal.aborted) setReadingCandidatesLoading(false);
      });

    return () => controller.abort();
  }, [activeText, hasActiveKanji]);

  const selectableReadings = useMemo(() => {
    if (!activeSeg || !hasActiveKanji) return [];
    return [...new Set([activeSeg.reading, ...readingCandidates].filter(Boolean))];
  }, [activeSeg, hasActiveKanji, readingCandidates]);

  const updateSegment = useCallback((lineIndex: number, segIndex: number, nextSeg: FuriganaSegment) => {
    const next = lines.map((line, li) =>
      li === lineIndex
        ? { ...line, segments: line.segments.map((seg, si) => (si === segIndex ? nextSeg : seg)) }
        : line
    );
    onChange(next);
  }, [lines, onChange]);

  const updateLineSegments = useCallback((lineIndex: number, segments: FuriganaSegment[]) => {
    const next = lines.map((line, li) => (li === lineIndex ? { ...line, segments } : line));
    onChange(next);
  }, [lines, onChange]);

  const startEdit = (li: number, si: number) => {
    const segment = lines[li].segments[si];
    setActive({ lineIndex: li, segIndex: si });
    setDraft(segment.reading);
    setReadingCandidates([]);
    setReadingCandidatesLoading(/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(segment.text));
  };

  const commitReading = useCallback(() => {
    if (!active) return;
    const reading = draft.trim();
    updateSegment(active.lineIndex, active.segIndex, { ...lines[active.lineIndex].segments[active.segIndex], reading });
    setActive(null);
  }, [active, draft, lines, updateSegment]);

  const selectReading = useCallback((reading: string) => {
    if (!active) return;
    updateSegment(active.lineIndex, active.segIndex, {
      ...lines[active.lineIndex].segments[active.segIndex],
      reading,
    });
    setActive(null);
  }, [active, lines, updateSegment]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitReading();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setActive(null);
    }
  };

  const removeReading = useCallback(() => {
    if (!active) return;
    updateSegment(active.lineIndex, active.segIndex, { ...lines[active.lineIndex].segments[active.segIndex], reading: '' });
    setActive(null);
  }, [active, lines, updateSegment]);

  const splitSegment = useCallback(() => {
    if (!active) return;
    const seg = lines[active.lineIndex].segments[active.segIndex];
    if (seg.text.length <= 1) return;
    const chars = seg.text.split('').map((ch) => ({ text: ch, reading: '' }));
    const line = lines[active.lineIndex];
    const nextSegments = [
      ...line.segments.slice(0, active.segIndex),
      ...chars,
      ...line.segments.slice(active.segIndex + 1),
    ];
    updateLineSegments(active.lineIndex, nextSegments);
    setActive({ lineIndex: active.lineIndex, segIndex: active.segIndex });
    setDraft('');
    setReadingCandidates([]);
    setReadingCandidatesLoading(/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(chars[0].text));
  }, [active, lines, updateLineSegments]);

  const mergeNext = useCallback(() => {
    if (!active) return;
    const line = lines[active.lineIndex];
    if (active.segIndex >= line.segments.length - 1) return;
    const current = line.segments[active.segIndex];
    const next = line.segments[active.segIndex + 1];
    if (isNonEditableDisplaySegment(next.text)) return;
    const merged: FuriganaSegment = {
      text: current.text + next.text,
      reading: current.reading && next.reading
        ? current.reading + next.reading
        : current.reading || next.reading,
    };
    const nextSegments = [
      ...line.segments.slice(0, active.segIndex),
      merged,
      ...line.segments.slice(active.segIndex + 2),
    ];
    updateLineSegments(active.lineIndex, nextSegments);
    setActive({ lineIndex: active.lineIndex, segIndex: active.segIndex });
    setDraft(merged.reading);
    setReadingCandidates([]);
    setReadingCandidatesLoading(/[\u3400-\u4DBF\u4E00-\u9FFF]/.test(merged.text));
  }, [active, lines, updateLineSegments]);

  const applyAll = useCallback(() => {
    if (!activeSeg || !active) return;
    const targetText = activeSeg.text;
    const reading = draft.trim();
    const next = lines.map((line) => ({
      ...line,
      segments: line.segments.map((seg) =>
        seg.text === targetText && seg.reading !== reading ? { ...seg, reading } : seg
      ),
    }));
    onChange(next);
    setActive(null);
  }, [active, activeSeg, draft, lines, onChange]);

  const sameWordCount = useMemo(() => {
    if (!activeSeg || !active) return 0;
    const reading = draft.trim();
    return lines.reduce(
      (sum, line, li) =>
        sum +
        line.segments.filter(
          (seg, si) => seg.text === activeSeg.text && seg.reading !== reading && (li !== active.lineIndex || si !== active.segIndex)
        ).length,
      0
    );
  }, [active, activeSeg, draft, lines]);

  const hasAnyReading = lines.some((line) => line.segments.some((seg) => seg.reading));

  return (
    <div className="space-y-4">
      {!hasAnyReading && (
        <p className="text-sm text-[var(--muted-foreground)]">{t('furigana.empty')}</p>
      )}
      {lines.map((line, li) => {
        // The converter preserves blank lyric rows as empty segments; do not render editor chrome for them.
        if (line.segments.length === 0) return null;

        const raw = rawLines?.[li];
        const isActiveLine = active?.lineIndex === li;
        return (
          <div
            key={li}
            className={`rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 sm:p-4 transition-colors ${
              isActiveLine ? 'ring-1 ring-[var(--primary)]/30' : ''
            }`}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <span className="shrink-0 text-[10px] font-medium uppercase tracking-wider text-[var(--muted-foreground)]">
                {t('furigana.line', { n: String(li + 1) })}
              </span>
              {raw !== undefined && (
                <span className="truncate text-xs text-[var(--muted-foreground)]/70">{raw}</span>
              )}
            </div>

            <div className="flex flex-wrap items-baseline gap-2">
              {groupEditorDisplaySegments(line.segments).map((part) => {
                if (part.kind === 'plain') {
                  return (
                    <span
                      key={part.key}
                      className="whitespace-pre-wrap text-sm leading-7 text-[var(--muted-foreground)]"
                    >
                      {part.text}
                    </span>
                  );
                }

                const { segment: seg, segmentIndex: si } = part;
                const isActive = isActiveLine && active?.segIndex === si;

                return (
                  <button
                    key={part.key}
                    type="button"
                    onClick={() => startEdit(li, si)}
                    className={`rounded-md border px-2 py-1 text-left text-sm transition-all ${
                      isActive
                        ? 'border-[var(--primary)] bg-[var(--primary)]/10 text-[var(--foreground)]'
                        : seg.reading
                          ? 'border-[var(--primary)]/30 bg-[var(--primary)]/10 text-[var(--foreground)] hover:bg-[var(--primary)]/15'
                          : 'border-transparent bg-[var(--accent)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
                    }`}
                  >
                    <span className="block">{seg.text}</span>
                    {seg.reading ? (
                      <span className="block text-[10px] leading-normal text-[var(--primary)]/80">{seg.reading}</span>
                    ) : (
                      <span aria-hidden="true" className="block select-none text-[10px] leading-normal text-transparent">
                        &nbsp;
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {isActiveLine && activeSeg && (
              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--muted)] p-2 sm:p-3">
                <span className="text-xs text-[var(--muted-foreground)]">{activeSeg.text}</span>
                {hasActiveKanji && (readingCandidatesLoading || selectableReadings.length > 1) && (
                  <div className="flex w-full flex-wrap items-center gap-1.5">
                    <span className="mr-1 text-[11px] text-[var(--muted-foreground)]">{t('furigana.suggestions')}</span>
                    {readingCandidatesLoading ? (
                      <span className="text-[11px] text-[var(--muted-foreground)]">{t('furigana.suggestionsLoading')}</span>
                    ) : selectableReadings.map((reading) => (
                      <button
                        key={reading}
                        type="button"
                        onClick={() => selectReading(reading)}
                        className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                          reading === activeSeg.reading
                            ? 'border-[var(--primary)]/50 bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20'
                            : 'border-[var(--border)] bg-[var(--card)] text-[var(--foreground)] hover:border-[var(--primary)]/40 hover:bg-[var(--accent)]'
                        }`}
                      >
                        {reading}
                      </button>
                    ))}
                  </div>
                )}
                <span className="text-[11px] text-[var(--muted-foreground)]">{t('furigana.manualReading')}</span>
                <input
                  ref={inputRef}
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={t('furigana.readingPlaceholder')}
                  className="min-w-[120px] flex-1 rounded-md border border-[var(--border)] bg-[var(--input)] px-2 py-1.5 text-sm outline-none focus:border-[var(--primary)]"
                />
                <button
                  type="button"
                  onClick={commitReading}
                  className="rounded-md bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                >
                  {t('common.save')}
                </button>
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  className="rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {t('common.cancel')}
                </button>
                {activeSeg.reading && (
                  <button
                    type="button"
                    onClick={removeReading}
                    className="rounded-md px-3 py-1.5 text-xs text-[var(--destructive)] hover:bg-[var(--destructive)]/10 transition-colors"
                  >
                    {t('furigana.remove')}
                  </button>
                )}
                {activeSeg.text.length > 1 && (
                  <button
                    type="button"
                    onClick={splitSegment}
                    className="rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
                  >
                    {t('furigana.split')}
                  </button>
                )}
                {active.segIndex < lines[active.lineIndex].segments.length - 1 &&
                  !isNonEditableDisplaySegment(lines[active.lineIndex].segments[active.segIndex + 1].text) && (
                  <button
                    type="button"
                    onClick={mergeNext}
                    className="rounded-md px-3 py-1.5 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--accent)] transition-colors"
                  >
                    {t('furigana.merge')}
                  </button>
                )}
                {sameWordCount > 0 && (
                  <button
                    type="button"
                    onClick={applyAll}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-[var(--primary)] bg-[var(--primary)]/10 hover:bg-[var(--primary)]/20 transition-colors"
                  >
                    {t('furigana.applyAll', { count: String(sameWordCount) })}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
