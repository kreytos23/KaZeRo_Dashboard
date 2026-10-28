import { describe, expect, it, vi } from 'vitest';

const { config } = vi.hoisted(() => ({ config: {} as Record<string, unknown> }));
vi.mock('@neondatabase/serverless', () => ({ neonConfig: config }));

import { configurarProxyLocal } from '@/db/proxy-local';

describe('configurarProxyLocal', () => {
  it('sin KAZERO_PG_WSPROXY no toca la configuración de Neon (producción y previews)', () => {
    configurarProxyLocal(undefined);
    expect(config).toEqual({});
  });

  it('con wsproxy usa WebSocket sin TLS contra /v1 y sin pipelining', () => {
    configurarProxyLocal('wsproxy:80');
    expect(config).toEqual({
      wsProxy: 'wsproxy:80/v1',
      useSecureWebSocket: false,
      pipelineTLS: false,
      pipelineConnect: false,
    });
  });
});
