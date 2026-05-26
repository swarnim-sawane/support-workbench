import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';
import type { WorkbenchAttachment, WorkbenchIntegrationSnapshot } from '../types';

describe('Composer', () => {
  afterEach(() => {
    cleanup();
  });

  it('adds all eligible workspace files to chat and clears selected files from the attachment tray', () => {
    const onQueueAttachment = vi.fn();
    const onUnqueueAttachment = vi.fn();
    const traceLog = attachment('att-trace', 'trace.log');
    const accessLog = attachment('att-access', 'access.log');
    const removedLog = attachment('att-removed', 'removed.log', { promptVisibility: 'removed' });

    render(
      <Composer
        draft=""
        setDraft={vi.fn()}
        status="idle"
        isSubmitting={false}
        isDraggingFiles={false}
        uploadItems={[]}
        availableAttachments={[traceLog, accessLog, removedLog]}
        queuedAttachments={[traceLog]}
        queuedAttachmentIds={['att-trace']}
        textareaRef={createRef<HTMLTextAreaElement>()}
        onPromptSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onAttachFiles={vi.fn()}
        onQueueAttachment={onQueueAttachment}
        onUnqueueAttachment={onUnqueueAttachment}
        onDragEnterFiles={vi.fn()}
        onDragLeaveFiles={vi.fn()}
        onDragOverFiles={vi.fn()}
        onDropFiles={vi.fn()}
      />
    );

    expect(screen.getByText('Files 1/2')).toBeInTheDocument();
    expect(screen.queryByText(/add files to chat before asking for analysis/i)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^add all$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^remove all$/i })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add all workspace files to chat/i }));
    expect(onQueueAttachment).toHaveBeenCalledTimes(1);
    expect(onQueueAttachment).toHaveBeenCalledWith('att-access');
    expect(onQueueAttachment).not.toHaveBeenCalledWith('att-removed');

    fireEvent.click(screen.getByRole('button', { name: /remove all files from chat/i }));
    expect(onUnqueueAttachment).toHaveBeenCalledWith('att-trace');
  });

  it('keeps file controls separated from attached files above the prompt', () => {
    const traceLog = attachment('att-trace', 'trace.log');
    const accessLog = attachment('att-access', 'access.log');

    const view = render(
      <Composer
        draft=""
        setDraft={vi.fn()}
        status="idle"
        isSubmitting={false}
        isDraggingFiles={false}
        uploadItems={[]}
        availableAttachments={[traceLog, accessLog]}
        queuedAttachments={[traceLog]}
        queuedAttachmentIds={['att-trace']}
        jdMcp={buildJdMcpSnapshot(['analyze_access_logs'])}
        textareaRef={createRef<HTMLTextAreaElement>()}
        onPromptSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onAttachFiles={vi.fn()}
        onQueueAttachment={vi.fn()}
        onUnqueueAttachment={vi.fn()}
        onRunJdMcpTool={vi.fn()}
        onDragEnterFiles={vi.fn()}
        onDragLeaveFiles={vi.fn()}
        onDragOverFiles={vi.fn()}
        onDropFiles={vi.fn()}
      />
    );

    const attachedFile = screen.getByText('trace.log');
    const prompt = screen.getByPlaceholderText(/message support workbench/i);
    const fileControls = screen.getByText('Files 1/2');
    const fileDivider = view.container.querySelector('.composer-attachment-divider');

    expect(fileDivider).toBeTruthy();
    expectElementToPrecede(fileControls, fileDivider as Element);
    expectElementToPrecede(fileDivider as Element, attachedFile);
    expectElementToPrecede(attachedFile, prompt);
    expect(screen.queryByRole('button', { name: /focus analysis/i })).not.toBeInTheDocument();
  });

  it('offers a quick Analyse action for queued files and submits them for diagnosis', () => {
    const onPromptSubmit = vi.fn();
    const traceLog = attachment('att-trace', 'trace.log');

    const view = render(
      <Composer
        draft=""
        setDraft={vi.fn()}
        status="idle"
        isSubmitting={false}
        isDraggingFiles={false}
        uploadItems={[]}
        availableAttachments={[traceLog]}
        queuedAttachments={[traceLog]}
        queuedAttachmentIds={['att-trace']}
        textareaRef={createRef<HTMLTextAreaElement>()}
        onPromptSubmit={onPromptSubmit}
        onCancelTurn={vi.fn()}
        onAttachFiles={vi.fn()}
        onQueueAttachment={vi.fn()}
        onUnqueueAttachment={vi.fn()}
        onDragEnterFiles={vi.fn()}
        onDragLeaveFiles={vi.fn()}
        onDragOverFiles={vi.fn()}
        onDropFiles={vi.fn()}
      />
    );

    const analyseAction = screen.getByRole('button', { name: /analyse attached files/i });
    const quickActions = view.container.querySelector('.composer-quick-actions');
    const composerBox = view.container.querySelector('.composer-box');

    expect(quickActions?.parentElement).toHaveClass('composer-shell');
    expectElementToPrecede(quickActions as Element, composerBox as Element);

    fireEvent.click(analyseAction);

    expect(onPromptSubmit).toHaveBeenCalledTimes(1);
    expect(onPromptSubmit).toHaveBeenCalledWith(
      expect.stringContaining('Analyse the attached file'),
      ['att-trace']
    );
  });

  it('hides the quick Analyse action when no files are queued or the user is typing', () => {
    const traceLog = attachment('att-trace', 'trace.log');
    const baseProps = {
      status: 'idle' as const,
      isSubmitting: false,
      isDraggingFiles: false,
      uploadItems: [],
      availableAttachments: [traceLog],
      textareaRef: createRef<HTMLTextAreaElement>(),
      onPromptSubmit: vi.fn(),
      onCancelTurn: vi.fn(),
      onAttachFiles: vi.fn(),
      onQueueAttachment: vi.fn(),
      onUnqueueAttachment: vi.fn(),
      onDragEnterFiles: vi.fn(),
      onDragLeaveFiles: vi.fn(),
      onDragOverFiles: vi.fn(),
      onDropFiles: vi.fn()
    };

    const { rerender } = render(
      <Composer
        {...baseProps}
        draft=""
        setDraft={vi.fn()}
        queuedAttachments={[]}
        queuedAttachmentIds={[]}
      />
    );

    expect(screen.queryByRole('button', { name: /analyse attached files/i })).not.toBeInTheDocument();

    rerender(
      <Composer
        {...baseProps}
        draft="check this"
        setDraft={vi.fn()}
        queuedAttachments={[traceLog]}
        queuedAttachmentIds={['att-trace']}
      />
    );

    expect(screen.queryByRole('button', { name: /analyse attached files/i })).not.toBeInTheDocument();
  });

  it('opens focus analysis only for matching attachments and submits the selected analyzer', () => {
    const onRunJdMcpTool = vi.fn();
    const onPromptSubmit = vi.fn();
    render(
      <Composer
        draft=""
        setDraft={vi.fn()}
        status="idle"
        isSubmitting={false}
        isDraggingFiles={false}
        uploadItems={[]}
        availableAttachments={[
          attachment('att-log', 'access.log'),
          attachment('att-adf', 'DefaultServer-diagnostic.log')
        ]}
        queuedAttachments={[
          attachment('att-log', 'access.log'),
          attachment('att-adf', 'DefaultServer-diagnostic.log')
        ]}
        queuedAttachmentIds={['att-log', 'att-adf']}
        jdMcp={buildJdMcpSnapshot(['analyze_access_logs', 'analyze_adf_logs'])}
        textareaRef={createRef<HTMLTextAreaElement>()}
        onPromptSubmit={onPromptSubmit}
        onCancelTurn={vi.fn()}
        onAttachFiles={vi.fn()}
        onQueueAttachment={vi.fn()}
        onUnqueueAttachment={vi.fn()}
        onRunJdMcpTool={onRunJdMcpTool}
        onDragEnterFiles={vi.fn()}
        onDragLeaveFiles={vi.fn()}
        onDragOverFiles={vi.fn()}
        onDropFiles={vi.fn()}
      />
    );

    expect(screen.queryByText(/analyze with jd mcp/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /focus analysis/i })).toHaveTextContent('Focus');
    expect(screen.getByRole('button', { name: /send prompt/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /focus analysis/i }));
    const picker = screen.getByRole('dialog', { name: /focus analysis/i });
    expect(within(picker).getByText(/choose a focused analyzer/i)).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: /access logs/i })).toBeInTheDocument();
    expect(within(picker).getByRole('button', { name: /adf diagnostic logs/i })).toBeInTheDocument();
    expect(within(picker).queryByText(/auto uses/i)).not.toBeInTheDocument();
    expect(within(picker).queryByText(/unavailable tools/i)).not.toBeInTheDocument();
    expect(within(picker).queryByText(/other analyzers/i)).not.toBeInTheDocument();

    fireEvent.click(within(picker).getByRole('button', { name: /access logs/i }));

    expect(screen.getByText(/focus: access logs/i)).toBeInTheDocument();
    expect(onRunJdMcpTool).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /send prompt/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /send prompt/i }));

    expect(onRunJdMcpTool).toHaveBeenCalledWith({
      toolName: 'analyze_access_logs',
      label: 'Access logs',
      prompt: 'Analyse the selected files.',
      attachmentIds: ['att-log']
    });
    expect(onPromptSubmit).not.toHaveBeenCalled();
  });

  it('hides analysis controls when no focused analyzers match the current files', () => {
    render(
      <Composer
        draft=""
        setDraft={vi.fn()}
        status="idle"
        isSubmitting={false}
        isDraggingFiles={false}
        uploadItems={[]}
        availableAttachments={[]}
        queuedAttachments={[]}
        queuedAttachmentIds={[]}
        jdMcp={buildJdMcpSnapshot(['analyze_access_logs', 'analyze_adf_logs'])}
        textareaRef={createRef<HTMLTextAreaElement>()}
        onPromptSubmit={vi.fn()}
        onCancelTurn={vi.fn()}
        onAttachFiles={vi.fn()}
        onQueueAttachment={vi.fn()}
        onUnqueueAttachment={vi.fn()}
        onRunJdMcpTool={vi.fn()}
        onDragEnterFiles={vi.fn()}
        onDragLeaveFiles={vi.fn()}
        onDragOverFiles={vi.fn()}
        onDropFiles={vi.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: /focus analysis/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /focus analysis/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/other analyzers/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/needs matching evidence/i)).not.toBeInTheDocument();
  });
});

function attachment(
  id: string,
  originalName: string,
  overrides: Partial<WorkbenchAttachment> = {}
): WorkbenchAttachment {
  return {
    id,
    originalName,
    storedName: originalName,
    mediaType: 'text/plain',
    kind: 'text',
    localPath: `C:/repo/uploads/${originalName}`,
    size: 128,
    promptVisibility: 'available',
    ocrStatus: 'unavailable',
    uploadedAt: '2026-05-14T00:00:00.000Z',
    ...overrides
  };
}

function expectElementToPrecede(first: Element, second: Element): void {
  expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
}

function buildJdMcpSnapshot(tools: string[]): WorkbenchIntegrationSnapshot['jdMcp'] {
  return {
    available: true,
    connected: true,
    note: 'Connected to specialized tools',
    tools,
    categories: ['diagnostics'],
    toolDescriptors: tools.map((name) => ({
      name,
      description: `${name} description`,
      source: 'jd-mcp',
      requiresApproval: true,
      category: 'diagnostics',
      producesReports: true,
      enabled: true,
      visibility: 'enabled',
      stability: 'stable'
    }))
  };
}
