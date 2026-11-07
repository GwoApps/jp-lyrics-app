'use client';

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ExternalLink, Loader2, RotateCcw, Save, X } from 'lucide-react';
import Dialog from '@/components/ui/dialog';
import ConfirmDialog from '@/components/ConfirmDialog';
import { LOCALE_META, useI18n, type Locale } from '@/lib/i18n';
import type { ArtistProfileOverride } from '@/lib/artist-profile-types';
import type { ArtistProfile } from './types';
import { createProfileEditorSessionGuard } from './profile-editor-session';
import { buildArtistProfilePayload, profileDraftFromOverride, safeArtistExternalHref, sameProfileRecord, type ArtistProfileDraft, type BindingSource } from './profile-presentation';

interface Props { open: boolean; name: string; profile: ArtistProfile | null; onClose: () => void; onSaved: () => void }
const bindingFields = { spotify: 'spotifyArtistId', musicbrainz: 'musicbrainzId', wikidata: 'wikidataId' } as const;
const providerLabels = { spotify: 'Spotify', musicbrainz: 'MusicBrainz', wikidata: 'Wikidata' };
const errorKeys: Record<string, string> = {
  forbidden: 'forbidden', unauthorized: 'forbidden', login_required: 'forbidden',
  invalid_body: 'invalidForm', invalid_override: 'invalidForm', invalid_source: 'invalidForm',
  invalid_spotify_id: 'invalidSpotifyId', invalid_musicbrainz_id: 'invalidMusicBrainzId', invalid_wikidata_id: 'invalidWikidataId',
  identity_confirmation_required: 'confirmIdentityRequired', invalid_url: 'invalidLink', invalid_country: 'invalidCountry',
  artist_not_found: 'notFound', metadata_unavailable: 'lookupFailed', spotify_not_connected: 'spotifyNotConnected',
  artist_profile_invalid_override: 'invalidForm', artist_profile_invalid_name: 'invalidForm', artist_profile_invalid_body: 'invalidForm',
  artist_profile_confirmation_required: 'confirmIdentityRequired', artist_profile_invalid_lookup: 'invalidForm', artist_profile_invalid_id: 'invalidForm',
  artist_profile_lookup_unavailable: 'lookupFailed', artist_profile_lookup_not_found: 'lookupNotFound', artist_profile_lookup_rate_limited: 'lookupRateLimited',
  artist_profile_spotify_not_connected: 'spotifyNotConnected', artist_profile_load_failed: 'loadFailed', artist_profile_save_failed: 'saveFailed',
};
async function bodyOrError(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : 'request_failed');
  return body;
}

