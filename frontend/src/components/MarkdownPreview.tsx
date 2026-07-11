import React, { useMemo } from 'react';
import { renderWikiMarkdown } from '../utils/wikiMarkdown';

interface MarkdownPreviewProps {
  markdown: string;
  emptyMessage?: string;
  className?: string;
}

const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  markdown,
  emptyMessage = 'No content',
  className = '',
}) => {
  const htmlContent = useMemo(() => {
    return renderWikiMarkdown(markdown).html;
  }, [markdown]);

  if (!htmlContent) {
    return <p className="text-sm text-gray-500">{emptyMessage}</p>;
  }

  return (
    <div
      className={`prose prose-sm max-w-none ${className}`.trim()}
      dangerouslySetInnerHTML={{ __html: htmlContent }}
    />
  );
};

export default MarkdownPreview;
