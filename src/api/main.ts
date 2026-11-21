import { loadPolicy } from '../core/policy.ts';
import { buildApi } from './server.ts';

try {
  const rawPort = process.env.RELEASEGUARD_API_PORT ?? '4100';
  const port = Number(rawPort);
  if (!/^\d{1,5}$/.test(rawPort) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('RG_CONFIG_INVALID: RELEASEGUARD_API_PORT must be an integer from 1 to 65535.');
  }
  const api = buildApi(await loadPolicy());
  await api.listen({ host: '127.0.0.1', port });
  console.log(`ReleaseGuard API listening at http://127.0.0.1:${port}`);
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void api.close());
  }
} catch (error) {
  const message = error instanceof Error && error.message.startsWith('RG_CONFIG_INVALID:')
    ? error.message : 'RG_STARTUP_FAILED: Could not start the ReleaseGuard API.';
  console.error(message);
  process.exitCode = 1;
}
