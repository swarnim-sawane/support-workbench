import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import {
  ArrowLeft,
  Boxes,
  CircleHelp,
  FileText,
  Route,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  UploadCloud
} from 'lucide-react';
import {
  documentationCta,
  documentationHighlights,
  documentationIntro,
  documentationSections,
  type DocumentationSection
} from '../content/documentation';
import { MarkdownContent } from './MarkdownContent';

type DocumentationPageProps = {
  onBackToWorkbench: () => void;
};

const iconMap: Record<DocumentationSection['icon'], typeof Sparkles> = {
  workflow: Sparkles,
  commands: TerminalSquare,
  uploads: UploadCloud,
  reports: FileText,
  shield: ShieldCheck,
  integration: Boxes,
  route: Route,
  notes: CircleHelp
};

function getHashSectionId(): string {
  return window.location.hash.replace(/^#/, '');
}

function scrollToSection(sectionId: string, behavior: ScrollBehavior = 'auto') {
  const element = document.getElementById(sectionId);
  if (!element || typeof element.scrollIntoView !== 'function') {
    return;
  }

  element.scrollIntoView({ behavior, block: 'start' });
}

export function DocumentationPage({ onBackToWorkbench }: DocumentationPageProps) {
  const pageRef = useRef<HTMLElement | null>(null);
  const sectionIds = useMemo(() => documentationSections.map((section) => section.id), []);
  const [activeSectionId, setActiveSectionId] = useState<string>(() => {
    const initialHash = getHashSectionId();
    return sectionIds.includes(initialHash) ? initialHash : documentationSections[0]?.id ?? '';
  });

  useEffect(() => {
    function syncFromLocation() {
      const nextHash = getHashSectionId();
      if (!sectionIds.includes(nextHash)) {
        setActiveSectionId(documentationSections[0]?.id ?? '');
        return;
      }

      setActiveSectionId(nextHash);
      window.requestAnimationFrame(() => scrollToSection(nextHash));
    }

    syncFromLocation();
    window.addEventListener('hashchange', syncFromLocation);
    window.addEventListener('popstate', syncFromLocation);
    return () => {
      window.removeEventListener('hashchange', syncFromLocation);
      window.removeEventListener('popstate', syncFromLocation);
    };
  }, [sectionIds]);

  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') {
      return undefined;
    }

    const root = pageRef.current;
    if (!root) {
      return undefined;
    }

    const sections = sectionIds
      .map((sectionId) => document.getElementById(sectionId))
      .filter((section): section is HTMLElement => Boolean(section));

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntry = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top))[0];

        if (visibleEntry) {
          setActiveSectionId(visibleEntry.target.id);
        }
      },
      {
        root,
        rootMargin: '-18% 0px -58% 0px',
        threshold: [0.1, 0.35, 0.6]
      }
    );

    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [sectionIds]);

  function handleNavClick(event: MouseEvent<HTMLAnchorElement>, sectionId: string) {
    event.preventDefault();
    if (!sectionIds.includes(sectionId)) {
      return;
    }

    setActiveSectionId(sectionId);
    window.history.pushState({}, '', `/docs#${sectionId}`);
    scrollToSection(sectionId, 'smooth');
  }

  return (
    <main
      ref={pageRef}
      className="docs-page"
      aria-label="Support Workbench documentation"
    >
      <div className="docs-shell">
        <section className="docs-hero" aria-labelledby="documentation-title">
          <div className="docs-hero-copy">
            <p className="docs-eyebrow">{documentationIntro.eyebrow}</p>
            <h1 id="documentation-title">{documentationIntro.title}</h1>
            <p className="docs-lead">{documentationIntro.lead}</p>
          </div>
          <aside className="docs-hero-note" aria-label="Why this page exists">
            <strong>Why this page exists</strong>
            <p>{documentationIntro.note}</p>
          </aside>
        </section>

        <section className="docs-highlight-strip" aria-label="Documentation highlights">
          {documentationHighlights.map((item) => (
            <article key={item.label} className="docs-highlight-item">
              <span>{item.label}</span>
              <strong>{item.value}</strong>
            </article>
          ))}
        </section>

        <div className="docs-content-shell">
          <aside className="docs-sidebar" aria-labelledby="docs-nav-title">
            <div className="docs-sidebar-panel">
              <div className="docs-sidebar-head">
                <p className="docs-eyebrow">Quick Links</p>
                <h2 id="docs-nav-title">Jump to section</h2>
                <p>Move through the guide without losing the current reading position.</p>
              </div>
              <nav className="docs-sidebar-nav" aria-label="Documentation section navigation">
                {documentationSections.map((section, index) => {
                  const isActive = activeSectionId === section.id;

                  return (
                    <a
                      key={section.id}
                      className={`docs-sidebar-link ${isActive ? 'is-active' : ''}`}
                      href={`#${section.id}`}
                      aria-current={isActive ? 'location' : undefined}
                      onClick={(event) => handleNavClick(event, section.id)}
                    >
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{section.title}</strong>
                    </a>
                  );
                })}
              </nav>
            </div>
          </aside>

          <div className="docs-main-column">
            <div className="docs-sections">
              {documentationSections.map((section, index) => {
                const Icon = iconMap[section.icon];

                return (
                  <section key={section.id} id={section.id} className="docs-section">
                    <div className="docs-section-header">
                      <div className="docs-section-marker">
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        <Icon size={22} aria-hidden="true" />
                      </div>
                      <div className="docs-section-copy">
                        <h2>{section.title}</h2>
                        <p>{section.summary}</p>
                      </div>
                    </div>
                    <div className="docs-markdown">
                      <MarkdownContent content={section.content} />
                    </div>
                  </section>
                );
              })}
            </div>

            <section className="docs-cta" aria-labelledby="docs-cta-title">
              <div>
                <p className="docs-eyebrow">Next Step</p>
                <h2 id="docs-cta-title">{documentationCta.title}</h2>
                <p>{documentationCta.body}</p>
              </div>
              <button type="button" className="docs-primary-button" onClick={onBackToWorkbench}>
                <ArrowLeft size={17} aria-hidden="true" />
                <span>Back to Workbench</span>
              </button>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
