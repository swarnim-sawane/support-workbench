import {
  Bot,
  CheckSquare,
  FilePlus2,
  FolderGit2,
  History,
  MemoryStick,
  PlugZap,
  TerminalSquare,
  X
} from 'lucide-react';
import type { ReactNode } from 'react';
import type { WorkbenchAttachment, WorkbenchSessionSnapshot } from '../types';
import {
  buildAgentSummary,
  buildAttachmentStatus,
  buildIntegrationStatus,
  buildToolDescriptorLabel,
  formatBytes
} from './utils';

type WorkspaceRailProps = {
  snapshot: WorkbenchSessionSnapshot;
  availableAttachments: WorkbenchAttachment[];
  queuedAttachmentIds: string[];
  onQueueAttachment: (attachmentId: string) => void | Promise<void>;
  onUnqueueAttachment: (attachmentId: string) => void | Promise<void>;
  onRemoveAttachment: (attachmentId: string) => void | Promise<void>;
};

export function WorkspaceRail({
  snapshot,
  availableAttachments,
  queuedAttachmentIds,
  onQueueAttachment,
  onUnqueueAttachment,
  onRemoveAttachment
}: WorkspaceRailProps) {
  return (
    <aside className="workspace-rail" aria-label="Workspace">
      <section className="rail-card">
        <div className="rail-title">
          <FolderGit2 size={16} />
          <span>Workspace</span>
        </div>
        <p className="path-text">{snapshot.workspace.cwd || 'Waiting for session...'}</p>
        <div className="metric-grid">
          <Metric label="Status" value={snapshot.status} />
          <Metric label="Branch" value={snapshot.session.branch ?? 'not tracked'} />
          <Metric label="Changed" value={String(snapshot.workspace.changedFiles.length)} />
          <Metric label="Reports" value={String(snapshot.reports.artifacts.length)} />
        </div>
      </section>

      <RailSection icon={<FilePlus2 size={15} />} title="Attachments">
        {availableAttachments.length ? (
          <div className="rail-list">
            {availableAttachments.map((attachment) => {
              const queued = queuedAttachmentIds.includes(attachment.id);
              return (
                <article key={attachment.id} className="rail-item">
                  {attachment.kind === 'image' ? (
                    <img
                      className="attachment-preview"
                      src={`/api/session/${snapshot.sessionId}/attachments/${attachment.id}/content`}
                      alt={attachment.originalName}
                    />
                  ) : null}
                  <strong>{attachment.originalName}</strong>
                  <small>
                    {formatBytes(attachment.size)} - {buildAttachmentStatus(attachment)}
                  </small>
                  {attachment.extractedText ? <p>{attachment.extractedText}</p> : null}
                  <div className="mini-actions">
                    <button
                      type="button"
                      aria-label={
                        queued
                          ? `Unqueue ${attachment.originalName}`
                          : `Queue ${attachment.originalName}`
                      }
                      onClick={() =>
                        queued
                          ? void onUnqueueAttachment(attachment.id)
                          : void onQueueAttachment(attachment.id)
                      }
                    >
                      {queued ? 'Queued' : 'Queue'}
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove attachment ${attachment.originalName}`}
                      onClick={() => void onRemoveAttachment(attachment.id)}
                    >
                      <X size={12} />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="muted-panel">No session attachments yet.</p>
        )}
      </RailSection>

      <RailSection icon={<PlugZap size={15} />} title="Integrations">
        <p className="muted-panel">{buildIntegrationStatus(snapshot)}</p>
        <p className="muted-panel">{snapshot.integrations.jdMcp.note ?? 'No jd-mcp note available.'}</p>
        {snapshot.integrations.jdMcp.toolDescriptors.length ? (
          <div className="tool-cloud">
            {snapshot.integrations.jdMcp.toolDescriptors.map((tool) => (
              <span key={tool.name} title={buildToolDescriptorLabel(tool)}>
                {tool.visibility === 'unsupported' ? `${tool.name} unavailable` : tool.name}
              </span>
            ))}
          </div>
        ) : (
          <p className="muted-panel">No jd-mcp tools loaded</p>
        )}
      </RailSection>

      <RailSection icon={<CheckSquare size={15} />} title="Tasks">
        {snapshot.tasks.length ? (
          <ul className="rail-list compact">
            {snapshot.tasks.map((task) => (
              <li key={task.id}>
                <span>[{task.status === 'completed' ? 'x' : ' '}]</span> {task.content}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-panel">No session tasks yet.</p>
        )}
      </RailSection>

      <RailSection icon={<Bot size={15} />} title="Background Agents">
        {snapshot.agents.length ? (
          <div className="rail-list">
            {snapshot.agents.map((agent) => (
              <article key={agent.id} className="rail-item">
                <strong>{agent.agentType}</strong>
                <small>{agent.status}</small>
                <p>{buildAgentSummary(agent)}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-panel">No background agents yet.</p>
        )}
      </RailSection>

      <RailSection icon={<MemoryStick size={15} />} title="Memory">
        {snapshot.memory.entries.length ? (
          <ul className="rail-list compact">
            {snapshot.memory.entries.map((entry) => (
              <li key={entry.id}>{entry.content}</li>
            ))}
          </ul>
        ) : (
          <p className="muted-panel">No memory entries recorded.</p>
        )}
      </RailSection>

      <RailSection icon={<History size={15} />} title="History">
        {snapshot.history.summaries.length ? (
          <div className="rail-list">
            {snapshot.history.summaries.map((summary) => (
              <article key={summary.id} className="rail-item">
                <strong>{summary.title}</strong>
                <p>{summary.preview}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted-panel">No compacted history yet.</p>
        )}
      </RailSection>

      <RailSection icon={<TerminalSquare size={15} />} title="Commands">
        {snapshot.commands.length ? (
          <ul className="rail-list compact">
            {snapshot.commands.map((command) => (
              <li key={command.name}>
                <strong>{command.name}</strong> {command.description}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted-panel">No command catalog loaded.</p>
        )}
      </RailSection>
    </aside>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

function RailSection({
  icon,
  title,
  children
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="rail-card rail-details" open>
      <summary>
        <span className="rail-title">
          {icon}
          {title}
        </span>
      </summary>
      {children}
    </details>
  );
}
