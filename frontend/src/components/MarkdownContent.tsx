import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function linkifyRawUrls(content: string): string {
  const combinedRegex = /(```[\s\S]*?```|`[^`\n]*?`|<a\s[^>]*>[\s\S]*?<\/a>|href="[^"]*"|src="[^"]*"|\[[^\]]*\]\([^)]*\))|(https?:\/\/[^\s<)"]+)/gi;

  return content.replace(combinedRegex, (match, group1, group2) => {
    if (group1) {
      return group1;
    }
    if (group2) {
      let url = group2;
      let trailing = '';
      const matchTrailing = url.match(/[.,;:!?]+$/);
      if (matchTrailing) {
        trailing = matchTrailing[0];
        url = url.slice(0, -trailing.length);
      }
      return `[${url}](${url})${trailing}`;
    }
    return match;
  });
}

export function MarkdownContent({ content }: { content: string }) {
  const processedContent = linkifyRawUrls(content);

  return (
    <div className="markdown-content">
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
          table({ children, ...props }) {
            return (
              <div className="markdown-table-scroll">
                <table {...props}>{children}</table>
              </div>
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
        {processedContent}
      </ReactMarkdown>
    </div>
  );
}

