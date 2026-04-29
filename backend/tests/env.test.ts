import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadLocalEnv, parseDotEnv } from '../src/env.js';

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0, tempDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('parseDotEnv', () => {
  it('parses basic env files and strips wrapping quotes', () => {
    const parsed = parseDotEnv(`
# comment
OCA_BASE_URL=https://example.test
OCA_MODEL="oca/gpt-5.4"
OCA_TOKEN='secret'
`);

    expect(parsed).toEqual({
      OCA_BASE_URL: 'https://example.test',
      OCA_MODEL: 'oca/gpt-5.4',
      OCA_TOKEN: 'secret'
    });
  });
});

describe('loadLocalEnv', () => {
  it('loads values from the first matching .env file without overwriting existing vars', () => {
    const dir = mkdtempSync(join(tmpdir(), 'claude-oca-env-'));
    tempDirs.push(dir);
    const envPath = join(dir, '.env');
    writeFileSync(
      envPath,
      ['OCA_BASE_URL=https://example.test', 'OCA_MODEL=oca/gpt-5.4', 'OCA_TOKEN=from-file'].join(
        '\n'
      )
    );

    const targetEnv: NodeJS.ProcessEnv = {
      OCA_MODEL: 'already-set'
    };

    const loadedFrom = loadLocalEnv(targetEnv, [envPath]);

    expect(loadedFrom).toBe(envPath);
    expect(targetEnv).toMatchObject({
      OCA_BASE_URL: 'https://example.test',
      OCA_MODEL: 'already-set',
      OCA_TOKEN: 'from-file'
    });
  });
});
