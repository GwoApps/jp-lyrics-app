'use client';

import { X } from 'lucide-react';
import { DEFAULT_DOT_GRID_PARAMS, type DotGridParams } from '@/components/LyricsDotGrid';
import { useI18n } from '@/lib/i18n';

/**
 * Debug-only live tuner for the lyrics dot-grid effect. A floating card of
 * sliders/toggles wired straight into LyricsDotGrid's params.
 */
interface LyricsDotParamsPanelProps {
  params: DotGridParams;
  onChange: (next: DotGridParams) => void;
  onClose: () => void;
}

function Slider({ label, value, min, max, step, format, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex items-center justify-between text-[11px] text-[var(--muted-foreground)]">
        <span>{label}</span>
        <output className="rounded bg-[var(--accent)]/10 px-1 font-mono text-[10.5px] text-[var(--foreground)]">
          {format ? format(value) : value}
        </output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full"
      />
    </label>
  );
}

function Toggle({ label, checked, onChange }: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-[11.5px] text-[var(--muted-foreground)] select-none">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3.5 w-3.5 accent-[var(--primary)]"
      />
    </label>
  );
}

export default function LyricsDotParamsPanel({ params, onChange, onClose }: LyricsDotParamsPanelProps) {
  const { t } = useI18n();
  const set = (key: keyof DotGridParams, value: number | boolean) => {
    onChange({ ...params, [key]: value });
  };

  return (
    <div
      role="dialog"
      aria-label={t('song.dotParams')}
      className="fixed bottom-24 right-4 z-50 w-56 rounded-xl border border-[var(--border)] bg-[var(--card)]/95 p-3.5 shadow-2xl backdrop-blur-sm sm:bottom-auto sm:right-4 sm:top-20"
    >
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-[var(--foreground)]">{t('song.dotParams')}</h3>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onChange({ ...DEFAULT_DOT_GRID_PARAMS })}
            className="rounded-md px-1.5 py-0.5 text-[10.5px] text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            {t('song.dotParamsReset')}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="rounded-md p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <div className="space-y-2.5">
        <Slider label="spacing" value={params.spacing} min={10} max={52} step={1} onChange={(v) => set('spacing', v)} />
        <Slider label="dot size" value={params.dot} min={0.6} max={5} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => set('dot', v)} />
        <Slider label="radius" value={params.radius} min={50} max={360} step={5} onChange={(v) => set('radius', v)} />
        <Slider label="base" value={params.base} min={0} max={0.4} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => set('base', v)} />
        <Slider label="scale" value={params.scale} min={1} max={3.5} step={0.1} format={(v) => v.toFixed(1)} onChange={(v) => set('scale', v)} />
        <Slider label="ease" value={params.ease} min={0.03} max={1} step={0.01} format={(v) => v.toFixed(2)} onChange={(v) => set('ease', v)} />
        <Slider label="alpha" value={params.alpha} min={0} max={1} step={0.05} format={(v) => v.toFixed(2)} onChange={(v) => set('alpha', v)} />
        <div className="grid grid-cols-2 gap-2 border-t border-[var(--border)]/60 pt-2">
          <Toggle label="bloom" checked={params.glow} onChange={(v) => set('glow', v)} />
          <Toggle label="magnet" checked={params.mag} onChange={(v) => set('mag', v)} />
        </div>
      </div>
    </div>
  );
}
