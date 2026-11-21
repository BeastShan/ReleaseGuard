import { stripVTControlCharacters } from 'node:util';
import { evidenceSchema } from './contracts.ts';
import type { Evidence } from './contracts.ts';

export function redact(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u0080-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/-----BEGIN [^-\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^-\r\n]*PRIVATE KEY-----|$)/gi, '[REDACTED PRIVATE KEY]')
    .replace(/\b(?:gh[pousr]_[a-z0-9_]{12,}|github_pat_[a-z0-9_]{15,}|(?:AKIA|ASIA)[A-Z0-9]{16}|sk-(?:proj-|live_)?[a-z0-9_-]{16,})\b/gi, '[REDACTED TOKEN]')
    .replace(/\b(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@')
    .replace(/([?&](?:token|access_token|api_key|sig|signature|key)=)[^&#\s"']+/gi, '$1[REDACTED]')
    .replace(/\b(Bearer|Basic) +[a-z0-9._~+/=-]+/gi, '$1 [REDACTED]')
    .replace(/("(?:[\w.-]*(?:token|secret|password|passwd|api[_-]?key|authorization|cookie))"\s*:\s*)"(?:\\.|[^"\\])*"/gi, '$1"[REDACTED]"')
    .replace(/\b([\w.-]*(?:token|secret|password|passwd|api[_-]?key|authorization|cookie)["']?[ \t]*[:=][ \t]*)[^\r\n]*/gi, '$1[REDACTED]');
}

export function sanitizeEvidence(input: unknown): Evidence {
  const evidence = evidenceSchema.parse(input);
  const logs = redact(evidence.logs.join('\n')).split('\n')
    .map((line) => line.trim().slice(0, 1_000)).filter(Boolean).slice(-80);
  return {
    ...evidence,
    repository: evidence.repository.toLowerCase(),
    commit: evidence.commit.toLowerCase(),
    failingTarget: redact(evidence.failingTarget).replace(/\s+/g, ' ').trim().slice(0, 300) || 'Unnamed failure',
    logs: logs.length ? logs : ['No displayable log lines supplied.'],
    attempts: evidence.attempts?.map(({ label, result, detail }) => ({
      label: redact(label).slice(0, 80) || 'Attempt',
      result,
      detail: redact(detail).slice(0, 200) || 'No displayable details supplied.',
    })),
  };
}
