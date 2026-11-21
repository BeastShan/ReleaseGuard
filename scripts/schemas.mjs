import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { agentResultSchema, evidenceSchema, incidentSchema, policySchema, taskSchema } from '../src/core/contracts.ts';

for (const [name, schema] of Object.entries({
  'agent-result': agentResultSchema, evidence: evidenceSchema, incident: incidentSchema, policy: policySchema, task: taskSchema,
})) {
  const destination = new URL(`../schemas/${name}.schema.json`, import.meta.url);
  const content = JSON.stringify(z.toJSONSchema(schema, { io: 'input', reused: 'ref' }), null, 2) + '\n';
  if (process.argv.includes('--check')) {
    if (await readFile(destination, 'utf8') !== content) {
      console.error(`Schema out of date: ${destination.pathname}`);
      process.exitCode = 1;
    }
  } else {
    await writeFile(destination, content);
  }
}
