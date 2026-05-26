import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { applyToolSchemaDefaults } from '../src/toolSchema.js';

describe('applyToolSchemaDefaults', () => {
  it('applies zod defaults before fake MCP handlers run', () => {
    const parsed = applyToolSchemaDefaults(
      {
        log_folder: z.string(),
        mode: z.enum(['adf', 'forms', 'reports']).optional().default('adf'),
        verbose: z.boolean().optional().default(true),
        trace_mode: z.boolean().optional().default(false),
        no_auto_open: z.boolean().optional().default(true)
      },
      {
        log_folder: 'C:/logs'
      }
    );

    expect(parsed).toEqual({
      log_folder: 'C:/logs',
      mode: 'adf',
      verbose: true,
      trace_mode: false,
      no_auto_open: true
    });
  });

  it('rejects explicitly invalid tool values', () => {
    expect(() =>
      applyToolSchemaDefaults(
        {
          mode: z.enum(['adf', 'forms', 'reports']).optional().default('adf')
        },
        {
          mode: 'bad-mode'
        }
      )
    ).toThrow(/mode/i);
  });
});
