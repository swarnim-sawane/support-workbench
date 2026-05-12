import {
  BookOpenText,
  Check,
  CheckCircle2,
  Download,
  HelpCircle,
  MoreHorizontal,
  PanelRight,
  Sparkles,
  SwatchBook
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { WorkbenchHealth } from '../types';

export type WorkbenchTheme = 'light' | 'dark' | 'redwood';

type ChatHeaderProps = {
  health: WorkbenchHealth;
  error?: string | null;
  workspaceOpen: boolean;
  workspaceCount: number;
  theme: WorkbenchTheme;
  isDocumentationOpen: boolean;
  onToggleWorkspace: () => void;
  onDownloadChat: () => void;
  onSetTheme: (theme: WorkbenchTheme) => void;
  onOpenHelp: () => void;
  onOpenDocumentation: () => void;
  onBackToWorkbench: () => void;
};

export function ChatHeader({
  health,
  error,
  workspaceOpen,
  workspaceCount,
  theme,
  isDocumentationOpen,
  onToggleWorkspace,
  onDownloadChat,
  onSetTheme,
  onOpenHelp,
  onOpenDocumentation,
  onBackToWorkbench
}: ChatHeaderProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const modelLabel = formatModelLabel(health.model);

  function handleDownloadChat() {
    setMenuOpen(false);
    onDownloadChat();
  }

  function handleOpenDocumentation() {
    setMenuOpen(false);
    onOpenDocumentation();
  }

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    function onPointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    }

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <header className="chat-header">
      <div className="brand-lockup">
        <div>
          <p className="eyebrow">{isDocumentationOpen ? 'Tool guide' : 'Local diagnostic agent'}</p>
          <h1>{isDocumentationOpen ? 'Documentation' : 'Support Workbench'}</h1>
        </div>
      </div>

      <div className="proof-of-concept-badge" aria-label="Proof of Concept">
        <strong>Proof of Concept</strong>
      </div>

      <div className="header-status">
        <span className={`model-chip ${health.ok ? 'tone-ok' : 'tone-danger'}`}>
          {health.ok ? <Sparkles size={14} /> : <CheckCircle2 size={14} />}
          {modelLabel}
        </span>
        {isDocumentationOpen ? (
          <button
            type="button"
            className="header-action is-active"
            onClick={onBackToWorkbench}
          >
            <BookOpenText size={15} />
            <span>Back to Workbench</span>
          </button>
        ) : (
          <button
            type="button"
            className={`header-action ${workspaceOpen ? 'is-active' : ''}`}
            aria-label={workspaceOpen ? 'Hide workspace' : 'Show workspace'}
            onClick={onToggleWorkspace}
          >
            <PanelRight size={15} />
            <span>Workspace</span>
            {workspaceCount > 0 ? <em className="header-count">{workspaceCount}</em> : null}
          </button>
        )}
        <div className="header-menu-wrap" ref={menuRef}>
          <button
            type="button"
            className={`header-action icon-only ${menuOpen ? 'is-active' : ''}`}
            aria-label="More options"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
          >
            <MoreHorizontal size={16} />
          </button>
          {menuOpen ? (
            <div className="header-menu" role="menu" aria-label="More options">
              {!isDocumentationOpen ? (
                <button type="button" role="menuitem" onClick={handleOpenDocumentation}>
                  <BookOpenText size={15} />
                  <span>Documentation</span>
                </button>
              ) : null}

              <button type="button" role="menuitem" onClick={handleDownloadChat}>
                <Download size={15} />
                <span>Download chat</span>
              </button>

              <div className="header-menu-theme" role="group" aria-label="Themes">
                <div className="header-menu-label">
                  <SwatchBook size={14} aria-hidden="true" />
                  <span>Themes</span>
                </div>
                {(['light', 'dark', 'redwood'] as const).map((themeName) => (
                  <button
                    key={themeName}
                    type="button"
                    role="menuitemradio"
                    aria-checked={theme === themeName}
                    className={theme === themeName ? 'is-selected' : ''}
                    onClick={() => onSetTheme(themeName)}
                  >
                    {theme === themeName ? <Check size={15} /> : <span aria-hidden="true" />}
                    <span>{formatThemeLabel(themeName)}</span>
                  </button>
                ))}
              </div>

              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  onOpenHelp();
                }}
              >
                <HelpCircle size={15} />
                <span>Help</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
    </header>
  );
}

function formatThemeLabel(theme: WorkbenchTheme): string {
  return theme.charAt(0).toUpperCase() + theme.slice(1);
}

function formatModelLabel(model: string | null): string {
  if (!model) {
    return 'Model unavailable';
  }

  const cleaned = model.replace(/^oca\//i, 'OCA ');
  return cleaned
    .split(/\s+/)
    .filter(Boolean)
    .map((part, index) => (index === 0 && part.toLowerCase() === 'oca' ? 'OCA' : part.toUpperCase()))
    .join(' ');
}
