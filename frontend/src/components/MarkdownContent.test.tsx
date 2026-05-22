import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MarkdownContent } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('wraps chat response markdown and contains wide tables in a scroll region', () => {
    const longToken = `incident-${'A'.repeat(120)}`;

    render(
      <MarkdownContent
        content={`The diagnostic URL is https://example.test/${longToken}

| Field | Value |
| --- | --- |
| requestId | ${longToken} |`}
      />
    );

    const content = screen.getByText(/diagnostic URL/i).closest('.markdown-content');
    expect(content).toBeInTheDocument();
    expect(content).toContainElement(screen.getByRole('link'));

    const table = screen.getByRole('table');
    expect(table.parentElement).toHaveClass('markdown-table-scroll');
  });

  it('autolinks raw localhost URLs such as the HAR viewer link', () => {
    render(
      <MarkdownContent
        content="Check this local link: http://localhost:3000?fileId=file_123_xyz. Done."
      />
    );

    const link = screen.getByRole('link', { name: 'http://localhost:3000?fileId=file_123_xyz' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'http://localhost:3000?fileId=file_123_xyz');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

