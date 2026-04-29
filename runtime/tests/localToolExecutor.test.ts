import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeLocalTool } from '../src/localToolExecutor.js';

describe('executeLocalTool', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.HOME;
    delete process.env.USERPROFILE;
  });

  it('fetches and summarizes web pages with WebFetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () =>
          '<html><body><main><h1>Runtime Notes</h1><p>Use dedicated tools first.</p></main></body></html>'
      }))
    );

    const result = await executeLocalTool({
      toolName: 'WebFetch',
      input: {
        url: 'https://example.com/runtime',
        prompt: 'Summarize the key guidance'
      },
      cwd: process.cwd(),
      sessionId: 'session-1'
    });

    expect(result.summary).toContain('Fetched');
    expect(result.metadata).toMatchObject({
      url: 'https://example.com/runtime'
    });
    expect(String(result.metadata?.content)).toContain('Runtime Notes');
  });

  it('searches the web with WebSearch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        text: async () => `
          <html><body>
            <a class="result__a" href="https://docs.example.com/claude">Claude runtime docs</a>
            <a class="result__a" href="https://docs.example.com/oca">OCA provider notes</a>
          </body></html>
        `
      }))
    );

    const result = await executeLocalTool({
      toolName: 'WebSearch',
      input: {
        query: 'claude code runtime'
      },
      cwd: process.cwd(),
      sessionId: 'session-1'
    });

    expect(result.summary).toContain('WebSearch returned');
    expect(result.metadata).toMatchObject({
      query: 'claude code runtime'
    });
    expect(result.metadata?.results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ title: 'Claude runtime docs' })
      ])
    );
  });

  it('supports ripgrep-style leading (?i) case-insensitive Grep patterns', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-grep-'));
    writeFileSync(join(cwd, 'DefaultServer-diagnostic.log'), 'WARNING startup\nerror details\nok\n');

    const result = await executeLocalTool({
      toolName: 'Grep',
      input: {
        pattern: '(?i)(ERROR|WARNING)',
        glob: '*.log',
        output_mode: 'content'
      },
      cwd,
      sessionId: 'session-1'
    });

    expect(result.summary).toContain('Grep matched 2 result');
    expect(result.metadata).toMatchObject({
      pattern: '(ERROR|WARNING)',
      original_pattern: '(?i)(ERROR|WARNING)',
      ignore_case: true
    });
  });

  it('discovers and loads local skills with Skill', async () => {
    const homeDir = mkdtempSync(join(tmpdir(), 'claude-oca-home-'));
    const skillDir = join(homeDir, '.agents', 'skills', 'demo-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      ['---', 'name: demo-skill', 'description: demo description', '---', '', '# Demo'].join('\n'),
      'utf8'
    );
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    const result = await executeLocalTool({
      toolName: 'Skill',
      input: {
        command: 'demo-skill'
      },
      cwd: process.cwd(),
      sessionId: 'session-1'
    });

    expect(result.summary).toContain('Loaded skill demo-skill');
    expect(result.metadata).toMatchObject({
      command: 'demo-skill',
      name: 'demo-skill'
    });
    expect(String(result.metadata?.content)).toContain('# Demo');
  });
});
