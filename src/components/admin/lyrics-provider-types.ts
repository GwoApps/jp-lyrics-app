export type {
  BudgetWire,
  LyricsProvidersResponse as ListResponse,
  PolicyWire,
  ProviderTestResult,
  ProviderWire,
  SourceSchema,
  SourceSchemaField,
} from '@/client/api/admin/lyrics-providers';

export const EMPTY_PROVIDER_FORM = {
  name: '',
  base_url: '',
  auth_type: 'none' as 'none' | 'bearer',
  auth_secret: '',
  timeout_ms: '',
  source_config: {} as Record<string, unknown>,
};

export type ProviderForm = typeof EMPTY_PROVIDER_FORM;
