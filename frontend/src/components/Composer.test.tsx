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
    const specializedTools = screen.getByRole('button', { name: /specialized tools/i });
    const fileDivider = view.container.querySelector('.composer-attachment-divider');

    expect(fileDivider).toBeTruthy();
    expectElementToPrecede(fileControls, fileDivider as Element);
    expectElementToPrecede(fileDivider as Element, attachedFile);
    expectElementToPrecede(attachedFile, prompt);
    expectElementToPrecede(prompt, specializedTools);
  });

  it('opens specialized tools and submits the selected report tool with matching attachments', () => {
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
    expect(screen.getByRole('button', { name: /send prompt/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /specialized tools/i }));
    const picker = screen.getByRole('dialog', { name: /specialized tools/i });
    expect(within(picker).getByRole('button', { name: /access logs/i })).toBeInTheDocument();

    fireEvent.click(within(picker).getByRole('button', { name: /access logs/i }));

    expect(screen.getByText(/specialized: access logs/i)).toBeInTheDocument();
    expect(onRunJdMcpTool).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /send prompt/i })).toBeEnabled();

    fireEvent.click(screen.getByRole('button', { name: /send prompt/i }));

    expect(onRunJdMcpTool).toHaveBeenCalledWith({
      toolName: 'analyze_access_logs',
      label: 'Access logs',
      attachmentIds: ['att-log']
    });
    expect(onPromptSubmit).not.toHaveBeenCalled();
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
