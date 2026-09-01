'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useI18n } from '@/lib/i18n';
import type { ProviderForm, ProviderWire, SourceSchema } from './lyrics-provider-types';

/** Dynamic source-config form for builtin providers, driven by the API schema. */
export default function BuiltinSourceConfigFields({
  provider,
  form,
  setForm,
  schemas,
}: {
  provider: ProviderWire;
  form: ProviderForm;
  setForm: Dispatch<SetStateAction<ProviderForm>>;
  schemas: Record<string, SourceSchema> | undefined;
}) {
  const { t } = useI18n();
  const sourceKey = provider.id.replace(/^builtin[:-]/, '');
  const schema = schemas?.[sourceKey];
  if (!schema || schema.fields.length === 0) return null;

  const setField = (key: string, value: unknown) => {
    setForm((prev) => ({
      ...prev,
      source_config: { ...prev.source_config, [key]: value },
    }));
  };

  return (
    <div className="space-y-3 border-t border-[var(--border)] pt-3">
      <p className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
        {t('admin.lyricsProviderSourceConfig')}
      </p>
      {schema.fields.map((field) => {
        const current = form.source_config[field.key];

        if (field.type === 'boolean') {
          const checked = typeof current === 'boolean'
            ? current
            : Boolean(field.default);
          return (
            <label key={field.key} className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setField(field.key, e.target.checked)}
                className="h-4 w-4 rounded border-[var(--border)] accent-[var(--primary)]"
              />
              <span className="text-sm">{t(`admin.${field.label_key}`)}</span>
              {field.help_key && (
                <span className="ml-auto text-[11px] text-[var(--muted-foreground)]">{t(`admin.${field.help_key}`)}</span>
              )}
            </label>
          );
        }

        if (field.type === 'number') {
          return (
            <label key={field.key} className="block">
              <span className="mb-1 block text-xs font-medium">{t(`admin.${field.label_key}`)}</span>
              <input
                type="number"
                value={typeof current === 'number' ? String(current) : ''}
                placeholder={field.default != null ? String(field.default) : ''}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === '') {
                    // Remove the key to use the schema default.
                    setForm((prev) => {
                      const next = { ...prev.source_config };
                      delete next[field.key];
                      return { ...prev, source_config: next };
                    });
                  } else {
                    setField(field.key, Number(v));
                  }
                }}
                min={field.min}
                max={field.max}
                step={field.step ?? 1}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[var(--primary)]"
              />
              {field.help_key && (
                <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">{t(`admin.${field.help_key}`)}</span>
              )}
            </label>
          );
        }

        // string type
        return (
          <label key={field.key} className="block">
            <span className="mb-1 block text-xs font-medium">{t(`admin.${field.label_key}`)}</span>
            <input
              type="text"
              value={typeof current === 'string' ? current : ''}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '') {
                  // Remove the key to fall back to the schema default.
                  setForm((prev) => {
                    const next = { ...prev.source_config };
                    delete next[field.key];
                    return { ...prev, source_config: next };
                  });
                } else {
                  setField(field.key, v);
                }
              }}
              placeholder={field.placeholder_key ? t(`admin.${field.placeholder_key}`) : undefined}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 py-1.5 font-mono text-xs outline-none focus:border-[var(--primary)]"
            />
            {field.help_key && (
              <span className="mt-1 block text-[11px] text-[var(--muted-foreground)]">{t(`admin.${field.help_key}`)}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}
