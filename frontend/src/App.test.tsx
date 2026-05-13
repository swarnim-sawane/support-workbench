import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { WorkbenchSessionSnapshot } from './types';

describe('App', () => {
  afterEach(() => {
    window.history.pushState({}, '', '/');
    vi.useRealTimers();
  });

  it('renders the Codex-style shell, transcript events, and permission overlay', async () => {
    const onApprove = vi.fn();
    const onPromptSubmit = vi.fn();
    const onAttachFiles = vi.fn();
    const onRemoveAttachment = vi.fn();
    const onQueueAttachment = vi.fn();
    const onUnqueueAttachment = vi.fn();
    const snapshot = {
      sessionId: 'session-1',
      status: 'awaiting_approval',
      messages: [
        {
          id: 'message-1',
          role: 'system',
          kind: 'command-error',
          content: 'Unknown slash command /commads. Did you mean /commands?'
        },
        {
          id: 'message-2',
          role: 'user',
          content: 'Give me a deeper ADF analysis'
        },
        {
          id: 'message-3',
          role: 'assistant',
          content: '## Deep analysis\n\n- REST call succeeded\n- `ADF_FACES-30130` needs cleanup'
        }
      ],
      tasks: [
        {
          id: 'task-1',
          content: 'Map parity gaps',
          status: 'pending'
        }
      ],
      memory: {
        entries: [
          {
            id: 'memory-1',
            content: 'Prefer dedicated tools',
            createdAt: '2026-04-23T00:00:00.000Z'
          }
        ]
      },
      history: {
        summaries: [
          {
            id: 'summary-1',
            title: 'Session summary',
            preview: 'Condensed prior context',
            transcript: ['user: /tasks', 'system: /tasks: No tasks recorded for this session.'],
            openTasks: [],
            rememberedNotes: [],
            changedFiles: [],
            createdAt: '2026-04-23T00:00:00.000Z'
          }
        ]
      },
      agents: [
        {
          id: 'agent-1',
          parentSessionId: 'session-1',
          parentToolUseId: 'toolu_agent_1',
          agentType: 'research',
          status: 'completed',
          prompt: 'Inspect the repo structure',
          messages: [],
          toolActivity: [],
          resultSummary: 'I inspected the repo structure.',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:01:00.000Z',
          completedAt: '2026-04-24T00:01:00.000Z'
        }
      ],
      pendingApprovals: [
        {
          requestId: 'req-1',
          toolUseId: 'toolu_1',
          toolName: 'Write',
          input: { file_path: 'README.md' },
          reasoning: 'Need to update documentation.',
          agentId: 'agent-1',
          agentType: 'research'
        }
      ],
      toolActivity: [
        {
          requestId: 'req-jd-1',
          toolUseId: 'toolu_jd_1',
          toolName: 'analyze_adf_logs',
          source: 'jd-mcp',
          category: 'reports',
          producesReports: true,
          status: 'completed',
          input: { log_folder: 'C:/repo/logs' },
          summary: 'Generated 1 jd-mcp HTML report artifact',
          artifacts: [
            {
              id: 'report-1',
              requestId: 'req-jd-1',
              sessionId: 'session-1',
              toolName: 'analyze_adf_logs',
              source: 'jd-mcp',
              kind: 'html-report',
              title: 'ADF Log Review',
              filePath: 'C:/repo/reports/adflr-report.html',
              fileName: 'adflr-report.html',
              createdAt: '2026-04-24T00:00:00.000Z',
              size: 512
            }
          ],
          startedAt: '2026-04-24T00:00:00.000Z',
          completedAt: '2026-04-24T00:01:00.000Z'
        }
      ],
      workspace: {
        cwd: 'C:/repo',
        changedFiles: [],
        diffs: []
      },
      attachments: [
        {
          id: 'att-1',
          originalName: 'trace.log',
          storedName: 'trace.log',
          mediaType: 'text/plain',
          kind: 'text',
          localPath: 'C:/repo/.claude-oca/uploads/session-1/trace.log',
          size: 42,
          promptVisibility: 'available',
          ocrStatus: 'unavailable',
          uploadedAt: '2026-04-24T00:00:00.000Z'
        },
        {
          id: 'att-2',
          originalName: 'error.png',
          storedName: 'error.png',
          mediaType: 'image/png',
          kind: 'image',
          localPath: 'C:/repo/.claude-oca/uploads/session-1/error.png',
          size: 128,
          promptVisibility: 'available',
          ocrStatus: 'completed',
          extractedText: 'HTTP 500 on localhost'
          ,
          uploadedAt: '2026-04-24T00:00:00.000Z'
        }
      ],
      commands: [{ name: '/tasks', description: 'Manage tasks', category: 'workflow' }],
      session: {
        branch: 'main'
      },
      integrations: {
        skills: [{ name: 'demo-skill', description: 'demo', path: 'C:/skill/SKILL.md' }],
        mcp: {
          available: false,
          servers: []
        },
        lsp: {
          available: false,
          note: 'Not configured'
        },
        jdMcp: {
          available: true,
          connected: true,
          note: 'Connected to jd-mcp',
          tools: ['analyze_adf_logs', 'list_directory', 'translate_forms_trace'],
          categories: ['reports', 'helpers'],
          toolDescriptors: [
            {
              name: 'analyze_adf_logs',
              description: 'Analyze ADF logs through jd-mcp.',
              source: 'jd-mcp',
              requiresApproval: true,
              category: 'reports',
              producesReports: true,
              enabled: true,
              visibility: 'enabled',
              stability: 'stable'
            },
            {
              name: 'list_directory',
              description: 'List a diagnostic directory before choosing an analyzer.',
              source: 'jd-mcp',
              requiresApproval: true,
              category: 'helpers',
              producesReports: false,
              enabled: true,
              visibility: 'enabled',
              stability: 'stable'
            },
            {
              name: 'translate_forms_trace',
              description: 'Translate Oracle Forms traces.',
              source: 'jd-mcp',
              requiresApproval: true,
              category: 'reports',
              producesReports: true,
              enabled: false,
              visibility: 'unsupported',
              stability: 'stable',
              reason: 'FORMS_HOME is not configured.'
            }
          ]
        }
      },
      reports: {
        artifacts: [
          {
            id: 'report-1',
            requestId: 'req-jd-1',
            sessionId: 'session-1',
            toolName: 'analyze_adf_logs',
            source: 'jd-mcp',
            kind: 'html-report',
            title: 'ADF Log Review',
            filePath: 'C:/repo/reports/adflr-report.html',
            fileName: 'adflr-report.html',
            createdAt: '2026-04-24T00:00:00.000Z',
            size: 512
          }
        ]
      },
      skippedTools: [],
      reportSuggestion: null
    } as unknown as WorkbenchSessionSnapshot & Record<string, unknown>;

    render(
      <App
        snapshot={snapshot}
        health={{ ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' }}
        queuedAttachmentIds={['att-1']}
        onPromptSubmit={onPromptSubmit}
        onApprove={onApprove}
        onAttachFiles={onAttachFiles}
        onRemoveAttachment={onRemoveAttachment}
        onQueueAttachment={onQueueAttachment}
        onUnqueueAttachment={onUnqueueAttachment}
      />
    );

    expect(screen.getByRole('heading', { name: /support workbench/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /session history/i })).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: /workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /files/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: /reports/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /support workbench conversation/i })).toBeInTheDocument();
    expect(screen.queryByText(/approval queue/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tool permissions/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/tool timeline/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/html artifacts/i)).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: /permission request for write/i })).toBeInTheDocument();
    expect(document.querySelector('.composer-dock.has-approval .permission-card')).toBeTruthy();
    expect(screen.getByText(/permission request/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /do you want to allow write/i })).toBeInTheDocument();
    expect(screen.getByText(/ran 1 tool/i)).toBeInTheDocument();
    expect(screen.getByText(/created 1 report/i)).toBeInTheDocument();
    expect(screen.getByText(/Map parity gaps/)).toBeInTheDocument();
    expect(screen.getByText('Unknown slash command /commads. Did you mean /commands?')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /deep analysis/i })).toBeInTheDocument();
    expect(screen.getByText('ADF_FACES-30130')).toBeInTheDocument();
    expect(screen.getByText(/Session summary/)).toBeInTheDocument();
    expect(screen.getByText(/Condensed prior context/)).toBeInTheDocument();
    expect(screen.getAllByText('trace.log').length).toBeGreaterThan(0);
    expect(screen.getAllByText('error.png').length).toBeGreaterThan(0);
    expect(screen.getByText(/ran 1 subagent/i)).toBeInTheDocument();
    expect(screen.getByText('I inspected the repo structure.')).toBeInTheDocument();
    expect(screen.getByText('ADF Log Review')).toBeInTheDocument();
    expect(screen.getAllByText(/analyze_adf_logs/i).length).toBeGreaterThan(0);
    const rail = screen.getByRole('complementary', { name: /session history/i });
    expect(within(rail).queryByRole('button', { name: /integrations/i })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: /subagents/i })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: /tool activity/i })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: /reports/i })).not.toBeInTheDocument();
    expect(within(rail).queryByRole('button', { name: /queued files/i })).not.toBeInTheDocument();
    expect(screen.getByText(/Generated 1 jd-mcp HTML report artifact/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny write/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /allow write/i }));

    expect(onApprove).toHaveBeenCalledWith('req-1', 'allow');

    fireEvent.click(screen.getByRole('button', { name: /adf log review/i }));
    expect(screen.getByRole('complementary', { name: /report viewer/i })).toBeInTheDocument();
    expect(screen.getByTitle('ADF Log Review')).toBeInTheDocument();

    await userEvent.upload(
      screen.getByLabelText(/attach files/i),
      new File(['stack trace'], 'stacktrace.log', { type: 'text/plain' })
    );
    expect(onAttachFiles).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: /remove queued attachment trace\.log/i }));
    expect(onUnqueueAttachment).toHaveBeenCalledWith('att-1');

    fireEvent.click(screen.getByRole('button', { name: /queue error\.png/i }));
    expect(onQueueAttachment).toHaveBeenCalledWith('att-2');

    fireEvent.change(screen.getByPlaceholderText(/message support workbench/i), {
      target: { value: 'inspect the uploads' }
    });
    fireEvent.click(screen.getByRole('button', { name: /send prompt/i }));

    expect(onPromptSubmit).toHaveBeenCalledWith('inspect the uploads', ['att-1']);
  });

  it('explains why no report was generated and lets the user force /report', () => {
    const onApprove = vi.fn();
    const onPromptSubmit = vi.fn();
    const onAttachFiles = vi.fn();
    const onRemoveAttachment = vi.fn();
    const onQueueAttachment = vi.fn();
    const onUnqueueAttachment = vi.fn();
    const snapshot = {
      sessionId: 'session-2',
      status: 'completed',
      messages: [],
      tasks: [],
      memory: {
        entries: []
      },
      history: {
        summaries: []
      },
      agents: [],
      pendingApprovals: [],
      toolActivity: [],
      workspace: {
        cwd: 'C:/repo',
        changedFiles: [],
        diffs: []
      },
      attachments: [
        {
          id: 'att-log',
          originalName: 'DefaultServer-diagnostic.log',
          storedName: 'DefaultServer-diagnostic.log',
          mediaType: 'text/plain',
          kind: 'text',
          localPath: 'C:/repo/.claude-oca/uploads/session-2/DefaultServer-diagnostic.log',
          size: 128,
          promptVisibility: 'available',
          ocrStatus: 'unavailable',
          uploadedAt: '2026-04-24T00:00:00.000Z'
        }
      ],
      commands: [{ name: '/report', description: 'Force report mode', category: 'workflow' }],
      session: {
        branch: 'main'
      },
      integrations: {
        skills: [],
        mcp: {
          available: false,
          servers: []
        },
        lsp: {
          available: false,
          note: 'Not configured'
        },
        jdMcp: {
          available: true,
          connected: true,
          note: 'Connected to jd-mcp',
          tools: ['analyze_adf_logs'],
          categories: ['reports'],
          toolDescriptors: [
            {
              name: 'analyze_adf_logs',
              description: 'Analyze ADF logs through jd-mcp.',
              source: 'jd-mcp',
              requiresApproval: true,
              category: 'reports',
              producesReports: true,
              enabled: true,
              visibility: 'enabled',
              stability: 'stable'
            }
          ]
        }
      },
      reports: {
        artifacts: []
      },
      skippedTools: [
        {
          toolName: 'analyze_adf_logs',
          reasonCode: 'builtin_better_for_single_file',
          explanation:
            'This turn used direct file analysis because it gives a better answer for a single attached log.',
          canOverride: true
        }
      ],
      reportSuggestion: {
        available: true,
        canRun: true,
        suggestedToolName: 'analyze_adf_logs',
        attachmentIds: ['att-log'],
        explanation:
          'This turn used direct file analysis because it gives a better answer for a single attached log. analyze_adf_logs expects a folder and can still be run if you want an HTML report.'
      }
    } as unknown as WorkbenchSessionSnapshot & Record<string, unknown>;

    render(
      <App
        snapshot={snapshot}
        health={{ ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' }}
        queuedAttachmentIds={[]}
        onPromptSubmit={onPromptSubmit}
        onApprove={onApprove}
        onAttachFiles={onAttachFiles}
        onRemoveAttachment={onRemoveAttachment}
        onQueueAttachment={onQueueAttachment}
        onUnqueueAttachment={onUnqueueAttachment}
      />
    );

    expect(screen.getByText(/why no report\?/i)).toBeInTheDocument();
    expect(screen.getByText(/better answer for a single attached log/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /run jd-mcp report anyway/i }));

    expect(onPromptSubmit).toHaveBeenCalledWith('/report', ['att-log']);
  });

  it('labels explicit analyzer misses as direct-analysis fallback', () => {
    const onApprove = vi.fn();
    const onPromptSubmit = vi.fn();
    const noop = vi.fn();
    const snapshot = {
      sessionId: 'session-explicit',
      status: 'blocked',
      messages: [],
      tasks: [],
      memory: {
        entries: []
      },
      history: {
        summaries: []
      },
      agents: [],
      pendingApprovals: [],
      toolActivity: [],
      workspace: {
        cwd: 'C:/repo',
        changedFiles: [],
        diffs: []
      },
      attachments: [
        {
          id: 'att-log',
          originalName: 'DefaultServer-diagnostic.log',
          storedName: 'DefaultServer-diagnostic.log',
          mediaType: 'text/plain',
          kind: 'text',
          localPath: 'C:/repo/.claude-oca/uploads/session-explicit/DefaultServer-diagnostic.log',
          size: 128,
          promptVisibility: 'available',
          ocrStatus: 'unavailable',
          uploadedAt: '2026-04-24T00:00:00.000Z'
        }
      ],
      commands: [{ name: '/report', description: 'Force report mode', category: 'workflow' }],
      session: {
        branch: 'main'
      },
      integrations: {
        skills: [],
        mcp: {
          available: false,
          servers: []
        },
        lsp: {
          available: false,
          note: 'Not configured'
        },
        jdMcp: {
          available: true,
          connected: true,
          tools: ['analyze_adf_logs'],
          categories: ['reports'],
          toolDescriptors: []
        }
      },
      reports: {
        artifacts: []
      },
      skippedTools: [],
      reportSuggestion: {
        available: true,
        canRun: true,
        suggestedToolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        attachmentIds: ['att-log'],
        input: {
          log_folder: 'C:/repo/.claude-oca/uploads/session-explicit'
        },
        reasonCode: 'explicit_tool_request_not_honored',
        explanation:
          'analyze_adf_logs was requested but no jd-mcp HTML report was generated. Direct analysis was used as a fallback.'
      }
    } as unknown as WorkbenchSessionSnapshot & Record<string, unknown>;

    render(
      <App
        snapshot={snapshot}
        health={{ ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' }}
        queuedAttachmentIds={[]}
        onPromptSubmit={onPromptSubmit}
        onApprove={onApprove}
        onAttachFiles={noop}
        onRemoveAttachment={noop}
        onQueueAttachment={noop}
        onUnqueueAttachment={noop}
      />
    );

    expect(screen.getByText('Direct analysis fallback used')).toBeInTheDocument();
    expect(screen.queryByText(/why no report\?/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /run jd-mcp report anyway/i }));

    expect(onPromptSubmit).toHaveBeenCalledWith('/report', ['att-log']);
  });

  it('shows unavailable analyzer fallback without offering /report', () => {
    const onApprove = vi.fn();
    const onPromptSubmit = vi.fn();
    const noop = vi.fn();
    const snapshot = {
      sessionId: 'session-unavailable',
      status: 'completed',
      messages: [],
      tasks: [],
      memory: {
        entries: []
      },
      history: {
        summaries: []
      },
      agents: [],
      pendingApprovals: [],
      toolActivity: [],
      workspace: {
        cwd: 'C:/repo',
        changedFiles: [],
        diffs: []
      },
      attachments: [],
      commands: [{ name: '/report', description: 'Force report mode', category: 'workflow' }],
      session: {
        branch: 'main'
      },
      integrations: {
        skills: [],
        mcp: {
          available: false,
          servers: []
        },
        lsp: {
          available: false,
          note: 'Not configured'
        },
        jdMcp: {
          available: false,
          connected: false,
          tools: [],
          categories: [],
          toolDescriptors: []
        }
      },
      reports: {
        artifacts: []
      },
      skippedTools: [],
      reportSuggestion: {
        available: false,
        canRun: false,
        suggestedToolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        attachmentIds: ['att-log'],
        input: {
          log_folder: 'C:/repo/.claude-oca/uploads/session-unavailable'
        },
        reasonCode: 'analyzer_unavailable_direct_analysis_used',
        explanation:
          'analyze_adf_logs unavailable: JD_MCP_ROOT is not configured. Direct analysis was used instead; no jd-mcp HTML report was generated.'
      }
    } as unknown as WorkbenchSessionSnapshot & Record<string, unknown>;

    render(
      <App
        snapshot={snapshot}
        health={{ ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' }}
        queuedAttachmentIds={[]}
        onPromptSubmit={onPromptSubmit}
        onApprove={onApprove}
        onAttachFiles={noop}
        onRemoveAttachment={noop}
        onQueueAttachment={noop}
        onUnqueueAttachment={noop}
      />
    );

    expect(screen.getByText('Analyzer unavailable, direct analysis used')).toBeInTheDocument();
    expect(screen.getByText(/JD_MCP_ROOT is not configured/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /run jd-mcp report anyway/i })).not.toBeInTheDocument();
  });

  it('shows shimmer thinking while a turn is running before assistant text arrives', () => {
    const noop = vi.fn();
    const snapshot = {
      sessionId: 'session-thinking',
      status: 'running',
      messages: [
        {
          id: 'user-thinking',
          role: 'user',
          content: 'Analyze this log deeply'
        }
      ],
      tasks: [],
      memory: {
        entries: []
      },
      history: {
        summaries: []
      },
      agents: [],
      pendingApprovals: [],
      toolActivity: [],
      workspace: {
        cwd: 'C:/repo',
        changedFiles: [],
        diffs: []
      },
      attachments: [],
      commands: [],
      session: {
        branch: 'main'
      },
      integrations: {
        skills: [],
        mcp: {
          available: false,
          servers: []
        },
        lsp: {
          available: false,
          note: 'Not configured'
        },
        jdMcp: {
          available: true,
          connected: true,
          note: 'Connected to jd-mcp',
          tools: ['analyze_adf_logs'],
          categories: ['reports'],
          toolDescriptors: []
        }
      },
      reports: {
        artifacts: []
      },
      skippedTools: [],
      reportSuggestion: null
    } as unknown as WorkbenchSessionSnapshot;

    render(
      <App
        snapshot={snapshot}
        health={{ ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' }}
        queuedAttachmentIds={[]}
        onPromptSubmit={noop}
        onApprove={noop}
        onAttachFiles={noop}
        onRemoveAttachment={noop}
        onQueueAttachment={noop}
        onUnqueueAttachment={noop}
      />
    );

    expect(screen.getByRole('status', { name: /preparing answer/i })).toBeInTheDocument();
    expect(screen.getByText(/^Working$/)).toBeInTheDocument();
    expect(screen.queryByText(/working for/i)).not.toBeInTheDocument();
  });

  it('keeps running answer elapsed time anchored after switching sessions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-24T00:02:05.000Z'));
    const noop = vi.fn();
    const runningSnapshot = {
      ...buildInteractiveSnapshot(),
      sessionId: 'session-running',
      status: 'running',
      messages: [
        {
          id: 'user-running',
          role: 'user',
          content: 'Analyze this log deeply'
        }
      ],
      toolActivity: [],
      reports: {
        artifacts: []
      },
      session: {
        branch: 'main',
        activeTurnStartedAt: '2026-04-24T00:00:00.000Z'
      }
    } as unknown as WorkbenchSessionSnapshot;
    const otherSnapshot = {
      ...buildInteractiveSnapshot(),
      sessionId: 'session-other',
      messages: [
        {
          id: 'assistant-other',
          role: 'assistant',
          content: 'Other session is idle.'
        }
      ]
    } as WorkbenchSessionSnapshot;

    const { rerender } = render(
      <App
        snapshot={runningSnapshot}
        activeSessionId="session-running"
        health={{ ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' }}
        queuedAttachmentIds={[]}
        onPromptSubmit={noop}
        onApprove={noop}
        onAttachFiles={noop}
        onRemoveAttachment={noop}
        onQueueAttachment={noop}
        onUnqueueAttachment={noop}
      />
    );

    expect(screen.getByText('Working for 2m 5s')).toBeInTheDocument();

    rerender(
      <App
        snapshot={otherSnapshot}
        activeSessionId="session-other"
        health={{ ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' }}
        queuedAttachmentIds={[]}
        onPromptSubmit={noop}
        onApprove={noop}
        onAttachFiles={noop}
        onRemoveAttachment={noop}
        onQueueAttachment={noop}
        onUnqueueAttachment={noop}
      />
    );
    expect(screen.queryByText(/Working for/)).not.toBeInTheDocument();

    vi.setSystemTime(new Date('2026-04-24T00:02:10.000Z'));
    rerender(
      <App
        snapshot={runningSnapshot}
        activeSessionId="session-running"
        health={{ ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' }}
        queuedAttachmentIds={[]}
        onPromptSubmit={noop}
        onApprove={noop}
        onAttachFiles={noop}
        onRemoveAttachment={noop}
        onQueueAttachment={noop}
        onUnqueueAttachment={noop}
      />
    );

    expect(screen.getByText('Working for 2m 10s')).toBeInTheDocument();
    expect(screen.queryByText('Working for 0s')).not.toBeInTheDocument();
  });

  it('uses the workspace tabs and launches report viewer with Escape close', async () => {
    const user = userEvent.setup();
    const noop = vi.fn();
    renderWorkbench({
      snapshot: buildInteractiveSnapshot(),
      queuedAttachmentIds: ['att-1'],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    expect(screen.getByRole('complementary', { name: /workspace/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /files/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('trace.log').length).toBeGreaterThan(0);

    await user.click(screen.getByRole('tab', { name: /reports/i }));
    expect(screen.getByRole('tab', { name: /reports/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: /reports/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open adf log review/i }));
    expect(screen.getByRole('complementary', { name: /report viewer/i })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.queryByRole('complementary', { name: /report viewer/i })).not.toBeInTheDocument()
    );
  });

  it('does not open a command palette and submits typed slash commands normally', async () => {
    const user = userEvent.setup();
    const onPromptSubmit = vi.fn();
    const noop = vi.fn();
    renderWorkbench({
      snapshot: buildInteractiveSnapshot(),
      queuedAttachmentIds: [],
      onPromptSubmit,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true });
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument();

    const composer = screen.getByPlaceholderText(/message support workbench/i);
    await user.type(composer, '/report');
    expect(screen.queryByRole('listbox', { name: /slash commands/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /send prompt/i }));
    expect(onPromptSubmit).toHaveBeenCalledWith('/report', []);
  });

  it('uploads files from paste and drop interactions', () => {
    const onAttachFiles = vi.fn();
    const noop = vi.fn();
    renderWorkbench({
      snapshot: buildInteractiveSnapshot(),
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    const pastedFile = new File(['paste'], 'pasted.log', { type: 'text/plain' });
    const composer = screen.getByPlaceholderText(/message support workbench/i);
    fireEvent.paste(composer, {
      clipboardData: {
        files: [pastedFile]
      }
    });
    expect(onAttachFiles).toHaveBeenCalledWith([pastedFile]);

    const droppedFile = new File(['drop'], 'dropped.log', { type: 'text/plain' });
    fireEvent.drop(composer, {
      dataTransfer: {
        types: ['Files'],
        files: [droppedFile],
        dropEffect: ''
      }
    });
    expect(onAttachFiles).toHaveBeenCalledWith([droppedFile]);
  });

  it('supports approval keyboard shortcuts and expandable runtime details', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const noop = vi.fn();
    renderWorkbench({
      snapshot: {
        ...buildInteractiveSnapshot(),
        status: 'awaiting_approval',
        pendingApprovals: [
          {
            requestId: 'req-approval',
            toolUseId: 'toolu_approval',
            toolName: 'Write',
            input: { file_path: 'README.md' },
            reasoning: 'Need to update documentation.'
          }
        ]
      },
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    fireEvent.keyDown(window, { key: '3' });
    expect(onApprove).toHaveBeenCalledWith('req-approval', 'deny');

    await user.click(screen.getByText(/ran analyze_adf_logs/i));
    expect(screen.getByText('Input')).toBeInTheDocument();
    expect(screen.getByText(/log_folder/i)).toBeInTheDocument();
  });

  it('keeps runtime cards anchored to their original turn after later messages', () => {
    const noop = vi.fn();
    renderWorkbench({
      snapshot: {
        ...buildInteractiveSnapshot(),
        messages: [
          {
            id: 'user-original',
            role: 'user',
            content: 'Analyze this diagnostic log'
          },
          {
            id: 'assistant-original',
            role: 'assistant',
            content: 'I inspected the attached log and summarized the key issues.'
          },
          {
            id: 'user-later',
            role: 'user',
            content: '/tasks what is this for'
          },
          {
            id: 'system-later',
            role: 'system',
            kind: 'command',
            content: '/tasks: No tasks recorded for this session.'
          }
        ]
      },
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    const runtimeCard = screen.getByText(/ran 1 tool/i);
    const laterUserTurn = screen.getByText('/tasks what is this for');

    expect(
      runtimeCard.compareDocumentPosition(laterUserTurn) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('shows a clean model pill, sidebar toggle, and the new header more menu', async () => {
    const user = userEvent.setup();
    const noop = vi.fn();
    renderWorkbench({
      snapshot: buildInteractiveSnapshot(),
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    const header = screen.getByRole('banner');
    expect(within(header).getByText(/proof of concept/i)).toBeInTheDocument();
    expect(within(header).getByText('OCA GPT-5.4')).toBeInTheDocument();
    expect(within(header).queryByText(/oracle-code-assist/i)).not.toBeInTheDocument();
    expect(within(header).queryByText(/jd-mcp/i)).not.toBeInTheDocument();

    const rail = screen.getByRole('complementary', { name: /session history/i });
    await user.click(within(rail).getByRole('button', { name: /hide sidebar/i }));
    expect(within(rail).getByRole('button', { name: /show sidebar/i })).toBeInTheDocument();
    expect(within(rail).queryByRole('navigation', { name: /chats/i })).not.toBeInTheDocument();
    await user.click(within(rail).getByRole('button', { name: /show sidebar/i }));
    expect(within(rail).getByRole('navigation', { name: /chats/i })).toBeInTheDocument();
    expect(within(rail).getByRole('button', { name: /^new chat$/i })).toBeInTheDocument();

    await user.click(within(header).getByRole('button', { name: /more options/i }));
    expect(screen.getByRole('menu', { name: /more options/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /download chat/i })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /themes/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /light/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /dark/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitemradio', { name: /redwood/i })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /help/i })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /command palette/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('menuitemradio', { name: /dark/i }));
    expect(document.querySelector('.app-shell')).toHaveAttribute('data-theme', 'dark');

    await user.click(screen.getByRole('menuitem', { name: /help/i }));
    expect(screen.getByRole('dialog', { name: /quick help/i })).toBeInTheDocument();
    expect(screen.getByText(/to run commands/i)).toBeInTheDocument();
    expect(screen.getByText(/slash commands guide the workflow/i)).toBeInTheDocument();
    expect(screen.getByText(/all slash commands/i)).toBeInTheDocument();
    expect(screen.getAllByText('/thread-dumps').length).toBeGreaterThan(0);
    expect(screen.getByText('/correlate-har-logs')).toBeInTheDocument();
    expect(screen.queryByText('Ctrl/Cmd+K')).not.toBeInTheDocument();
  });

  it('opens the full documentation view from the header menu and returns to the workbench', async () => {
    const user = userEvent.setup();
    const noop = vi.fn();
    renderWorkbench({
      snapshot: buildInteractiveSnapshot(),
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    await user.click(screen.getByRole('button', { name: /more options/i }));
    await user.click(screen.getByRole('menuitem', { name: /documentation/i }));

    expect(screen.getByRole('main', { name: /support workbench documentation/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /support workbench documentation/i })).toBeInTheDocument();
    expect(screen.getByText(/guided diagnostic workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/best for/i)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /documentation section navigation/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /01 what support workbench does/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /slash-command workflows/i })).toBeInTheDocument();
    expect(screen.getByText('/auto-triage')).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/message support workbench/i)).not.toBeInTheDocument();

    expect(window.location.pathname).toBe('/docs');

    await user.click(
      within(screen.getByRole('main', { name: /support workbench documentation/i })).getByRole('button', {
        name: /back to workbench/i
      })
    );
    expect(screen.getByPlaceholderText(/message support workbench/i)).toBeInTheDocument();
    expect(screen.queryByRole('main', { name: /support workbench documentation/i })).not.toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
  });

  it('opens documentation directly from /docs and tracks hash section navigation', async () => {
    window.history.pushState({}, '', '/docs#approval-flow');
    const user = userEvent.setup();
    const noop = vi.fn();
    renderWorkbench({
      snapshot: buildInteractiveSnapshot(),
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    expect(screen.getByRole('main', { name: /support workbench documentation/i })).toBeInTheDocument();
    const approvalLink = screen.getByRole('link', { name: /05 approval flow and safe execution/i });
    expect(approvalLink).toHaveAttribute('aria-current', 'location');

    await user.click(screen.getByRole('link', { name: /08 practical notes and limitations/i }));
    expect(window.location.hash).toBe('#practical-notes');
    expect(screen.getByRole('link', { name: /08 practical notes and limitations/i })).toHaveAttribute(
      'aria-current',
      'location'
    );
  });

  it('renders session history rows and upload cards', async () => {
    const user = userEvent.setup();
    const noop = vi.fn();
    const onNewSession = vi.fn();
    const onSelectSession = vi.fn();
    const snapshot = {
      ...buildInteractiveSnapshot(),
      messages: [
        {
          id: 'upload-message',
          role: 'system',
          kind: 'attachment',
          content: 'Uploaded 1 file from diagnostic.zip',
          attachmentIds: ['att-zip-1']
        }
      ],
      attachments: [
        {
          id: 'att-zip-1',
          originalName: 'server.log',
          storedName: 'server.log',
          mediaType: 'text/plain',
          kind: 'text',
          localPath: 'C:/repo/.claude-oca/uploads/session-interactive/server.log',
          size: 64,
          promptVisibility: 'available',
          ocrStatus: 'unavailable',
          sourceArchive: {
            id: 'archive-1',
            name: 'diagnostic.zip',
            relativePath: 'logs/server.log'
          },
          uploadedAt: '2026-04-24T00:00:00.000Z'
        }
      ]
    } as WorkbenchSessionSnapshot;

    renderWorkbench({
      snapshot,
      sessions: [
        {
          id: 'session-interactive',
          title: 'Prior ADF issue',
          preview: 'Checked logs',
          status: 'completed',
          cwd: 'C:/repo',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:01:00.000Z',
          messageCount: 3,
          attachmentCount: 1,
          reportCount: 1
        }
      ],
      activeSessionId: 'session-interactive',
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop,
      onNewSession,
      onSelectSession
    });

    const rail = screen.getByRole('complementary', { name: /session history/i });
    await user.click(within(rail).getByRole('button', { name: /^new chat$/i }));
    expect(onNewSession).toHaveBeenCalledTimes(1);
    await user.click(within(rail).getByRole('button', { name: /^prior adf issue 3 msg/i }));
    expect(onSelectSession).toHaveBeenCalledWith('session-interactive');

    expect(screen.getByText('Uploaded 1 file from diagnostic.zip')).toBeInTheDocument();
    expect(screen.getAllByText('logs/server.log').length).toBeGreaterThan(0);
  });

  it('confirms chat deletion without selecting the chat and disables active-turn deletes', async () => {
    const user = userEvent.setup();
    const noop = vi.fn();
    const onSelectSession = vi.fn();
    const onDeleteSession = vi.fn();

    renderWorkbench({
      snapshot: buildInteractiveSnapshot(),
      sessions: [
        {
          id: 'session-interactive',
          title: 'Prior ADF issue',
          preview: 'Checked logs',
          status: 'completed',
          cwd: 'C:/repo',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:01:00.000Z',
          messageCount: 3,
          attachmentCount: 1,
          reportCount: 1
        },
        {
          id: 'session-running',
          title: 'Running chat',
          preview: 'Still working',
          status: 'running',
          cwd: 'C:/repo',
          createdAt: '2026-04-24T00:00:00.000Z',
          updatedAt: '2026-04-24T00:02:00.000Z',
          messageCount: 1,
          attachmentCount: 0,
          reportCount: 0
        }
      ],
      activeSessionId: 'session-interactive',
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop,
      onSelectSession,
      onDeleteSession
    });

    const rail = screen.getByRole('complementary', { name: /session history/i });
    await user.click(within(rail).getByRole('button', { name: /delete prior adf issue/i }));

    expect(onSelectSession).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: /delete this chat/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('dialog', { name: /delete this chat/i })).not.toBeInTheDocument();
    expect(onDeleteSession).not.toHaveBeenCalled();

    await user.click(within(rail).getByRole('button', { name: /delete prior adf issue/i }));
    await user.click(screen.getByRole('button', { name: /^delete$/i }));
    expect(onDeleteSession).toHaveBeenCalledWith('session-interactive');

    expect(within(rail).getByRole('button', { name: /delete running chat/i })).toBeDisabled();
  });
});

type RenderWorkbenchInput = {
  snapshot: WorkbenchSessionSnapshot;
  sessions?: ComponentProps<typeof App>['sessions'];
  activeSessionId?: string | null;
  queuedAttachmentIds: string[];
  onPromptSubmit: ReturnType<typeof vi.fn>;
  onApprove: ReturnType<typeof vi.fn>;
  onAttachFiles: ReturnType<typeof vi.fn>;
  onRemoveAttachment: ReturnType<typeof vi.fn>;
  onQueueAttachment: ReturnType<typeof vi.fn>;
  onUnqueueAttachment: ReturnType<typeof vi.fn>;
  onNewSession?: ReturnType<typeof vi.fn>;
  onSelectSession?: ReturnType<typeof vi.fn>;
  onDeleteSession?: ReturnType<typeof vi.fn>;
};

function renderWorkbench(input: RenderWorkbenchInput) {
  return render(
    <App
      snapshot={input.snapshot}
      sessions={input.sessions}
      activeSessionId={input.activeSessionId}
      health={{ ok: true, provider: 'oracle-code-assist', model: 'oca/gpt-5.4' }}
      queuedAttachmentIds={input.queuedAttachmentIds}
      onPromptSubmit={input.onPromptSubmit}
      onApprove={input.onApprove}
      onAttachFiles={input.onAttachFiles}
      onRemoveAttachment={input.onRemoveAttachment}
      onQueueAttachment={input.onQueueAttachment}
      onUnqueueAttachment={input.onUnqueueAttachment}
      onNewSession={input.onNewSession}
      onSelectSession={input.onSelectSession}
      onDeleteSession={input.onDeleteSession}
    />
  );
}

function buildInteractiveSnapshot(): WorkbenchSessionSnapshot {
  return {
    sessionId: 'session-interactive',
    status: 'completed',
    messages: [
      {
        id: 'assistant-interactive',
        role: 'assistant',
        content: 'Analysis complete.'
      }
    ],
    tasks: [
      {
        id: 'task-interactive',
        content: 'Review diagnostic flow',
        status: 'pending'
      }
    ],
    memory: {
      entries: [
        {
          id: 'memory-interactive',
          content: 'Prefer direct log analysis for single files.',
          createdAt: '2026-04-24T00:00:00.000Z'
        }
      ]
    },
    history: {
      summaries: [
        {
          id: 'history-interactive',
          title: 'Prior work',
          preview: 'Checked ADF logs.',
          transcript: [],
          openTasks: [],
          rememberedNotes: [],
          changedFiles: [],
          createdAt: '2026-04-24T00:00:00.000Z'
        }
      ]
    },
    agents: [
      {
        id: 'agent-interactive',
        parentSessionId: 'session-interactive',
        parentToolUseId: 'toolu_agent',
        agentType: 'diagnostics',
        status: 'completed',
        prompt: 'Inspect logs',
        messages: [],
        toolActivity: [],
        resultSummary: 'No fatal exception found.',
        createdAt: '2026-04-24T00:00:00.000Z',
        updatedAt: '2026-04-24T00:01:00.000Z',
        completedAt: '2026-04-24T00:01:00.000Z'
      }
    ],
    pendingApprovals: [],
    toolActivity: [
      {
        requestId: 'req-jd-interactive',
        toolUseId: 'toolu_jd_interactive',
        toolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        category: 'reports',
        producesReports: true,
        status: 'completed',
        input: {
          log_folder: 'C:/repo/logs'
        },
        summary: 'Generated 1 jd-mcp HTML report artifact',
        metadata: {
          files: 4
        },
        artifacts: [
          {
            id: 'report-interactive',
            requestId: 'req-jd-interactive',
            sessionId: 'session-interactive',
            toolName: 'analyze_adf_logs',
            source: 'jd-mcp',
            kind: 'html-report',
            title: 'ADF Log Review',
            filePath: 'C:/repo/reports/adflr-report.html',
            fileName: 'adflr-report.html',
            createdAt: '2026-04-24T00:00:00.000Z',
            size: 512
          }
        ],
        startedAt: '2026-04-24T00:00:00.000Z',
        completedAt: '2026-04-24T00:01:00.000Z'
      }
    ],
    workspace: {
      cwd: 'C:/repo',
      changedFiles: [],
      diffs: []
    },
    attachments: [
      {
        id: 'att-1',
        originalName: 'trace.log',
        storedName: 'trace.log',
        mediaType: 'text/plain',
        kind: 'text',
        localPath: 'C:/repo/.claude-oca/uploads/session-interactive/trace.log',
        size: 42,
        promptVisibility: 'available',
        ocrStatus: 'unavailable',
        uploadedAt: '2026-04-24T00:00:00.000Z'
      }
    ],
    commands: [
      { name: '/tasks', description: 'Manage tasks', category: 'workflow' },
      { name: '/report', description: 'Force report mode', category: 'workflow' },
      { name: '/compact', description: 'Compact session history', category: 'memory' }
    ],
    session: {
      branch: 'main'
    },
    integrations: {
      skills: [],
      mcp: {
        available: false,
        servers: []
      },
      lsp: {
        available: false,
        note: 'Not configured'
      },
      jdMcp: {
        available: true,
        connected: true,
        note: 'Connected to jd-mcp',
        tools: ['analyze_adf_logs'],
        categories: ['reports'],
        toolDescriptors: [
          {
            name: 'analyze_adf_logs',
            description: 'Analyze ADF logs through jd-mcp.',
            source: 'jd-mcp',
            requiresApproval: true,
            category: 'reports',
            producesReports: true,
            enabled: true,
            visibility: 'enabled',
            stability: 'stable'
          }
        ]
      }
    },
    reports: {
      artifacts: [
        {
          id: 'report-interactive',
          requestId: 'req-jd-interactive',
          sessionId: 'session-interactive',
          toolName: 'analyze_adf_logs',
          source: 'jd-mcp',
          kind: 'html-report',
          title: 'ADF Log Review',
          filePath: 'C:/repo/reports/adflr-report.html',
          fileName: 'adflr-report.html',
          createdAt: '2026-04-24T00:00:00.000Z',
          size: 512
        }
      ]
    },
    skippedTools: [],
    reportSuggestion: null
  };
}
