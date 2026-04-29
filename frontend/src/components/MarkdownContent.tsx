import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a({ children, ...props }) {
          return (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          );
        },
        code({ className, children, ...props }) {
          const inline = !className;
          return inline ? (
            <code className="inline-code" {...props}>
              {children}
            </code>
          ) : (
            <code className={className} {...props}>
              {children}
            </code>
          );
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
