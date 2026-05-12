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

  it('caps returned Grep content matches while preserving full aggregate counts', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-grep-cap-'));
    writeFileSync(
      join(cwd, 'access.log'),
      Array.from({ length: 520 }, (_, index) => `ERROR access failure ${index + 1}`).join('\n')
    );
    writeFileSync(
      join(cwd, 'catalina.log'),
      Array.from({ length: 40 }, (_, index) => `SEVERE startup failure ${index + 1}`).join('\n')
    );

    const result = await executeLocalTool({
      toolName: 'Grep',
      input: {
        pattern: 'ERROR|SEVERE',
        glob: '*.log',
        output_mode: 'content'
      },
      cwd,
      sessionId: 'session-1'
    });

    expect(result.summary).toContain('Grep matched 560 result(s)');
    expect(result.summary).toContain('returned 500');
    expect(result.metadata).toMatchObject({
      total_match_count: 560,
      returned_match_count: 500,
      omitted_match_count: 60,
      truncated: true,
      max_matches: 500
    });
    expect(result.metadata?.match_counts_by_file).toEqual(
      expect.arrayContaining([
        { file: 'access.log', count: 520 },
        { file: 'catalina.log', count: 40 }
      ])
    );
    expect(result.metadata?.matches).toHaveLength(500);
  });

  it('scans complete log files and preserves critical evidence near the end', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-logscan-'));
    writeFileSync(
      join(cwd, 'access.log'),
      [
        ...Array.from({ length: 1200 }, (_, index) => `2026-05-12T10:00:${String(index % 60).padStart(2, '0')}Z "GET /ok/${index} HTTP/1.1" 200 42 12`),
        '2026-05-12T10:21:15Z "POST /ords/resources/data HTTP/1.1" 500 912 23081 tenantId=TENANT-1 userId=USER-1'
      ].join('\n')
    );
    writeFileSync(
      join(cwd, 'catalina.log'),
      [
        ...Array.from({ length: 900 }, (_, index) => `2026-05-12 10:10:${String(index % 60).padStart(2, '0')} INFO startup ${index}`),
        '2026-05-12 10:22:02 SEVERE User request may timeout since query criteria attributes are not indexed.',
        '2026-05-12 10:22:03 ERROR oracle.jbo.JboException: query failed for tenantId=TENANT-1'
      ].join('\n')
    );

    const result = await executeLocalTool({
      toolName: 'LogScan',
      input: {
        file_paths: ['access.log', 'catalina.log'],
        slow_ms_threshold: 5000
      },
      cwd,
      sessionId: 'session-1'
    });

    expect(result.summary).toContain('LogScan scanned 2 file(s)');
    expect(result.metadata).toMatchObject({
      scanned_entire_files: true,
      total_files: 2,
      scanned_files: 2,
      totals: expect.objectContaining({
        lines: 2103,
        http_5xx: 1,
        severe: 1,
        error: 1,
        slow_requests: 1
      })
    });
    expect(result.metadata?.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'access.log',
          line_count: 1201,
          status_counts: expect.objectContaining({
            '500': 1
          }),
          slow_request_count: 1,
          slow_requests: expect.arrayContaining([
            expect.objectContaining({
              line: 1201,
              duration_ms: 23081
            })
          ])
        }),
        expect.objectContaining({
          file: 'catalina.log',
          line_count: 902,
          severity_counts: expect.objectContaining({
            severe: 1,
            error: 1
          }),
          top_signatures: expect.arrayContaining([
            expect.objectContaining({
              signature: expect.stringContaining('JboException'),
              first_line: 902,
              first_example: expect.stringContaining('query failed')
            })
          ])
        })
      ])
    );
    expect(result.metadata?.critical_examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          file: 'access.log',
          line: 1201,
          content: expect.stringContaining('500')
        }),
        expect.objectContaining({
          file: 'catalina.log',
          line: 902,
          content: expect.stringContaining('JboException')
        })
      ])
    );
    expect(result.metadata?.cross_file).toMatchObject({
      shared_identifiers: expect.arrayContaining([
        expect.objectContaining({
          value: 'TENANT-1',
          files: expect.arrayContaining(['access.log', 'catalina.log'])
        })
      ])
    });
  });

  it('keeps the slowest log requests as focused evidence instead of only the first slow lines', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'claude-oca-logscan-slowest-'));
    writeFileSync(
      join(cwd, 'access.log'),
      [
        '2026-05-12T10:00:01Z "GET /slow-a HTTP/1.1" 200 10 6000',
        '2026-05-12T10:00:02Z "GET /slow-b HTTP/1.1" 200 10 7000',
        '2026-05-12T10:00:03Z "GET /very-slow HTTP/1.1" 200 10 45000'
      ].join('\n')
    );

    const result = await executeLocalTool({
      toolName: 'LogScan',
      input: {
        file_path: 'access.log',
        slow_ms_threshold: 5000,
        max_examples_per_file: 2
      },
      cwd,
      sessionId: 'session-1'
    });

    expect(result.metadata?.slow_requests).toEqual([
      expect.objectContaining({
        line: 3,
        duration_ms: 45000,
        content: expect.stringContaining('/very-slow')
      }),
      expect.objectContaining({
        line: 2,
        duration_ms: 7000,
        content: expect.stringContaining('/slow-b')
      })
    ]);
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
