import { neonConfig } from '@neondatabase/serverless';

/**
 * Solo pruebas en CI (scripts/test-neon.ts, modo Postgres directo): el driver de Neon siempre habla
 * WebSocket, así que contra un Postgres normal pasa por un wsproxy (KAZERO_PG_WSPROXY = host:puerto).
 * Sin la variable (producción, previews, local) no cambia nada.
 */
export function configurarProxyLocal(proxy = process.env.KAZERO_PG_WSPROXY) {
  if (!proxy) return;
  neonConfig.wsProxy = `${proxy}/v1`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}
