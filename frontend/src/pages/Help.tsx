import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import MainLayout from '../components/MainLayout';
import WikiViewer from '../components/WikiViewer';

interface WikiListItem {
  slug: string;
  title: string;
  language: string;
  updated_at: string;
}

const HelpPage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const { slug } = useParams<{ slug?: string }>();
  const language = i18n.language || 'en';

  const [articles, setArticles] = useState<WikiListItem[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [errorList, setErrorList] = useState<string | null>(null);
  const [viewerLoading, setViewerLoading] = useState(false);

  useEffect(() => {
    const fetchArticlesList = async () => {
      setLoadingList(true);
      try {
        const apiUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api';
        const response = await fetch(`${apiUrl}/public/wiki/list?lang=${encodeURIComponent(language)}`, {
          method: 'GET',
          headers: { 'Content-Type': 'application/json' }
        });

        if (response.ok) {
          const data = await response.json();
          setArticles(data);
          setErrorList(null);
        } else {
          setErrorList('Failed to load articles list');
        }
      } catch (err) {
        setErrorList('Error loading articles list');
      } finally {
        setLoadingList(false);
      }
    };

    fetchArticlesList();
  }, [language]);

  // Keep the landing page stable even if article ordering changes in the database.
  const displaySlug = slug || 'getting-started';

  return (
    <MainLayout>
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 py-8">
          <div className="mb-8">
            <h1 className="text-4xl font-bold text-gray-900 mb-2">{t('common.help')}</h1>
            <p className="text-gray-600">{t('common.help_description')}</p>
          </div>

          <div className="grid grid-cols-1 gap-8 lg:grid-cols-4">
            {/* Grid children default to min-width: auto, which lets a long
                article title widen the sidebar beyond its assigned column. */}
            <aside className="min-w-0 lg:col-span-1">
              <div data-help-id="region-help-article-list" className="sticky top-20 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="p-4 border-b border-gray-200">
                  <h2 className="text-lg font-semibold text-gray-900">{t('common.articles')}</h2>
                </div>

                {loadingList ? (
                  <div className="p-4 text-center text-gray-500">
                    <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto"></div>
                  </div>
                ) : errorList ? (
                  <div className="p-4 text-red-600 text-sm">{errorList}</div>
                ) : articles.length === 0 ? (
                  <div className="p-4 text-gray-500 text-sm">{t('common.no_articles')}</div>
                ) : (
                  <nav className="min-w-0 space-y-1 p-4">
                    {articles.map((article) => (
                      <a
                        data-help-id="action-open-help-article"
                        key={`${article.slug}-${article.language}`}
                        href={`/help/${encodeURIComponent(article.slug)}`}
                        className={`flex min-w-0 items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                          displaySlug === article.slug
                            ? 'bg-primary text-white'
                            : 'text-gray-700 hover:bg-gray-100'
                        }`}
                        title={`${article.title} (${article.language.toUpperCase()})`}
                      >
                        <span className="min-w-0 flex-1 truncate">{article.title}</span>
                        <span className="ml-1 flex-shrink-0 text-xs opacity-75">({article.language})</span>
                      </a>
                    ))}
                  </nav>
                )}
              </div>
            </aside>

            <main className="min-w-0 lg:col-span-3">
              {viewerLoading && !displaySlug ? (
                <div className="flex justify-center items-center py-20">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                </div>
              ) : displaySlug ? (
                <WikiViewer
                  slug={displaySlug}
                  language={language}
                  isLoading={setViewerLoading}
                />
              ) : (
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6 text-center">
                  <p className="text-yellow-800">{t('common.no_articles_available')}</p>
                </div>
              )}
            </main>
          </div>
        </div>
      </div>
    </MainLayout>
  );
};

export default HelpPage;
