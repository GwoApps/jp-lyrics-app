'use client';

import { FormEvent, ReactNode, useCallback, useEffect, useId, useState } from 'react';
import { ExternalLink, KeyRound, Loader2, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';

interface SpotifyLoginButtonProps {
  children: ReactNode;
  className?: string;
  title?: string;
}

const GITHUB_URL = 'https://github.com/GwoApps/jp-lyrics-app';

export default function SpotifyLoginButton({ children, className, title }: SpotifyLoginButtonProps) {
  const { t } = useI18n();
  const titleId = useId();
  const descriptionId = useId();
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);

  const closeDialog = useCallback(() => {
    if (submitting) return;
    setOpen(false);
    setPassphrase('');
    setError(null);
  }, [submitting]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !submitting) closeDialog();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeDialog, open, submitting]);

  const beginLogin = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const response = await fetch('/api/auth/login-gate', { cache: 'no-store' });
      if (!response.ok) throw new Error('login_gate_unavailable');
      const data = await response.json() as { required?: boolean };
      if (!data.required) {
        window.location.assign('/api/auth/login');
        return;
      }
      setError(null);
      setOpen(true);
    } catch {
      setError(t('loginGate.requestFailed'));
      setOpen(true);
    } finally {
      setChecking(false);
    }
  };

  const submitPassphrase = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!passphrase || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/auth/login-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passphrase }),
      });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) {
        setError(data.error === 'passphrase_invalid'
          ? t('loginGate.invalid')
          : t('loginGate.requestFailed'));
        return;
      }
      setPassphrase('');
      window.location.assign('/api/auth/login');
    } catch {
      setError(t('loginGate.requestFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={beginLogin}
        disabled={checking}
        aria-busy={checking}
        className={className}
        title={title}
      >
        {children}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDialog();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="fade-in w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-2xl sm:p-6"
          >
            <div className="mb-4 flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#1DB954]/15 text-[#1DB954]">
                <KeyRound className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id={titleId} className="text-base font-semibold tracking-tight">
                  {t('loginGate.title')}
                </h2>
              </div>
              <button
                type="button"
                onClick={closeDialog}
                disabled={submitting}
                className="rounded-md p-1 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
                aria-label={t('common.close')}
                title={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={submitPassphrase}>
              <div id={descriptionId} className="mb-4 rounded-lg border border-[var(--border)] bg-[var(--muted)]/55 p-3 text-xs leading-relaxed text-[var(--muted-foreground)]">
                <p>{t('loginGate.description')}</p>
                <p className="mt-2">
                  {t('loginGate.selfHost')}{' '}
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 font-medium text-[var(--primary)] hover:underline"
                  >
                    GitHub <ExternalLink className="h-3 w-3" />
                  </a>
                </p>
              </div>

              <label htmlFor={`${titleId}-passphrase`} className="mb-1.5 block text-xs font-medium">
                {t('loginGate.passphraseLabel')}
              </label>
              <input
                id={`${titleId}-passphrase`}
                type="password"
                value={passphrase}
                onChange={(event) => setPassphrase(event.target.value)}
                placeholder={t('loginGate.passphrasePlaceholder')}
                autoComplete="off"
                autoFocus
                disabled={submitting}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-[var(--muted-foreground)]/50 focus:border-[var(--primary)] disabled:opacity-60"
              />

              {error && (
                <p role="alert" className="mt-2 text-xs text-[var(--destructive)]">{error}</p>
              )}

              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={closeDialog}
                  disabled={submitting}
                  className="rounded-md border border-[var(--border)] px-3.5 py-2 text-xs font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-50"
                >
                  {t('loginGate.cancel')}
                </button>
                <button
                  type="submit"
                  disabled={!passphrase || submitting}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#1DB954] px-3.5 py-2 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {submitting ? t('loginGate.submitting') : t('loginGate.submit')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
