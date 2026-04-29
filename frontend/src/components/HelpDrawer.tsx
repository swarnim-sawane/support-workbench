import { Command, Keyboard, Sparkles, Upload, X, Zap } from 'lucide-react';
import { DIAGNOSTIC_COMMANDS } from '../diagnosticCommands';

type HelpDrawerProps = {
  open: boolean;
  onClose: () => void;
};

const commandInitials: Record<string, string> = {
  '/auto-triage': 'AT',
  '/adf-logs': 'LG',
  '/adf-performance': 'PF',
  '/jdbc-leaks': 'DB',
  '/thread-dumps': 'TD',
  '/jbo-activity': 'JB',
  '/workspace': 'WS',
  '/incident-folder': 'IN',
  '/forms-logs': 'FL',
  '/jvm-controller-logs': 'JV',
  '/forms-traces': 'FT',
  '/translate-forms-trace': 'TR',
  '/reports-logs': 'RP',
  '/har-file': 'HR',
  '/correlate-har-logs': 'CL',
  '/compare': 'CP'
};

const keyboardShortcuts = [
  ['/', 'commands'],
  ['Enter', 'send'],
  ['Shift+Enter', 'newline'],
  ['Esc', 'dismiss']
];

export function HelpDrawer({ open, onClose }: HelpDrawerProps) {
  if (!open) {
    return null;
  }

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
              sources instead of asking for filesystem paths.
            </p>
          </section>

          <section className="help-card">
            <Command size={18} aria-hidden="true" />
            <div>
              <p className="eyebrow">Command center</p>
              <h3>Actionable slash flows</h3>
              <p>
                Use <code>/thread-dumps</code>, <code>/workspace</code>,{' '}
                <code>/compare</code>, or <code>/auto-triage</code> to open a
                guided command card.
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
                this session. The command card keeps the right source attached
                to the right workflow.
              </p>
            </div>
          </section>

          <section className="help-card">
            <Zap size={18} aria-hidden="true" />
            <div>
              <p className="eyebrow">Fast actions</p>
              <h3>Run app actions from / too</h3>
              <p>
                Open workspace, open history, export the session, clear the
                conversation, or rerun the latest analysis without leaving the
                keyboard.
              </p>
            </div>
          </section>

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
              {DIAGNOSTIC_COMMANDS.map((command) => (
                <article key={command.name} className="help-command-row">
                  <span aria-hidden="true">{commandInitials[command.name]}</span>
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
          </section>
        </div>
      </aside>
    </div>
  );
}

function titleFromCommand(commandName: string): string {
  return commandName
    .replace(/^\//, '')
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
