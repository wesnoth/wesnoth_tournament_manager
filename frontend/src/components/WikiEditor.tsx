/**
 * WikiEditor Component (Refactored for JSON translations)
 * Multi-language markdown editor with tabs
 * Supports: EN | ES | DE | FR | ZH with copy-from-English feature
 */

import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

type Language = 'en' | 'es' | 'de' | 'fr' | 'zh';

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
  }) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  token?: string;
}

interface WikiArticle {
  id: number;
  slug: string;
  translations: {
    en?: { title: string; content_markdown: string };
    es?: { title: string; content_markdown: string };
    de?: { title: string; content_markdown: string };
    fr?: { title: string; content_markdown: string };
    zh?: { title: string; content_markdown: string };
  };
  is_published: number;
  created_at: string;
  updated_at: string;
}

const AVAILABLE_LANGUAGES: { code: Language; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'zh', label: '中文' }
];

const WikiEditor: React.FC<WikiEditorProps> = ({
  editingArticle,
  onSave,
  onCancel,
  isLoading = false,
  token
}) => {
  const { t } = useTranslation();
  const [slug, setSlug] = useState(editingArticle?.slug || '');
  const [currentLanguage, setCurrentLanguage] = useState<Language>('en');
  const [translations, setTranslations] = useState<Translations>(
    editingArticle?.translations || {
      en: { title: '', content_markdown: '' },
      es: { title: '', content_markdown: '' },
      de: { title: '', content_markdown: '' },
      fr: { title: '', content_markdown: '' },
      zh: { title: '', content_markdown: '' }
    }
  );
  const [isPublished, setIsPublished] = useState(editingArticle?.is_published === 1 || true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingImage(true);
    setError(null);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch('/api/admin/wiki/upload-image', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Upload failed');
      }

      const { url } = await response.json();

      // Insert markdown image syntax at cursor position
      if (textareaRef.current) {
        const textarea = textareaRef.current;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const currentContent = currentTranslation.content_markdown || '';
        const newContent =
          currentContent.substring(0, start) +
          `![alt-text](${url})` +
          currentContent.substring(end);

        updateCurrentTranslation('content_markdown', newContent);

        // Restore cursor position
        setTimeout(() => {
          textarea.focus();
          textarea.selectionStart = start + `![alt-text](${url})`.length;
          textarea.selectionEnd = start + `![alt-text](${url})`.length;
        }, 0);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Image upload failed';
      setError(msg);
    } finally {
      setUploadingImage(false);
      // Reset input so same file can be uploaded again
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
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
        is_published: isPublished
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      throw err;
    } finally {
      setIsSaving(false);
    }
  };

  const renderMarkdownPreview = (markdown: string) => {
    try {
      marked.setOptions({ breaks: false, gfm: true });
      const rawHtml = marked(markdown) as string;
      const htmlContent = DOMPurify.sanitize(rawHtml, {
        ALLOWED_TAGS: [
          'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
          'p', 'br', 'strong', 'em', 'u', 'del',
          'ol', 'ul', 'li',
          'table', 'thead', 'tbody', 'tr', 'th', 'td',
          'blockquote', 'pre', 'code',
          'a', 'img',
          'div', 'span'
        ],
        ALLOWED_ATTR: [
          'href', 'title', 'class', 'id',
          'src', 'alt', 'width', 'height',
          'target', 'rel',
          'colspan', 'rowspan',
          'data-language'
        ],
        KEEP_CONTENT: true
      });

      // Add Tailwind classes to all elements (matching WikiViewer)
      const formattedHtml = htmlContent
        // Headers with proper sizing and spacing
        .replace(/<h1>/g, '<h1 class="text-4xl font-bold mt-8 mb-4 text-gray-900">')
        .replace(/<h2>/g, '<h2 class="text-3xl font-bold mt-6 mb-3 text-gray-800 border-b-2 border-blue-500 pb-2">')
        .replace(/<h3>/g, '<h3 class="text-2xl font-bold mt-5 mb-2 text-gray-800">')
        .replace(/<h4>/g, '<h4 class="text-xl font-bold mt-4 mb-2 text-gray-700">')
        .replace(/<h5>/g, '<h5 class="text-lg font-bold mt-3 mb-2 text-gray-700">')
        .replace(/<h6>/g, '<h6 class="text-base font-bold mt-2 mb-2 text-gray-600">')
        // Paragraphs with proper spacing
        .replace(/<p>/g, '<p class="my-4 text-gray-800 leading-relaxed">')
        // Lists
        .replace(/<ol>/g, '<ol class="list-decimal list-inside ml-4 my-2 space-y-1">')
        .replace(/<ul>/g, '<ul class="list-disc list-inside ml-4 my-2 space-y-1">')
        .replace(/<li>(\s*)<p>/g, '<li class="text-gray-700">$1')
        .replace(/<\/p>(\s*)<\/li>/g, '$1</li>')
        .replace(/<li>(?!.*class)/g, '<li class="text-gray-700">')
        // Links with blue color and underline
        .replace(/<a /g, '<a class="text-blue-600 underline hover:text-blue-800 hover:no-underline transition-colors" ')
        // Images
        .replace(/<img src="\/uploads\/wiki\//g, '<img src="' + (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api') + '/public/wiki/images/')
        .replace(/<img /g, '<img class="max-w-full h-auto rounded-lg my-2" ');

      return (
        <div
          dangerouslySetInnerHTML={{ __html: formattedHtml }}
          className="prose prose-sm max-w-none"
        />
      );
    } catch (err) {
      return <p className="text-red-500 text-sm">Error rendering markdown</p>;
    }
  };

  const hasTranslation = (lang: Language) => {
    const trans = translations[lang];
    return trans && trans.title && trans.content_markdown;
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

        {/* Language Tabs */}
        <div className="mb-4">
          <div className="flex gap-2 border-b border-gray-200">
            {AVAILABLE_LANGUAGES.map(({ code, label }) => (
              <button
                key={code}
                onClick={() => setCurrentLanguage(code)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  currentLanguage === code
                    ? 'border-primary text-primary'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {label}
                {hasTranslation(code) && <span className="ml-1 text-green-600">✓</span>}
              </button>
            ))}
          </div>
        </div>

        {/* Translation Fields */}
        <div className="space-y-4 mb-6 pb-6 border-b border-gray-200">
          {/* Copy from English Button (for non-EN languages) */}
          {currentLanguage !== 'en' && (
            <button
              onClick={copyFromEnglish}
              className="w-full px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-medium border border-blue-200"
            >
              📋 Copy Title & Content from English
            </button>
          )}

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title ({currentLanguage.toUpperCase()})
            </label>
            <input
              type="text"
              value={currentTranslation.title || ''}
              onChange={(e) => updateCurrentTranslation('title', e.target.value)}
              placeholder={`Article title in ${AVAILABLE_LANGUAGES.find(l => l.code === currentLanguage)?.label}`}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 flex flex-col">
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700">Content (Markdown)</label>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingImage || isSaving}
              className="text-xs px-3 py-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploadingImage ? 'Uploading...' : '📷 Insert Image'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
          </div>
          <textarea
            ref={textareaRef}
            value={currentTranslation.content_markdown || ''}
            onChange={(e) => updateCurrentTranslation('content_markdown', e.target.value)}
            placeholder={`Write markdown here (${AVAILABLE_LANGUAGES.find(l => l.code === currentLanguage)?.label})...`}
            className="flex-1 p-3 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary focus:border-transparent resize-vertical min-h-[400px]"
          />
          <p className="text-xs text-gray-500 mt-2">
            Supports: **bold**, *italic*, `code`, # headers, - lists, [links](/help/article), ![images](/api/public/wiki/images/file.jpg)
          </p>
        </div>

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
            renderMarkdownPreview(currentTranslation.content_markdown || '')
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
