import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { publicService } from '../services/api';
import { processMultiLanguageItems } from '../utils/languageFallback';
import { renderWikiMarkdown } from '../utils/wikiMarkdown';

interface NewsItem {
  id: string;
  title: string;
  content: string;
  author?: string;
  published_at?: string;
  created_at?: string;
}

const News: React.FC = () => {
  const { t, i18n } = useTranslation();
  const [items, setItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchNews = async () => {
      try {
        setLoading(true);
        const response = await publicService.getNews();
        setItems(processMultiLanguageItems(response.data || [], i18n.language));
        setError('');
      } catch (err) {
        console.error('Error fetching news:', err);
        setError(t('news_error_loading', 'Error loading news'));
      } finally {
        setLoading(false);
      }
    };

    fetchNews();
  }, [i18n.language, t]);

  return (
    <div className="w-full min-h-screen px-4 py-8 bg-gradient-to-br from-blue-50 via-blue-100 to-blue-200">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-8">
          <h1 className="text-4xl font-bold text-gray-800">{t('news_title', 'News')}</h1>
          <Link to="/" className="text-blue-700 hover:underline">{t('back_to_home', 'Back to Home')}</Link>
        </div>

        {loading && <p>{t('loading')}</p>}
        {error && <p className="bg-red-100 border border-red-300 text-red-700 p-4 rounded-lg">{error}</p>}
        {!loading && !error && items.length === 0 && (
          <p className="bg-white rounded-lg p-8 text-center text-gray-600">{t('news_no_items', 'No news available')}</p>
        )}

        <div className="space-y-6">
          {items.map((item) => {
            const rendered = renderWikiMarkdown(item.content || '').html;
            const date = item.published_at || item.created_at;
            return (
              <article key={item.id} className="bg-white rounded-lg shadow-lg p-6">
                <h2 className="text-2xl font-semibold text-gray-900 mb-2">{item.title}</h2>
                {date && <p className="text-sm text-gray-500 mb-4">{new Date(date).toLocaleDateString(i18n.language)}</p>}
                <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: rendered }} />
                {item.author && <p className="text-sm text-gray-500 mt-4">{t('news_by', 'By {{author}}', { author: item.author })}</p>}
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default News;
