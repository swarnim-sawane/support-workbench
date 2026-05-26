import { Command, FileText, Keyboard, SlidersHorizontal, Sparkles, Upload, X } from 'lucide-react';
import { friendlyJdMcpStatus } from '../jdMcpWorkflows';
import type { WorkbenchCommandInfo, WorkbenchIntegrationSnapshot } from '../types';
import { formatSpecializedToolText } from './utils';

type HelpDrawerProps = {
  open: boolean;
  commands: WorkbenchCommandInfo[];
  jdMcp?: WorkbenchIntegrationSnapshot['jdMcp'];
  onClose: () => void;
};

const keyboardShortcuts = [
  ['/', 'commands'],
  ['Enter', 'send'],
  ['Shift+Enter', 'newline'],
  ['Esc', 'dismiss']
];

export function HelpDrawer({ open, commands, jdMcp, onClose }: HelpDrawerProps) {
  if (!open) {
    return null;
  }

  const groupedCommands = groupCommands(commands);
  const jdMcpDescriptors = jdMcp?.toolDescriptors ?? [];

  return (
    <div className="help-backdrop" role="presentation" onMouseDown={onClose}>
      <aside
        className="help-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Quick help"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="help-drawer-head">
          <span className="help-title-icon" aria-hidden="true">
            <Sparkles size={17} />
          </span>
          <h2>Quick help</h2>
          <button type="button" className="icon-button" aria-label="Close help" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <div className="help-drawer-body">
          <section className="help-intro">
            <p className="eyebrow">Use <kbd>/</kbd> to run commands</p>
            <p>
              Slash commands guide the workflow with uploads and in-session
              sources. When a matching analyzer is available, the composer
              shows a compact Focus control. Otherwise, ask normally.
            </p>
          </section>

          <section className="help-card">
            <Command size={18} aria-hidden="true" />
            <div>
              <p className="eyebrow">Command center</p>
              <h3>Actionable slash flows</h3>
              <p>
                Use <code>/commands</code> to inspect the available runtime
                commands, or <code>/report</code> when the current evidence can
                produce a diagnostic artifact.
              </p>
            </div>
          </section>

          <section className="help-card">
            <Upload size={18} aria-hidden="true" />
            <div>
              <p className="eyebrow">Source inputs</p>
              <h3>Use uploads and session sources</h3>
              <p>
                Upload files, drop a ZIP, or reuse something already attached in
                this session. Runtime commands use the session context and
                evidence added to chat that is visible in the workbench.
              </p>
            </div>
          </section>

          <section className="help-card">
            <FileText size={18} aria-hidden="true" />
            <div>
              <p className="eyebrow">Focused analysis</p>
              <h3>Steer only when useful</h3>
              <p>
                Use <strong>Focus</strong> in the composer to choose one
                matching analyzer for files already added to chat. Unmatched
                analyzers stay out of the composer.
              </p>
            </div>
          </section>

          {jdMcp ? (
            <section className="help-section help-jd-mcp-section" aria-label="Focused analyzers">
              <div className="help-section-title">
                <SlidersHorizontal size={17} aria-hidden="true" />
                <h3>Focused analyzers</h3>
              </div>
              <div className="help-jd-mcp-status">
                <strong>{friendlyJdMcpStatus(jdMcp)}</strong>
                <span>
                  {formatSpecializedToolText(jdMcp.note) || 'No focused analyzer status note is available.'}
                </span>
              </div>
              {jdMcpDescriptors.length ? (
                <div className="help-tool-list">
                  {jdMcpDescriptors.map((tool) => {
                    const unavailable = tool.enabled === false || tool.visibility === 'unsupported';
                    return (
                      <article
                        key={tool.name}
                        className={`help-tool-row ${unavailable ? 'is-unavailable' : ''}`}
                      >
                        <div>
                          <strong>{tool.name}</strong>
                          <p>{formatSpecializedToolText(tool.description)}</p>
                          {tool.reason ? <small>{formatSpecializedToolText(tool.reason)}</small> : null}
                        </div>
                        <span>{unavailable ? 'Unavailable' : 'Available'}</span>
                        {tool.requiresApproval ? <em>requires approval</em> : null}
                        {tool.producesReports ? <em>artifact</em> : null}
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="muted-help-copy">No focused analyzer catalog is loaded.</p>
              )}
            </section>
          ) : null}

          <section className="help-section">
            <div className="help-section-title">
              <Keyboard size={17} aria-hidden="true" />
              <h3>Keyboard</h3>
            </div>
            <dl className="shortcut-grid">
              {keyboardShortcuts.map(([keys, label]) => (
                <div key={keys}>
                  <dt>{keys}</dt>
                  <dd>{label}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="help-section">
            <h3>All slash commands</h3>
            <div className="help-command-list">
              {groupedCommands.map(([category, categoryCommands]) => (
                <div key={category} className="help-command-group">
                  <h4>{titleFromCategory(category)}</h4>
                  {categoryCommands.map((command) => (
                    <article key={command.name} className="help-command-row">
                      <span aria-hidden="true">{initialsFromCommand(command.name)}</span>
                      <div>
                        <strong>
                          <code>{command.name}</code>
                          {titleFromCommand(command.name)}
                        </strong>
                        <p>{command.description}</p>
                      </div>
                    </article>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </div>
      </aside>
    </div>
  );
}

function groupCommands(commands: WorkbenchCommandInfo[]): Array<[WorkbenchCommandInfo['category'], WorkbenchCommandInfo[]]> {
  const groups = new Map<WorkbenchCommandInfo['category'], WorkbenchCommandInfo[]>();
  for (const command of commands) {
    groups.set(command.category, [...(groups.get(command.category) ?? []), command]);
  }

  const order: WorkbenchCommandInfo['category'][] = [
    'workflow',
    'inspection',
    'memory',
    'integration',
    'config'
  ];

  return [...groups.entries()].sort(
    ([left], [right]) => order.indexOf(left) - order.indexOf(right)
  );
}

function initialsFromCommand(commandName: string): string {
  return commandName
    .replace(/^\//, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase())
    .join('')
    .slice(0, 2);
}

function titleFromCategory(category: WorkbenchCommandInfo['category']): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

function titleFromCommand(commandName: string): string {
  return commandName
    .replace(/^\//, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
