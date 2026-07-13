/**
 * WikiEditor Component (Refactored for JSON translations)
 * Multi-language markdown editor with tabs
 * Supports: EN | ES | DE | RU | ZH with copy-from-English feature
 */

import React, { useState } from 'react';
import MarkdownTranslationEditor from './MarkdownTranslationEditor';
import { renderWikiMarkdown } from '../utils/wikiMarkdown';

type Language = 'en' | 'es' | 'de' | 'ru' | 'zh';

interface Translation {
  title?: string;
  content_markdown?: string;
}

interface Translations {
  [key: string]: Translation;
}

interface WikiEditorProps {
  editingArticle?: WikiArticle;
  onSave: (data: {
    slug: string;
    translations: Translations;
    is_published: boolean;
    author_id?: string;
  }) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  token?: string;
  userId?: string;
}

interface WikiArticle {
  id: string;
  slug: string;
  translations: {
    en?: { title: string; content_markdown: string };
    es?: { title: string; content_markdown: string };
    de?: { title: string; content_markdown: string };
    ru?: { title: string; content_markdown: string };
    zh?: { title: string; content_markdown: string };
  };
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

const WikiEditor: React.FC<WikiEditorProps> = ({
  editingArticle,
  onSave,
  onCancel,
  isLoading = false,
  token,
  userId
}) => {
  const [slug, setSlug] = useState(editingArticle?.slug || '');
  const [currentLanguage, setCurrentLanguage] = useState<Language>('en');
  const [translations, setTranslations] = useState<Translations>(
    editingArticle?.translations || {
      en: { title: '', content_markdown: '' },
      es: { title: '', content_markdown: '' },
      de: { title: '', content_markdown: '' },
      ru: { title: '', content_markdown: '' },
      zh: { title: '', content_markdown: '' }
    }
  );
  const [isPublished, setIsPublished] = useState(editingArticle?.is_published ?? true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentTranslation = translations[currentLanguage] || { title: '', content_markdown: '' };

  const updateCurrentTranslation = (field: 'title' | 'content_markdown', value: string) => {
    setTranslations(prev => ({
      ...prev,
      [currentLanguage]: {
        ...prev[currentLanguage],
        [field]: value
      }
    }));
  };

  const copyFromEnglish = () => {
    const enTranslation = translations.en;
    if (!enTranslation) {
      setError('English translation is empty');
      return;
    }

    setTranslations(prev => ({
      ...prev,
      [currentLanguage]: {
        title: enTranslation.title || '',
        content_markdown: enTranslation.content_markdown || ''
      }
    }));
  };

  const handleSave = async () => {
    // Validate slug
    if (!slug.trim()) {
      setError('Slug is required');
      return;
    }

    // Validate English translation
    const enTrans = translations.en;
    if (!enTrans || !enTrans.title?.trim() || !enTrans.content_markdown?.trim()) {
      setError('English translation must have title and content');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        slug: slug.trim(),
        translations,
        is_published: isPublished,
        author_id: userId
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="wiki-editor grid grid-cols-2 gap-6 p-6">
      {/* Left Panel: Editor */}
      <div className="editor-panel flex flex-col">
        <h2 className="text-2xl font-bold mb-4">{editingArticle ? 'Edit Article' : 'New Article'}</h2>

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
            <p className="text-red-800 text-sm">{error}</p>
          </div>
        )}

        {/* Metadata */}
        <div className="space-y-4 mb-6 pb-6 border-b border-gray-200">
          {/* Slug */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Slug</label>
            <input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
              placeholder="e.g., getting-started"
              disabled={!!editingArticle}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">URL-friendly identifier (lowercase, hyphens, underscores)</p>
          </div>

          {/* Publish Status */}
          <div className="flex items-center">
            <label className="flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={isPublished}
                onChange={(e) => setIsPublished(e.target.checked)}
                className="w-4 h-4 text-primary rounded"
              />
              <span className="ml-2 text-sm text-gray-700">Publish</span>
            </label>
          </div>
        </div>

        <MarkdownTranslationEditor
          translations={translations}
          currentLanguage={currentLanguage}
          onLanguageChange={setCurrentLanguage}
          onTitleChange={(value) => updateCurrentTranslation('title', value)}
          onContentChange={(value) => updateCurrentTranslation('content_markdown', value)}
          onCopyFromEnglish={copyFromEnglish}
          token={token}
          showPreview={false}
        />

        {/* Actions */}
        <div className="flex gap-3 mt-4 pt-4 border-t border-gray-200">
          <button
            onClick={handleSave}
            disabled={isSaving || isLoading}
            className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isSaving || isLoading ? 'Saving...' : 'Save Article'}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={isSaving || isLoading}
              className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Right Panel: Preview */}
      <div className="preview-panel flex flex-col bg-gray-50 rounded-lg p-4 border border-gray-200 overflow-hidden">
        <div className="mb-3">
          <h3 className="text-lg font-semibold text-gray-900">Preview ({currentLanguage.toUpperCase()})</h3>
          <p className="text-sm text-gray-600">{currentTranslation.title}</p>
        </div>
        <div className="flex-1 overflow-y-auto">
          {(currentTranslation.content_markdown || '').trim() ? (
            <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: renderWikiMarkdown(currentTranslation.content_markdown || '').html }} />
          ) : (
            <div className="text-center py-12">
              <p className="text-gray-500">Start writing to see preview here</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default WikiEditor;
