/**
 * WikiViewer Component
 * Displays wiki articles with Markdown rendering and HTML sanitization
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { renderWikiMarkdown } from '../utils/wikiMarkdown';

interface WikiViewerProps {
  slug: string;
  language?: string;
  onError?: (error: string) => void;
  isLoading?: (loading: boolean) => void;
}

interface WikiArticle {
  slug: string;
  title: string;
  content_markdown: string;
  language: string;
  created_at: string;
  updated_at: string;
}

const WikiViewer: React.FC<WikiViewerProps> = ({
  slug,
  language: languageProp,
  onError,
  isLoading
}) => {
  const { t, i18n } = useTranslation();
  const [article, setArticle] = useState<WikiArticle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Use provided language, fallback to i18n language, then to 'en'
  const language = languageProp || i18n.language || 'en';

  useEffect(() => {
    const fetchArticle = async () => {
      setLoading(true);
      setError(null);
      isLoading?.(true);

      try {
        const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
        const response = await fetch(
          `${apiUrl}/public/wiki/${encodeURIComponent(slug)}?lang=${encodeURIComponent(language)}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json'
            }
          }
        );

        if (!response.ok) {
          if (response.status === 404) {
            // Keep the requested URL visible so a missing article can be diagnosed.
            const msg = `Article "${slug}" not found`;
            setError(msg);
            onError?.(msg);
          } else {
            const msg = 'Failed to load article';
            setError(msg);
            onError?.(msg);
          }
          return;
        }

        const data: WikiArticle = await response.json();
        setArticle(data);
        setError(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        const errorMsg = `Error loading article: ${message}`;
        setError(errorMsg);
        onError?.(errorMsg);
      } finally {
        setLoading(false);
        isLoading?.(false);
      }
    };

    fetchArticle();
  }, [slug, language]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 my-4">
        <p className="text-red-800 font-semibold">{t('common.error')}</p>
        <p className="text-red-700">{error}</p>
      </div>
    );
  }

  if (!article) {
    return (
      <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 my-4">
        <p className="text-yellow-800">{t('common.no_data')}</p>
      </div>
    );
  }

  const { html: htmlContent, headings } = renderWikiMarkdown(article.content_markdown);

  return (
    <article className="wiki-viewer max-w-4xl mx-auto py-8">
      {/* Header */}
      <header className="mb-8 pb-6 border-b border-gray-200">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">{article.title}</h1>
        <div className="flex gap-4 text-sm text-gray-600">
          <span>
            {t('common.language')}: <span className="font-semibold uppercase">{article.language}</span>
          </span>
          <span>
            {t('common.updated')}: <span className="font-semibold">{new Date(article.updated_at).toLocaleDateString()}</span>
          </span>
        </div>
      </header>

      {/* Table of Contents */}
      {headings.length > 0 && (
        <nav className="mb-8 p-4 bg-gray-50 rounded-lg border border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">{t('common.table_of_contents')}</h2>
          <ul className="space-y-2">
            {headings.map(({ level, text, id }) => (
              <li key={id} style={{ paddingLeft: `${(level - 1) * 1.5}rem` }}>
                <a
                  href={`#${id}`}
                  className="text-primary hover:text-primary-dark hover:underline transition-colors"
                >
                  {text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {/* Content */}
      <div
        className="wiki-content prose prose-sm max-w-none
          prose-headings:font-bold prose-headings:text-gray-900
          prose-h1:text-3xl prose-h1:mt-8 prose-h1:mb-4
          prose-h2:text-2xl prose-h2:mt-6 prose-h2:mb-3
          prose-h3:text-xl prose-h3:mt-5 prose-h3:mb-2
          prose-p:text-gray-700 prose-p:leading-relaxed
          prose-a:text-primary prose-a:hover:text-primary-dark prose-a:hover:underline
          prose-strong:text-gray-900 prose-strong:font-semibold
          prose-em:text-gray-700 prose-em:italic
          prose-code:text-red-600 prose-code:bg-gray-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded
          prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-pre:p-4 prose-pre:rounded-lg prose-pre:overflow-x-auto
          prose-blockquote:border-l-4 prose-blockquote:border-primary prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-gray-600
          prose-table:border-collapse prose-td:border prose-td:border-gray-300 prose-td:px-3 prose-td:py-2
          prose-th:bg-gray-100 prose-th:border prose-th:border-gray-300 prose-th:px-3 prose-th:py-2 prose-th:font-semibold"
        dangerouslySetInnerHTML={{ __html: htmlContent }}
      />

      {/* Footer */}
      <footer className="mt-12 pt-6 border-t border-gray-200 text-sm text-gray-600">
        <p>{t('common.last_updated')}: {new Date(article.updated_at).toLocaleString()}</p>
      </footer>
    </article>
  );
};

export default WikiViewer;
