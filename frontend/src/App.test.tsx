import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import type { WorkbenchSessionSnapshot, WorkbenchUploadItem } from './types';

describe('App', () => {
  afterEach(() => {
    vi.useRealTimers();
    window.history.pushState({}, '', '/');
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

  it('keeps a new report suggestion visible when the session already has report artifacts', () => {
    const noop = vi.fn();
    const onPromptSubmit = vi.fn();
    const snapshot = {
      ...buildInteractiveSnapshot(),
      reportSuggestion: {
        available: true,
        canRun: true,
        suggestedToolName: 'analyze_adf_logs',
        source: 'jd-mcp',
        attachmentIds: ['att-1'],
        input: {
          log_folder: 'C:/repo/.claude-oca/uploads/session-interactive'
        },
        reasonCode: 'builtin_better_for_single_file',
        explanation:
          'This turn used direct file analysis because it gives a better answer for a single attached log. analyze_adf_logs expects a folder and can still be run if you want an HTML report.'
      }
    } as WorkbenchSessionSnapshot;

    renderWorkbench({
      snapshot,
      queuedAttachmentIds: [],
      onPromptSubmit,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    expect(screen.getByText(/why no report\?/i)).toBeInTheDocument();
    expect(screen.getByText(/better answer for a single attached log/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /run jd-mcp report anyway/i }));

    expect(onPromptSubmit).toHaveBeenCalledWith('/report', ['att-1']);
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

  it('shows the active analysis phase and recent progress steps while working', () => {
    const noop = vi.fn();
    renderWorkbench({
      snapshot: {
        ...buildInteractiveSnapshot(),
        status: 'running',
        messages: [
          {
            id: 'user-progress',
            role: 'user',
            content: 'Analyze these uploaded logs'
          }
        ],
        toolActivity: [],
        progressActivity: [
          {
            id: 'progress-thinking',
            phase: 'model.thinking',
            label: 'Analyzing uploaded evidence',
            detail: '3 files selected',
            status: 'running',
            startedAt: '2026-04-24T00:00:02.000Z'
          },
          {
            id: 'progress-classifying',
            phase: 'attachments.classifying',
            label: 'Classifying uploaded files',
            detail: '2 logs, 1 text file',
            status: 'completed',
            startedAt: '2026-04-24T00:00:01.000Z',
            completedAt: '2026-04-24T00:00:02.000Z'
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

    expect(screen.getByText('Analyzing uploaded evidence - 3 files selected')).toBeInTheDocument();
    expect(screen.getByText('Classifying uploaded files - 2 logs, 1 text file')).toBeInTheDocument();
    expect(screen.queryByText('Preparing answer')).not.toBeInTheDocument();
  });

  it('shows progress-only processing even before assistant text is available', () => {
    const noop = vi.fn();
    renderWorkbench({
      snapshot: {
        ...buildInteractiveSnapshot(),
        status: 'running',
        messages: [],
        tasks: [],
        memory: {
          entries: []
        },
        history: {
          summaries: []
        },
        agents: [],
        toolActivity: [],
        reports: {
          artifacts: []
        },
        progressActivity: [
          {
            id: 'progress-analysis',
            phase: 'model.thinking',
            label: 'Analyzing uploaded evidence',
            detail: '8 files selected',
            status: 'running',
            startedAt: '2026-04-24T00:00:02.000Z'
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

    expect(
      screen.getByRole('status', { name: /analyzing uploaded evidence/i })
    ).toBeInTheDocument();
    expect(screen.getByText('Analyzing uploaded evidence - 8 files selected')).toBeInTheDocument();
    expect(screen.queryByText(/drop a file, ask a question/i)).not.toBeInTheDocument();
  });

  it('keeps terminal processing state visible after a blocked or completed turn', () => {
    const noop = vi.fn();
    const blockedSnapshot = {
      ...buildInteractiveSnapshot(),
      status: 'blocked',
      messages: [
        {
          id: 'user-blocked',
          role: 'user',
          content: 'Analyze the uploaded logs'
        }
      ],
      progressActivity: [
        {
          id: 'progress-analysis-blocked',
          phase: 'model.thinking',
          label: 'Analyzing uploaded evidence',
          detail: 'blocked by analyzer failure',
          status: 'completed',
          startedAt: '2026-04-24T00:00:01.000Z',
          completedAt: '2026-04-24T00:00:05.000Z'
        }
      ],
      toolActivity: [
        {
          requestId: 'req-blocked',
          toolUseId: 'tool-blocked',
          toolName: 'analyze_adf_logs',
          source: 'jd-mcp',
          status: 'failed',
          input: {
            log_folder: 'C:/repo/.claude-oca/uploads/session-1'
          },
          error: 'Analyzer exited before producing diagnostics',
          startedAt: '2026-04-24T00:00:02.000Z',
          completedAt: '2026-04-24T00:00:05.000Z'
        }
      ]
    } as WorkbenchSessionSnapshot;

    const { rerender } = renderWorkbench({
      snapshot: blockedSnapshot,
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    expect(screen.getByRole('status', { name: /processing blocked/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Analyzer exited before producing diagnostics/i).length).toBeGreaterThan(0);

    rerender(
      <App
        snapshot={{
          ...blockedSnapshot,
          status: 'completed',
          messages: [
            ...blockedSnapshot.messages,
            {
              id: 'assistant-final',
              role: 'assistant',
              content: 'Root cause: the managed server returned HTTP 500 during checkout.'
            }
          ],
          toolActivity: blockedSnapshot.toolActivity.map((activity) => ({
            ...activity,
            status: 'completed',
            summary: 'Correlated access and catalina logs'
          }))
        }}
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

    expect(screen.getByRole('status', { name: /analysis complete/i })).toBeInTheDocument();
    expect(screen.getByText(/Root cause: the managed server returned HTTP 500/i)).toBeInTheDocument();
  });

  it('uses human readable Codex-style labels for active file inspection', () => {
    const noop = vi.fn();
    renderWorkbench({
      snapshot: {
        ...buildInteractiveSnapshot(),
        status: 'running',
        messages: [
          {
            id: 'user-progress-tools',
            role: 'user',
            content: 'Analyze all uploaded logs'
          }
        ],
        progressActivity: [
          {
            id: 'progress-thinking',
            phase: 'model.thinking',
            label: 'Analyzing uploaded evidence',
            detail: '12 files selected',
            status: 'running',
            startedAt: '2026-04-24T00:00:02.000Z'
          },
          {
            id: 'progress-classifying',
            phase: 'attachments.classifying',
            label: 'Classifying uploaded files',
            detail: '12 log files',
            status: 'completed',
            startedAt: '2026-04-24T00:00:01.000Z',
            completedAt: '2026-04-24T00:00:02.000Z'
          }
        ],
        toolActivity: [
          {
            requestId: 'req-read-running',
            toolUseId: 'tool-read-running',
            toolName: 'Read',
            source: 'builtin',
            status: 'running',
            input: {
              file_path:
                'C:/repo/.claude-oca/uploads/session-1/AVBCS-41519_vm2_catalina_new.log'
            },
            startedAt: '2026-04-24T00:00:04.000Z'
          },
          {
            requestId: 'req-read-completed-1',
            toolUseId: 'tool-read-completed-1',
            toolName: 'Read',
            source: 'builtin',
            status: 'completed',
            input: {
              file_path: 'C:/repo/.claude-oca/uploads/session-1/AVBCS-41519_vm1_access.log'
            },
            summary: 'Read AVBCS-41519_vm1_access.log',
            startedAt: '2026-04-24T00:00:02.000Z',
            completedAt: '2026-04-24T00:00:03.000Z'
          },
          {
            requestId: 'req-read-completed-2',
            toolUseId: 'tool-read-completed-2',
            toolName: 'Read',
            source: 'builtin',
            status: 'completed',
            input: {
              file_path: 'C:/repo/.claude-oca/uploads/session-1/AVBCS-41519_vm2_access.log'
            },
            summary: 'Read AVBCS-41519_vm2_access.log',
            startedAt: '2026-04-24T00:00:03.000Z',
            completedAt: '2026-04-24T00:00:04.000Z'
          },
          {
            requestId: 'req-grep-completed',
            toolUseId: 'tool-grep-completed',
            toolName: 'Grep',
            source: 'builtin',
            category: 'search',
            status: 'completed',
            input: {
              pattern: 'ERROR|Exception',
              glob: '**/*.log'
            },
            summary: 'Found matching errors',
            startedAt: '2026-04-24T00:00:03.000Z',
            completedAt: '2026-04-24T00:00:04.000Z'
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

    expect(
      screen.getByRole('status', { name: /analyzing uploaded evidence/i })
    ).toBeInTheDocument();
    expect(screen.getAllByText(/Reading AVBCS-41519_vm2_catalina_new\.log/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Read 2 files/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Searched uploaded logs/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Running Read$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^Running Grep$/i)).not.toBeInTheDocument();
  });

  it('renders a case evidence ledger with inferred log groups and LogScan coverage', async () => {
    const user = userEvent.setup();
    const noop = vi.fn();
    const snapshot = {
      ...buildInteractiveSnapshot(),
      attachments: [
        buildTextAttachment('att-old-access', 'vm1_access_old.log'),
        buildTextAttachment('att-new-access', 'vm1_access_new.log'),
        buildTextAttachment('att-catalina', 'vm2_catalina_new.log'),
        buildTextAttachment('att-readme', 'readme.txt')
      ],
      toolActivity: [
        {
          requestId: 'req-logscan',
          toolUseId: 'tool-logscan',
          toolName: 'LogScan',
          source: 'builtin',
          status: 'completed',
          input: {
            file_paths: ['vm1_access_old.log', 'vm2_catalina_new.log']
          },
          summary:
            'LogScan scanned 2 file(s), 2103 line(s); found 17 error(s), 1 severe event(s), 2 HTTP 5xx, and 9 slow request(s).',
          metadata: {
            scanned_entire_files: true,
            returned_examples_are_capped: true,
            scanned_files: 2,
            totals: {
              lines: 2103,
              error: 17,
              warn: 42,
              severe: 1,
              http_5xx: 2,
              slow_requests: 9
            },
            cross_file: {
              shared_identifiers: [
                {
                  key: 'ECID',
                  value: 'abc',
                  count: 4,
                  files: ['vm1_access_old.log', 'vm2_catalina_new.log']
                }
              ]
            }
          },
          startedAt: '2026-04-24T00:00:00.000Z',
          completedAt: '2026-04-24T00:00:01.000Z'
        }
      ]
    } as WorkbenchSessionSnapshot;

    renderWorkbench({
      snapshot,
      queuedAttachmentIds: ['att-new-access', 'att-catalina'],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    await user.click(screen.getByRole('tab', { name: /case/i }));

    expect(screen.getByRole('heading', { name: /case evidence/i })).toBeInTheDocument();
    expect(screen.getByText('4 uploaded')).toBeInTheDocument();
    expect(screen.getByText('2 queued')).toBeInTheDocument();
    expect(screen.getByText('1 report')).toBeInTheDocument();
    expect(screen.getByText('Access logs')).toBeInTheDocument();
    expect(screen.getByText('Catalina logs')).toBeInTheDocument();
    expect(screen.getByText('Unclassified')).toBeInTheDocument();
    expect(screen.getByText('vm1')).toBeInTheDocument();
    expect(screen.getByText('vm2')).toBeInTheDocument();
    expect(screen.getByText('Old capture')).toBeInTheDocument();
    expect(screen.getByText('New capture')).toBeInTheDocument();
    expect(screen.getByText('Scanned 2 logs')).toBeInTheDocument();
    expect(screen.getByText('2,103 lines')).toBeInTheDocument();
    expect(screen.getByText('17 errors')).toBeInTheDocument();
    expect(screen.getByText('42 warnings')).toBeInTheDocument();
    expect(screen.getByText('2 HTTP 5xx')).toBeInTheDocument();
    expect(screen.getByText('9 slow requests')).toBeInTheDocument();
    expect(screen.getByText('1 shared identifier')).toBeInTheDocument();
    expect(screen.getByText(/examples capped/i)).toBeInTheDocument();
    expect(screen.queryByText(/raw metadata/i)).not.toBeInTheDocument();
  });

  it('shows recoverable LogScan failures as case recovery state', async () => {
    const user = userEvent.setup();
    const noop = vi.fn();

    renderWorkbench({
      snapshot: {
        ...buildInteractiveSnapshot(),
        status: 'running',
        messages: [
          {
            id: 'user-recovery',
            role: 'user',
            content: 'Analyze the uploaded logs'
          }
        ],
        toolActivity: [
          {
            requestId: 'req-recovery',
            toolUseId: 'tool-recovery',
            toolName: 'LogScan',
            source: 'builtin',
            status: 'failed',
            input: {
              file_paths: ['vm1_access_old.log']
            },
            error: 'LogScan requires at least one matching file path or glob',
            recoverable: true,
            recoveryAttempt: 1,
            recoveryInstruction: 'Retry with exact uploaded file paths.'
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

    await user.click(screen.getByRole('tab', { name: /case/i }));

    expect(screen.getByText(/recovery in progress/i)).toBeInTheDocument();
    expect(screen.getAllByText(/logscan/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Retry with exact uploaded file paths.')).toBeInTheDocument();
    expect(screen.queryByText(/terminal failure/i)).not.toBeInTheDocument();
  });

  it('shows multi-file queued attachments as horizontal composer chips without losing behavior', async () => {
    const user = userEvent.setup();
    const onPromptSubmit = vi.fn();
    const onUnqueueAttachment = vi.fn();
    const noop = vi.fn();

    renderWorkbench({
      snapshot: {
        ...buildInteractiveSnapshot(),
        attachments: [
          buildTextAttachment('att-old-access', 'vm1_access_old.log'),
          buildTextAttachment('att-new-access', 'vm1_access_new.log'),
          buildTextAttachment('att-catalina', 'vm2_catalina_new.log')
        ]
      },
      queuedAttachmentIds: ['att-old-access', 'att-new-access', 'att-catalina'],
      onPromptSubmit,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment
    });

    expect(screen.queryByText(/files queued as one case/i)).not.toBeInTheDocument();
    const oldAccessChip = screen.getByRole('button', { name: /remove queued attachment vm1_access_old\.log/i });
    expect(oldAccessChip.closest('.composer-attachment-tray')).toHaveClass('is-horizontal');
    expect(screen.getByRole('button', { name: /remove queued attachment vm1_access_new\.log/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /remove queued attachment vm2_catalina_new\.log/i }));
    expect(onUnqueueAttachment).toHaveBeenCalledWith('att-catalina');

    fireEvent.change(screen.getByPlaceholderText(/message support workbench/i), {
      target: { value: 'Analyze queued logs as one case' }
    });
    fireEvent.click(screen.getByRole('button', { name: /send prompt/i }));

    expect(onPromptSubmit).toHaveBeenCalledWith('Analyze queued logs as one case', [
      'att-old-access',
      'att-new-access',
      'att-catalina'
    ]);
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
    expect(screen.getByText(/working for/i)).toBeInTheDocument();
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

  it('shows active upload progress and moves failed uploads to a temporary toast', () => {
    vi.useFakeTimers();
    const noop = vi.fn();
    const uploadItems: WorkbenchUploadItem[] = [
      {
        id: 'upload-trace',
        name: 'trace.log',
        size: 2048,
        stage: 'uploading',
        progress: 42,
        message: 'Uploading 42%'
      },
      {
        id: 'upload-image',
        name: 'error.png',
        size: 1024,
        stage: 'processing',
        progress: 100,
        message: 'Processing OCR and indexing'
      },
      {
        id: 'upload-broken',
        name: 'broken.zip',
        size: 4096,
        stage: 'failed',
        progress: 100,
        error: 'Unsupported attachment type: broken.zip'
      }
    ];
    const snapshot = {
      ...buildInteractiveSnapshot(),
      attachments: [
        {
          id: 'att-ready',
          originalName: 'ready.log',
          storedName: 'ready.log',
          mediaType: 'text/plain',
          kind: 'text',
          localPath: 'C:/repo/.claude-oca/uploads/session-interactive/ready.log',
          size: 42,
          promptVisibility: 'available',
          ocrStatus: 'unavailable',
          uploadedAt: '2026-04-24T00:00:00.000Z'
        },
        {
          id: 'att-ocr-ready',
          originalName: 'ocr-ready.png',
          storedName: 'ocr-ready.png',
          mediaType: 'image/png',
          kind: 'image',
          localPath: 'C:/repo/.claude-oca/uploads/session-interactive/ocr-ready.png',
          size: 128,
          promptVisibility: 'available',
          ocrStatus: 'completed',
          extractedText: 'HTTP 500 on localhost',
          uploadedAt: '2026-04-24T00:00:00.000Z'
        },
        {
          id: 'att-ocr-failed',
          originalName: 'ocr-failed.png',
          storedName: 'ocr-failed.png',
          mediaType: 'image/png',
          kind: 'image',
          localPath: 'C:/repo/.claude-oca/uploads/session-interactive/ocr-failed.png',
          size: 128,
          promptVisibility: 'available',
          ocrStatus: 'failed',
          ocrError: 'Windows OCR engine unavailable.',
          uploadedAt: '2026-04-24T00:00:00.000Z'
        }
      ]
    } as unknown as WorkbenchSessionSnapshot;

    renderWorkbench({
      snapshot,
      uploadItems,
      queuedAttachmentIds: [],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    const uploadStatus = screen.getByRole('status', { name: /uploading 1 file, processing 1 file/i });
    expect(uploadStatus.closest('.composer-box')).toBeTruthy();
    expect(within(uploadStatus).getByText('trace.log')).toBeInTheDocument();
    expect(within(uploadStatus).getByText(/uploading 42%/i)).toBeInTheDocument();
    expect(
      within(uploadStatus).getByRole('progressbar', { name: /trace\.log upload progress/i })
    ).toHaveAttribute('value', '42');
    expect(within(uploadStatus).getByText(/processing OCR and indexing/i)).toBeInTheDocument();
    expect(within(uploadStatus).queryByText(/unsupported attachment type: broken\.zip/i)).not.toBeInTheDocument();
    const failedToast = screen.getByRole('alert');
    expect(within(failedToast).getByText('broken.zip')).toBeInTheDocument();
    expect(within(failedToast).getByText(/unsupported attachment type: broken\.zip/i)).toBeInTheDocument();
    expect(screen.getByText(/ready for analysis/i)).toBeInTheDocument();
    expect(screen.getByText(/OCR ready/i)).toBeInTheDocument();
    expect(screen.getByText(/OCR failed/i)).toBeInTheDocument();
    expect(screen.getByText(/Windows OCR engine unavailable/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6000);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('hides completed upload confirmation while keeping queued files in the composer', () => {
    const noop = vi.fn();
    const uploadItems: WorkbenchUploadItem[] = [
      {
        id: 'upload-ready-1',
        name: 'vm1_access.log',
        size: 2048,
        stage: 'ready',
        progress: 100,
        message: 'Ready for analysis'
      },
      {
        id: 'upload-ready-2',
        name: 'vm2_access.log',
        size: 4096,
        stage: 'ready',
        progress: 100,
        message: 'Ready for analysis'
      }
    ];
    const snapshot = {
      ...buildInteractiveSnapshot(),
      attachments: [
        {
          id: 'att-vm1',
          originalName: 'vm1_access.log',
          storedName: 'vm1_access.log',
          mediaType: 'text/plain',
          kind: 'text',
          localPath: 'C:/repo/.claude-oca/uploads/session-interactive/vm1_access.log',
          size: 2048,
          promptVisibility: 'available',
          ocrStatus: 'unavailable',
          uploadedAt: '2026-04-24T00:00:00.000Z'
        },
        {
          id: 'att-vm2',
          originalName: 'vm2_access.log',
          storedName: 'vm2_access.log',
          mediaType: 'text/plain',
          kind: 'text',
          localPath: 'C:/repo/.claude-oca/uploads/session-interactive/vm2_access.log',
          size: 4096,
          promptVisibility: 'available',
          ocrStatus: 'unavailable',
          uploadedAt: '2026-04-24T00:00:00.000Z'
        }
      ]
    } as WorkbenchSessionSnapshot;

    renderWorkbench({
      snapshot,
      uploadItems,
      queuedAttachmentIds: ['att-vm1', 'att-vm2'],
      onPromptSubmit: noop,
      onApprove: noop,
      onAttachFiles: noop,
      onRemoveAttachment: noop,
      onQueueAttachment: noop,
      onUnqueueAttachment: noop
    });

    expect(screen.queryByRole('status', { name: /ready/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/2 files ready/i)).not.toBeInTheDocument();
    const vm1Chip = screen.getByRole('button', { name: /remove queued attachment vm1_access\.log/i });
    expect(vm1Chip.closest('.composer-box')).toBeTruthy();
    expect(vm1Chip.closest('.composer-attachment-tray')).toHaveClass('is-horizontal');
    expect(screen.getByRole('button', { name: /remove queued attachment vm2_access\.log/i })).toBeInTheDocument();
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

    await user.click(screen.getByText(/analyzed logs/i));
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
    expect(screen.getAllByText('/commands').length).toBeGreaterThan(0);
    expect(screen.getAllByText('/report').length).toBeGreaterThan(0);
    expect(screen.queryByText('/auto-triage')).not.toBeInTheDocument();
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
    expect(screen.getByText('/commands')).toBeInTheDocument();
    expect(screen.queryByText('/auto-triage')).not.toBeInTheDocument();
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

  it('marks the chat frame to fill the space between the sidebar and workspace', async () => {
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

    const main = screen.getByRole('main');
    expect(main).toHaveClass('shell-main');
    expect(main).toHaveAttribute('data-workspace-layout', 'open');
    expect(screen.getByRole('complementary', { name: /workspace/i })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /hide workspace/i }));
    expect(main).toHaveAttribute('data-workspace-layout', 'closed');
    expect(screen.queryByRole('complementary', { name: /workspace/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show workspace/i }));
    expect(main).toHaveAttribute('data-workspace-layout', 'open');
    expect(screen.getByRole('complementary', { name: /workspace/i })).toBeInTheDocument();
  });
});

type RenderWorkbenchInput = {
  snapshot: WorkbenchSessionSnapshot;
  sessions?: ComponentProps<typeof App>['sessions'];
  activeSessionId?: string | null;
  uploadItems?: WorkbenchUploadItem[];
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
      uploadItems={input.uploadItems}
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

function buildTextAttachment(id: string, originalName: string): WorkbenchSessionSnapshot['attachments'][number] {
  return {
    id,
    originalName,
    storedName: originalName,
    mediaType: 'text/plain',
    kind: 'text',
    localPath: `C:/repo/.claude-oca/uploads/session-interactive/${originalName}`,
    size: 128,
    promptVisibility: 'available',
    ocrStatus: 'unavailable',
    uploadedAt: '2026-04-24T00:00:00.000Z'
  };
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
    progressActivity: [],
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
