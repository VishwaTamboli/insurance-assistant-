import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The policies/ folder at the project root.
export const policiesDir = fileURLToPath(new URL('../../policies/', import.meta.url));

// The header at the top of each policy file, between the two `---` lines.
// One field per column of policy_documents.
export interface PolicyHeader {
  planCode: string;           // "GOLD"
  jurisdiction: string;       // "FR"
  version: string;            // "2026.1"
  title: string;              // "Gold Health Plan (France)"
  effectiveFrom: string;      // "2026-01-01"
  effectiveTo: string | null; // "2025-12-31", or null = still in force
}

export interface PolicyFile {
  path: string;
  header: PolicyHeader;
  body: string;        // the policy text below the header
  contentHash: string; // SHA-256 of the whole file: 64 hex characters
}

export async function listPolicyFiles(): Promise<string[]> {
  const names = (await readdir(policiesDir)).filter((name) => name.endsWith('.md')).sort();
  return names.map((name) => join(policiesDir, name));
}

export async function readPolicyFile(path: string): Promise<PolicyFile> {
  const text = await readFile(path, 'utf8');
  const { fields, body } = splitHeader(text, path);

  function required(key: string): string {
    if (!fields[key]) throw new Error(`${path}: header is missing "${key}"`);
    return fields[key];
  }

  return {
    path,
    header: {
      planCode: required('plan_code'),
      jurisdiction: required('jurisdiction'),
      version: required('version'),
      title: required('title'),
      effectiveFrom: required('effective_from'),
      effectiveTo: fields.effective_to || null, // empty in the file = still in force
    },
    body,
    // Hash the whole file, header included: if someone later sets effective_to on
    // a policy, that's a change too and the file gets ingested again.
    contentHash: createHash('sha256').update(text).digest('hex'),
  };
}

// "---\nplan_code: GOLD\n...\n---\n# Title..."
//   → { fields: { plan_code: 'GOLD', ... }, body: '# Title...' }
function splitHeader(text: string, path: string) {
  // The header is everything between a `---` on the first line and the next `---` line.
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) throw new Error(`${path}: no header (--- ... ---) at the top of the file`);

  const fields: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    fields[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }

  return { fields, body: text.slice(match[0].length).trim() };
}