export default function ArtistProfileEditor({ open, name, profile, onClose, onSaved }: Props) {
  const { t, locale } = useI18n();
  const id = useId();
  const firstInput = useRef<HTMLInputElement>(null);
  const operation = useRef<symbol | null>(null);
  const [sessions] = useState(createProfileEditorSessionGuard);
  const previewController = useRef<AbortController | null>(null);
  const [session, setSession] = useState({ open, name });
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(false);
  const [stored, setStored] = useState<ArtistProfileOverride | null>(null);
  const [draft, setDraft] = useState<ArtistProfileDraft>(() => profileDraftFromOverride(null));
  const [language, setLanguage] = useState<Locale>(locale);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ source: BindingSource; id: string; profile: ArtistProfile } | null>(null);
  const [previewing, setPreviewing] = useState<BindingSource | null>(null);
  const [resetting, setResetting] = useState(false);
  const endpoint = `/api/admin/artists/${encodeURIComponent(name)}`;

  if (session.open !== open || session.name !== name) {
    setSession({ open, name });
    if (open) {
      setReady(false); setStored(null); setDraft(profileDraftFromOverride(null)); setLanguage(locale);
      setError(null); setBusy(false); setUncertain(false); setPreview(null); setPreviewing(null); setResetting(false);
    }
  }
  useLayoutEffect(() => {
    const token = sessions.enter();
    operation.current = null;
    return () => { sessions.leave(token); operation.current = null; };
  }, [open, name, sessions]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(endpoint, { cache: 'no-store', signal: controller.signal })
      .then(bodyOrError)
      .then((body) => {
        if (!('override' in body) || (body.override !== null && (typeof body.override !== 'object' || Array.isArray(body.override)))) throw new Error('invalid_response');
        if (controller.signal.aborted) return;
        const value = body.override as ArtistProfileOverride | null;
        setDraft(profileDraftFromOverride(value)); setStored(value); setReady(true); setError(null); setUncertain(false);
      })
      .catch((failure: unknown) => {
        if (!controller.signal.aborted) setError(errorKeys[failure instanceof Error ? failure.message : ''] ?? 'loadFailed');
      });
    return () => { controller.abort(); previewController.current?.abort(); };
  }, [open, endpoint, attempt]);

  const update = <K extends keyof ArtistProfileDraft>(key: K, value: ArtistProfileDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value, explicitClears: key === 'explicitClears' ? value as string[] : current.explicitClears.filter((field) => {
      if (field === key && typeof value === 'string' && value.trim()) return false;
      if (key === 'descriptions' && field.startsWith('descriptions.') && (value as Record<string, string>)[field.split('.')[1]]?.trim()) return false;
      return true;
    }) })); setError(null);
  };
  const changeBinding = (source: BindingSource, value: string) => {
    setDraft((current) => ({ ...current, [bindingFields[source]]: value, confirmIdentity: false, explicitClears: value ? current.explicitClears.filter((field) => field !== bindingFields[source]) : current.explicitClears })); setPreview(null); setError(null);
  };
  const lookup = async (source: BindingSource) => {
    if (operation.current || previewing) return;
    const value = draft[bindingFields[source]];
    const valid = source === 'spotify' ? /^[A-Za-z0-9]{22}$/.test(value)
      : source === 'musicbrainz' ? /^[a-f\d]{8}-(?:[a-f\d]{4}-){3}[a-f\d]{12}$/i.test(value) : /^Q[1-9]\d*$/.test(value);
    if (!valid) { setError(source === 'spotify' ? 'invalidSpotifyId' : source === 'musicbrainz' ? 'invalidMusicBrainzId' : 'invalidWikidataId'); return; }
    const controller = new AbortController();
    previewController.current?.abort(); previewController.current = controller;
    setPreviewing(source); setPreview(null); setError(null);
    try {
      const response = await fetch('/api/admin/artists/lookup', { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source, id: value }) });
      const body = await bodyOrError(response);
      const result = body.profile as ArtistProfile | undefined;
      if (!result || typeof result.name !== 'string' || !Array.isArray(result.genres)) throw new Error('invalid_response');
      if (!controller.signal.aborted) setPreview({ source, id: value, profile: result });
    } catch (failure) { if (!controller.signal.aborted) setError(errorKeys[failure instanceof Error ? failure.message : ''] ?? 'lookupFailed'); }
    finally { if (previewController.current === controller && !controller.signal.aborted) setPreviewing(null); }
  };
  const write = async (remove: boolean) => {
    if (!open || operation.current || !ready || uncertain || previewing) return;
    const ownSession = sessions.capture();
    if (!ownSession) return;
    const payload = buildArtistProfilePayload(draft);
    if (!remove && 'error' in payload) { setError(payload.error); return; }
    const ownOperation = Symbol('profile-write');
    operation.current = ownOperation; setBusy(true); setError(null); setResetting(false);
    let mayHaveWritten = false;
    try {
      // A lost or malformed successful response is an uncertain write, not
      // permission to blindly retry. Reload the exact record before another edit.
      mayHaveWritten = true;
      const response = await fetch(endpoint, { method: remove ? 'DELETE' : 'PUT', ...(remove ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) });
      mayHaveWritten = response.ok;
      const saved = await bodyOrError(response);
      const verified = await bodyOrError(await fetch(endpoint, { cache: 'no-store' }));
      if (!('override' in saved) || !('override' in verified) || !sameProfileRecord(saved.override, verified.override) || (remove && verified.override !== null)) throw new Error('readback_failed');
      if (sessions.isCurrent(ownSession)) { onSaved(); onClose(); }
    } catch (failure) {
      if (sessions.isCurrent(ownSession)) {
        if (mayHaveWritten) { setUncertain(true); setError('savedReadbackFailed'); }
        else setError(errorKeys[failure instanceof Error ? failure.message : ''] ?? 'saveFailed');
      }
    } finally {
      if (operation.current === ownOperation) { operation.current = null; if (sessions.isCurrent(ownSession)) setBusy(false); }
    }
  };
  const retry = () => { setReady(false); setError(null); setAttempt((value) => value + 1); };
  const submit = (event: FormEvent) => { event.preventDefault(); void write(false); };
  const close = () => { if (!operation.current) onClose(); };
  const disabled = busy || !!previewing;
  const hasBindings = !!(draft.spotifyArtistId || draft.musicbrainzId || draft.wikidataId);
  const previewHref = safeArtistExternalHref(preview?.profile.sourceUrl);

  return <>
    <Dialog open={open} onClose={close} title={t('artistProfile.editTitle', { name })} className="artist-profile-editor" dismissible={!busy} initialFocusRef={firstInput}>
      <form onSubmit={submit} noValidate className="artist-profile-editor-form">
        <div className="artist-profile-editor-heading"><div><h2>{t('artistProfile.editTitle', { name })}</h2><p>{t('artistProfile.editorHint')}</p></div><button type="button" className="artist-profile-icon-button" aria-label={t('common.close')} onClick={close} disabled={busy}><X size={18} /></button></div>
        <div className="artist-profile-editor-body" aria-busy={!ready || busy}>
          {!ready && !error && <p className="artist-profile-editor-status" role="status"><Loader2 size={15} className="animate-spin" aria-hidden="true" />{t('common.loading')}</p>}
          {error && <div className="artist-profile-editor-error" role="alert"><p>{t(`artistProfile.${error}`)}</p>{(!ready || uncertain) && <button type="button" className="artists-text-button" onClick={retry} disabled={busy}>{t('common.reload')}</button>}</div>}
          {ready && <fieldset disabled={disabled || uncertain} className="artist-profile-fields">
            {draft.explicitClears.length > 0 && <div className="artist-profile-cleared"><p>{t('artistProfile.clearedHint')}</p>{draft.explicitClears.map((field) => {
              const labels: Record<string, string> = { imageUrl: 'portrait', sourceUrl: 'sourcePage', aliases: 'aliases', genres: 'genres', kind: 'kind', country: 'country', spotifyArtistId: 'identityBindings', musicbrainzId: 'identityBindings', wikidataId: 'identityBindings', descriptions: 'biography' };
              const [key, language] = field.split('.');
              return <div key={field}><span>{t(`artistProfile.${labels[key]}`)}{language && ` · ${LOCALE_META[language as Locale]?.label ?? language}`}</span><button type="button" className="artists-text-button" onClick={() => update('explicitClears', draft.explicitClears.filter((value) => value !== field))}>{t('artistProfile.inherit')}</button></div>;
            })}</div>}
            <label className="artist-profile-field"><span>{t('artistProfile.portraitUrl')}</span><input ref={firstInput} id={`${id}-image`} type="url" value={draft.imageUrl} placeholder={profile?.imageUrl ?? 'https://…'} onChange={(event) => update('imageUrl', event.target.value)} /></label>
            <label className="artist-profile-field"><span>{t('artistProfile.sourcePage')}</span><input type="url" value={draft.sourceUrl} placeholder="https://…" onChange={(event) => update('sourceUrl', event.target.value)} /></label>
            <div className="artist-profile-field"><div className="artist-profile-field-title"><label htmlFor={`${id}-biography`}>{t('artistProfile.biography')}</label><select aria-label={t('artistProfile.biographyLanguage')} value={language} onChange={(event) => setLanguage(event.target.value as Locale)}>{(['zh-CN', 'zh-TW', 'en', 'ja'] as const).map((value) => <option key={value} value={value}>{LOCALE_META[value].label}</option>)}</select></div><textarea id={`${id}-biography`} rows={5} maxLength={4000} value={draft.descriptions[language]} onChange={(event) => update('descriptions', { ...draft.descriptions, [language]: event.target.value })} /></div>
            <div className="artist-profile-field-grid">
              <label className="artist-profile-field"><span>{t('artistProfile.kind')}</span><select aria-label={t('artistProfile.kind')} value={draft.kind} onChange={(event) => update('kind', event.target.value as ArtistProfileDraft['kind'])}><option value="">{t('artistProfile.inherit')}</option><option value="person">{t('artistProfile.kindPerson')}</option><option value="group">{t('artistProfile.kindGroup')}</option><option value="other">{t('artistProfile.kindOther')}</option></select></label>
              <label className="artist-profile-field"><span>{t('artistProfile.countryCode')}</span><input value={draft.country} maxLength={2} placeholder="JP" spellCheck={false} onChange={(event) => update('country', event.target.value)} /></label>
              <label className="artist-profile-field"><span>{t('artistProfile.aliasesLines')}</span><textarea rows={3} value={draft.aliases} onChange={(event) => update('aliases', event.target.value)} /></label>
              <label className="artist-profile-field"><span>{t('artistProfile.genresLines')}</span><textarea rows={3} value={draft.genres} onChange={(event) => update('genres', event.target.value)} /></label>
            </div>
            <details className="artist-profile-editor-section"><summary>{t('artistProfile.externalLinks')}</summary><div>{(['website', 'spotify', 'youtube'] as const).map((key) => <label className="artist-profile-field" key={key}><span>{key === 'website' ? t('artistProfile.website') : key === 'spotify' ? 'Spotify' : 'YouTube'}</span><input type="url" value={draft.links[key]} placeholder="https://…" onChange={(event) => update('links', { ...draft.links, [key]: event.target.value })} /></label>)}</div></details>
            <details className="artist-profile-editor-section"><summary>{t('artistProfile.identityBindings')}</summary><div><p className="artist-profile-editor-hint">{t('artistProfile.bindingHint')}</p>{(['spotify', 'musicbrainz', 'wikidata'] as const).map((source) => <div className="artist-profile-field" key={source}><label htmlFor={`${id}-${source}`}>{providerLabels[source]} ID</label><div className="artist-profile-binding-input"><input id={`${id}-${source}`} value={draft[bindingFields[source]]} spellCheck={false} autoComplete="off" onChange={(event) => changeBinding(source, event.target.value)} /><button type="button" className="artists-button" disabled={!draft[bindingFields[source]] || disabled} onClick={() => void lookup(source)}>{previewing === source ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : null}{t('artistProfile.preview')}</button></div></div>)}
              {preview && <article className="artist-profile-preview" role="status"><strong>{providerLabels[preview.source]} · {preview.profile.name}</strong>{preview.profile.aliases?.length ? <p>{preview.profile.aliases.join(' / ')}</p> : null}{preview.profile.description && <p>{preview.profile.description}</p>}{previewHref && <a href={previewHref} target="_blank" rel="noopener noreferrer">{t('artistProfile.openSource')}<ExternalLink size={11} aria-hidden="true" /></a>}<p className="artist-profile-editor-hint">{t('artistProfile.previewOnly')}</p></article>}
              {hasBindings && <label className="artist-profile-confirm"><input type="checkbox" checked={draft.confirmIdentity} onChange={(event) => update('confirmIdentity', event.target.checked)} /><span>{t('artistProfile.confirmIdentity')}</span></label>}
            </div></details>
          </fieldset>}
        </div>
        <footer className="artist-profile-editor-footer"><button type="button" className="artist-profile-reset" disabled={!ready || !stored || busy || uncertain || !!previewing} onClick={() => setResetting(true)}><RotateCcw size={13} aria-hidden="true" />{t('artistProfile.reset')}</button><div><button className="artists-button" type="button" onClick={close} disabled={busy}>{t('common.cancel')}</button><button className="artists-button artist-profile-save" type="submit" disabled={!ready || disabled || uncertain}>{busy ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}{t('common.save')}</button></div></footer>
      </form>
    </Dialog>
    <ConfirmDialog open={resetting} title={t('artistProfile.resetTitle')} body={t('artistProfile.resetBody', { name })} confirmLabel={t('artistProfile.reset')} cancelLabel={t('common.cancel')} variant="danger" onConfirm={() => void write(true)} onCancel={() => setResetting(false)} />
  </>;
}
