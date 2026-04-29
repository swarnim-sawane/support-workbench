import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseDotEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    let value = line.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    values[key] = value;
  }

  return values;
}

export function loadLocalEnv(
  targetEnv: NodeJS.ProcessEnv = process.env,
  candidates: string[] = defaultEnvCandidates()
): string | null {
  for (const candidate of candidates) {
    if (!existsSync(candidate)) {
      continue;
    }

    const parsed = parseDotEnv(readFileSync(candidate, 'utf8'));
    for (const [key, value] of Object.entries(parsed)) {
      if (targetEnv[key] === undefined) {
        targetEnv[key] = value;
      }
    }
    return candidate;
  }

  return null;
}

function defaultEnvCandidates(): string[] {
  const currentFileDir = dirname(fileURLToPath(import.meta.url));
  return [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
    resolve(currentFileDir, '..', '..', '.env')
  ];
}
