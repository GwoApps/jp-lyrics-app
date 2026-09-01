import { apiRequest, jsonRequest } from '../request.ts';

export interface ProviderWire {
  id: string;
  name: string;
  kind: 'builtin' | 'http';
  base_url: string | null;
  auth_type: 'none' | 'bearer';
  has_secret: boolean;
  secret_masked: string | null;
  enabled: boolean;
  priority: number;
  timeout_ms: number | null;
  source_config: Record<string, unknown> | null;
  protocol_version: number;
  manifest: { id?: string; name?: string; version?: string; capabilities?: string[] } | null;
  last_check_status: 'ok' | 'failed' | 'unchecked';
  last_check_code: string | null;
  last_check_latency_ms: number | null;
  checked_at: string | null;
  insecure_transport: boolean;
}

export interface PolicyWire {
  allowHttp: boolean;
  allowPrivateNetwork: boolean;
}

export interface BudgetWire {
  defaultTimeoutMs: number;
  maxTimeoutMs: number;
  manifestTimeoutMs: number;
  chainTimeoutMs: number;
}

export interface SourceSchemaField {
  key: string;
  label_key: string;
  type: 'number' | 'string' | 'boolean';
  default: number | string | boolean | null;
  min?: number;
  max?: number;
  step?: number;
  placeholder_key?: string;
  help_key?: string;
  env_fallback?: string;
}

export interface SourceSchema {
  key: string;
  display_name: string;
  fields: SourceSchemaField[];
}

export interface LyricsProvidersResponse {
  providers: ProviderWire[];
  policy: PolicyWire;
  budgets: BudgetWire;
  secret_key_configured: boolean;
  source_schemas: Record<string, SourceSchema>;
}

export interface ProviderTestResult {
  ok: boolean;
  code?: string;
  latencyMs?: number;
}

export type SaveProviderInput = {
  name: string;
  base_url?: string;
  auth_type?: 'none' | 'bearer';
  auth_secret?: string;
  timeout_ms: number | null;
  source_config?: Record<string, unknown>;
};

type ProviderMutationResponse = { provider: ProviderWire | null };
type OkResponse = { ok: true };

const BASE_URL = '/api/admin/lyrics-providers';

export function listLyricsProviders(): Promise<LyricsProvidersResponse> {
  return apiRequest<LyricsProvidersResponse>(BASE_URL);
}

export function createLyricsProvider(input: SaveProviderInput): Promise<ProviderMutationResponse> {
  return jsonRequest<ProviderMutationResponse>(BASE_URL, { method: 'POST', body: input });
}

export function updateLyricsProvider(id: string, input: Partial<SaveProviderInput> & { enabled?: boolean }): Promise<ProviderMutationResponse> {
  return jsonRequest<ProviderMutationResponse>(`${BASE_URL}/${encodeURIComponent(id)}`, { method: 'PUT', body: input });
}

export function deleteLyricsProvider(id: string): Promise<OkResponse> {
  return apiRequest<OkResponse>(`${BASE_URL}/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function testLyricsProvider(id: string): Promise<ProviderTestResult> {
  return jsonRequest<ProviderTestResult>(`${BASE_URL}/${encodeURIComponent(id)}/test`, { method: 'POST', body: {} });
}

export function reorderLyricsProviders(orderedIds: string[]): Promise<OkResponse> {
  return jsonRequest<OkResponse>(`${BASE_URL}/reorder`, { method: 'POST', body: { ordered_ids: orderedIds } });
}
