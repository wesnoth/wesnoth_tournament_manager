import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { adminService } from '../services/api';
import MainLayout from '../components/MainLayout';
import MarkdownTranslationEditor from '../components/MarkdownTranslationEditor';
import { renderWikiMarkdown } from '../utils/wikiMarkdown';

const AdminNews: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, token } = useAuthStore();
  
  const [newsItems, setNewsItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [activeLanguageTab, setActiveLanguageTab] = useState('en');

  const languages = ['en', 'es', 'zh', 'de', 'ru'];
  const languageLabels: Record<string, string> = {
    en: 'English',
    es: 'Español',
    zh: '中文',
    de: 'Deutsch',
    ru: 'Русский'
  };

  const [formData, setFormData] = useState({
    en: { title: '', content: '' },
    es: { title: '', content: '' },
    zh: { title: '', content: '' },
    de: { title: '', content: '' },
    ru: { title: '', content: '' }
  });

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) {
      navigate('/');
      return;
    }

    fetchNews();
  }, [isAuthenticated, isAdmin, navigate]);

  const fetchNews = async () => {
    try {
      setLoading(true);
      const res = await adminService.getNews();
      // Group news rows by ID to get all language versions.
      const grouped: Record<string, any> = {};
      (res.data || []).forEach((item: any) => {
        if (!grouped[item.id]) {
          grouped[item.id] = {};
        }
        grouped[item.id][item.language_code || 'en'] = item;
      });
      setNewsItems(Object.values(grouped));
      setError('');
    } catch (err: any) {
      console.error('Error fetching news:', err);
      setError('Error loading news');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      en: { title: '', content: '' },
      es: { title: '', content: '' },
      zh: { title: '', content: '' },
      de: { title: '', content: '' },
      ru: { title: '', content: '' }
    });
    setActiveLanguageTab('en');
    setEditingId(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate that English is required
    if (!formData.en.title || !formData.en.content) {
      setError('English (title and content) is required');
      return;
    }

    try {
      if (editingId) {
        await adminService.updateNews(editingId, formData);
        setMessage('News item updated successfully');
      } else {
        await adminService.createNews(formData);
        setMessage('News item created successfully');
      }

      resetForm();
      setShowForm(false);
      fetchNews();
      setTimeout(() => setMessage(''), 3000);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save news item');
    }
  };

  const handleEdit = (newsGroup: any) => {
    const newFormData = { ...formData };
    languages.forEach(lang => {
      if (newsGroup[lang]) {
        newFormData[lang as keyof typeof newFormData] = {
          title: newsGroup[lang].title,
          content: newsGroup[lang].content
        };
      }
    });
    setFormData(newFormData);
    setEditingId(newsGroup.en?.id || newsGroup[languages[0]]?.id);
    setActiveLanguageTab('en');
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    if (window.confirm('Are you sure you want to delete this news item (all languages)?')) {
      try {
        await adminService.deleteNews(id);
        setMessage('News item deleted successfully');
        fetchNews();
        setTimeout(() => setMessage(''), 3000);
      } catch (err: any) {
        setError('Failed to delete news item');
      }
    }
  };

  if (loading) {
    return <MainLayout><div className="max-w-6xl mx-auto px-4 py-8"><p className="text-center text-gray-600">Loading...</p></div></MainLayout>;
  }

  return (
    <MainLayout>
      <div data-help-id="region-manage-news" className="max-w-6xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-800 mb-6">Manage News</h1>

      {error && <p className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4">{error}</p>}
      {message && <p className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded-lg mb-4">{message}</p>}

      <section>
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-semibold text-gray-800">News</h2>
          <button data-help-id="action-toggle-news-form" onClick={() => {
            if (showForm) {
              resetForm();
            }
            setShowForm(!showForm);
          }} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600">
            {showForm ? 'Cancel' : 'New News Item'}
          </button>
        </div>

        {showForm && (
          <form data-help-id="region-news-form" className="bg-white rounded-lg shadow-md p-6 mb-6" onSubmit={handleSubmit}>
            {/* Language Tabs */}
            <div className="flex border-b border-gray-300 mb-6">
              {languages.map(lang => (
                <button
                  data-help-id="action-select-news-language"
                  key={lang}
                  type="button"
                  className={`px-4 py-2 font-semibold border-b-2 ${
                    activeLanguageTab === lang
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-600 hover:text-gray-800'
                  }`}
                  onClick={() => setActiveLanguageTab(lang)}
                >
                  {languageLabels[lang]}
                </button>
              ))}
            </div>

            {/* Language Content */}
            <div data-help-id="region-news-translation-editor" className="mb-6">
              <MarkdownTranslationEditor
                translations={Object.fromEntries(
                  languages.map((lang) => [lang, {
                    title: formData[lang as keyof typeof formData].title,
                    content_markdown: formData[lang as keyof typeof formData].content,
                  }]),
                )}
                currentLanguage={activeLanguageTab as 'en' | 'es' | 'de' | 'ru' | 'zh'}
                onLanguageChange={(language) => setActiveLanguageTab(language)}
                onTitleChange={(title) => setFormData({
                  ...formData,
                  [activeLanguageTab]: { ...formData[activeLanguageTab as keyof typeof formData], title },
                })}
                onContentChange={(content) => setFormData({
                  ...formData,
                  [activeLanguageTab]: { ...formData[activeLanguageTab as keyof typeof formData], content },
                })}
                token={token}
                showLanguageTabs={false}
              />
            </div>

            <button data-help-id="action-submit-news-form" type="submit" className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50">
              {editingId ? 'Update News Item (All Languages)' : 'Create News Item (All Languages)'}
            </button>
          </form>
        )}

        {newsItems.length > 0 ? (
          <div className="space-y-4">
            {newsItems.map((newsGroup) => {
              const firstLang = languages.find(lang => newsGroup[lang]);
              const id = firstLang ? newsGroup[firstLang].id : '';
              const title = firstLang ? newsGroup[firstLang].title : 'N/A';
              const publishedAt = firstLang ? newsGroup[firstLang].published_at : '';
              const author = firstLang ? newsGroup[firstLang].author : '';
              
              return (
                <div data-help-id="region-news-item" key={id} className="bg-white rounded-lg shadow-md p-4">
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="text-lg font-semibold text-gray-800">{title}</h3>
                    <span className="px-2 py-1 bg-blue-100 text-blue-800 text-xs font-semibold rounded-full">Multi-language</span>
                  </div>
                  <div className="prose prose-sm max-w-none mb-2" dangerouslySetInnerHTML={{ __html: renderWikiMarkdown(newsGroup[firstLang || 'en']?.content || '').html }} />
                  {author && publishedAt && (
                    <small className="text-gray-600">By {author} on {new Date(publishedAt).toLocaleDateString()}</small>
                  )}
                  <div className="flex gap-2 mt-4">
                    <button data-help-id="action-edit-news" onClick={() => handleEdit(newsGroup)} className="px-3 py-1 bg-blue-500 text-white text-sm rounded-lg hover:bg-blue-600">Edit</button>
                    <button data-help-id="action-delete-news" onClick={() => handleDelete(id)} className="px-3 py-1 bg-red-500 text-white text-sm rounded-lg hover:bg-red-600">Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-gray-600">No news yet</p>
        )}
      </section>
      </div>
    </MainLayout>
  );
};

export default AdminNews;
