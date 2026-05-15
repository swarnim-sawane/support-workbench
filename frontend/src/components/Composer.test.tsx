import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Composer } from './Composer';
import type { WorkbenchAttachment, WorkbenchIntegrationSnapshot } from '../types';

describe('Composer', () => {
  it('selects all eligible chat files and clears selected files from the attachment tray', () => {
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
        onAttachFiles={vi.fn()}
        onQueueAttachment={onQueueAttachment}
        onUnqueueAttachment={onUnqueueAttachment}
        onDragEnterFiles={vi.fn()}
        onDragLeaveFiles={vi.fn()}
        onDragOverFiles={vi.fn()}
        onDropFiles={vi.fn()}
      />
    );

    expect(screen.getByText(/1 of 2 files selected/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /select all eligible chat files/i }));
    expect(onQueueAttachment).toHaveBeenCalledTimes(1);
    expect(onQueueAttachment).toHaveBeenCalledWith('att-access');
    expect(onQueueAttachment).not.toHaveBeenCalledWith('att-removed');

    fireEvent.click(screen.getByRole('button', { name: /deselect all selected chat files/i }));
    expect(onUnqueueAttachment).toHaveBeenCalledWith('att-trace');
  });

  it('shows JD MCP composer actions and submits the selected tool with matching attachments', () => {
    const onRunJdMcpTool = vi.fn();
    render(
      <Composer
        draft=""
        setDraft={vi.fn()}
        status="idle"
        isSubmitting={false}
        isDraggingFiles={false}
        uploadItems={[]}
        availableAttachments={[
          attachment('att-har', 'checkout.har'),
          attachment('att-log', 'DefaultServer-diagnostic.log')
        ]}
        queuedAttachments={[
          attachment('att-har', 'checkout.har'),
          attachment('att-log', 'DefaultServer-diagnostic.log')
        ]}
        queuedAttachmentIds={['att-har', 'att-log']}
        jdMcp={buildJdMcpSnapshot(['analyze_har_file', 'correlate_har_with_logs'])}
        textareaRef={createRef<HTMLTextAreaElement>()}
        onPromptSubmit={vi.fn()}
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

    expect(screen.getByText(/analyze with jd mcp/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /correlate har with logs/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /correlate har with logs/i }));

    expect(onRunJdMcpTool).toHaveBeenCalledWith({
      toolName: 'correlate_har_with_logs',
      label: 'Correlate HAR with logs',
      attachmentIds: ['att-har', 'att-log']
    });
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

function buildJdMcpSnapshot(tools: string[]): WorkbenchIntegrationSnapshot['jdMcp'] {
  return {
    available: true,
    connected: true,
    note: 'Connected to jd-mcp',
    tools,
    categories: ['diagnostics'],
    toolDescriptors: tools.map((name) => ({
      name,
      description: `${name} description`,
      source: 'jd-mcp',
      requiresApproval: true,
      category: 'diagnostics',
      producesReports: false,
      enabled: true,
      visibility: 'enabled',
      stability: 'stable'
    }))
  };
}
