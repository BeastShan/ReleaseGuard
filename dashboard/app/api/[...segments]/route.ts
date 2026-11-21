type RouteContext = { params: Promise<{ segments: string[] }> };
const maxBytes = 192 * 1024;

function apiError(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store' } });
}

async function proxy(request: Request, context: RouteContext) {
  const host = request.headers.get('host');
  if (!host || !/^(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(host)) {
    return apiError('Local dashboard requests only.', 403);
  }

  const { segments } = await context.params;
  const route = segments.join('/');
  const posting = request.method === 'POST';
  if (posting ? route !== 'evidence' : !/^jobs(?:\/[0-9a-f-]{36})?$/.test(route)) {
    return apiError('Route not found.', 404);
  }

  let body: string | undefined;
  if (posting) {
    if (request.headers.get('origin') !== `http://${host}`) return apiError('Origin rejected.', 403);
    if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
      return apiError('Expected application/json.', 415);
    }
    if (Number(request.headers.get('content-length')) > maxBytes) return apiError('Evidence is too large.', 413);
    const reader = request.body?.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    body = '';
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          return apiError('Evidence is too large.', 413);
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } catch {
      return apiError('Could not read evidence.', 400);
    }
  }

  const port = process.env.RELEASEGUARD_API_PORT ?? '4100';
  if (!/^\d{1,5}$/.test(port) || Number(port) < 1 || Number(port) > 65_535) {
    return apiError('Invalid local API port.', 503);
  }
  try {
    const result = await fetch(`http://127.0.0.1:${port}/v1/${route}`, {
      method: request.method,
      headers: posting ? { 'Content-Type': 'application/json' } : undefined,
      body,
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5_000),
    });
    return new Response(result.body, {
      status: result.status,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return apiError('The local ReleaseGuard API is unavailable.', 503);
  }
}

export const GET = proxy;
export const POST = proxy;
