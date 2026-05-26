import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HelpDrawer } from './HelpDrawer';
import type { WorkbenchIntegrationSnapshot } from '../types';

describe('HelpDrawer', () => {
  beforeEach(() => {
    cleanup();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders focused analyzer status, available analyzers, and unavailable reasons', () => {
    render(
      <HelpDrawer
        open
        commands={[{ name: '/report', description: 'Force report mode', category: 'workflow' }]}
        jdMcp={{
          available: true,
          connected: false,
          note: 'Focused analyzers are recognized, but some prerequisites are still missing.',
          tools: ['analyze_har_file'],
          categories: ['diagnostics', 'reports'],
          toolDescriptors: [
            tool('analyze_har_file', 'Analyze a HAR file.', true),
            tool('translate_forms_trace', 'Translate Oracle Forms traces.', false, 'FORMS_HOME is not configured.')
          ]
        }}
        onClose={vi.fn()}
      />
    );

    const section = screen.getByRole('region', { name: /focused analyzers/i });
    expect(within(section).getByText(/partially configured/i)).toBeInTheDocument();
    expect(within(section).getByText('analyze_har_file')).toBeInTheDocument();
    expect(within(section).getByText('translate_forms_trace')).toBeInTheDocument();
    expect(within(section).getByText(/FORMS_HOME is not configured/i)).toBeInTheDocument();
    expect(within(section).getAllByText(/requires approval/i)).toHaveLength(2);
  });

  it('keeps closing behavior intact', () => {
    const onClose = vi.fn();
    render(
      <HelpDrawer
        open
        commands={[]}
        jdMcp={{
          available: false,
          connected: false,
          note: 'Focused analyzers are not configured.',
          tools: [],
          categories: [],
          toolDescriptors: []
        }}
        onClose={onClose}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: /close help/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

function tool(
  name: string,
  description: string,
  enabled: boolean,
  reason?: string
): WorkbenchIntegrationSnapshot['jdMcp']['toolDescriptors'][number] {
  return {
    name,
    description,
    source: 'jd-mcp',
    requiresApproval: true,
    category: 'diagnostics',
    producesReports: name.includes('trace'),
    enabled,
    visibility: enabled ? 'enabled' : 'unsupported',
    stability: 'stable',
    reason
  };
}
