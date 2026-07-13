import React, { useRef, useState } from 'react';
import { renderWikiMarkdown } from '../utils/wikiMarkdown';

type Language = 'en' | 'es' | 'de' | 'ru' | 'zh';

interface TranslationValue {
  title?: string;
  content_markdown?: string;
}

interface MarkdownTranslationEditorProps {
  translations: Record<string, TranslationValue>;
  currentLanguage: Language;
  onLanguageChange: (language: Language) => void;
  onTitleChange: (value: string) => void;
  onContentChange: (value: string) => void;
  token?: string | null;
  showLanguageTabs?: boolean;
  onCopyFromEnglish?: () => void;
  showPreview?: boolean;
}

const LANGUAGES: Array<{ code: Language; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'ru', label: 'Русский' },
  { code: 'zh', label: '中文' },
];

const MarkdownTranslationEditor: React.FC<MarkdownTranslationEditorProps> = ({
  translations,
  currentLanguage,
  onLanguageChange,
  onTitleChange,
  onContentChange,
  token,
  showLanguageTabs = true,
  onCopyFromEnglish,
  showPreview = true,
}) => {
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const current = translations[currentLanguage] || { title: '', content_markdown: '' };

  const insertImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !token) return;

    setUploadingImage(true);
    try {
      const body = new FormData();
      body.append('image', file);
      const response = await fetch('/api/admin/wiki/upload-image', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body,
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || 'Image upload failed');
      }

      const { url } = await response.json();
      const textarea = textareaRef.current;
      const start = textarea?.selectionStart ?? current.content_markdown.length;
      const end = textarea?.selectionEnd ?? current.content_markdown.length;
      const imageMarkdown = `![alt-text](${url})`;
      onContentChange(
        `${current.content_markdown.slice(0, start)}${imageMarkdown}${current.content_markdown.slice(end)}`,
      );
    } catch (error) {
      console.error('Markdown image upload failed:', error);
    } finally {
      setUploadingImage(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const preview = renderWikiMarkdown(current.content_markdown).html;

  return (
    <div className="space-y-4">
      {showLanguageTabs && (
        <div className="flex gap-2 border-b border-gray-200">
          {LANGUAGES.map(({ code, label }) => (
            <button
              key={code}
              type="button"
              onClick={() => onLanguageChange(code)}
              className={`px-4 py-2 text-sm font-semibold border-b-2 ${currentLanguage === code ? 'border-primary text-primary' : 'border-transparent text-gray-600 hover:text-gray-900'}`}
            >
              {label}
              {translations[code]?.content_markdown?.trim() && <span className="ml-1 text-green-600">✓</span>}
            </button>
          ))}
        </div>
      )}

      {currentLanguage !== 'en' && onCopyFromEnglish && (
        <button type="button" onClick={onCopyFromEnglish} className="w-full px-3 py-2 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded-lg text-sm font-medium border border-blue-200">
          Copy title and content from English
        </button>
      )}

      <input
        type="text"
        value={current.title || ''}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder={`Title (${currentLanguage})`}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg"
      />

      <div className={showPreview ? 'grid grid-cols-1 xl:grid-cols-2 gap-4' : ''}>
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-sm font-medium text-gray-700">Content (Markdown)</label>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={!token || uploadingImage}
              className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded disabled:opacity-50"
            >
              {uploadingImage ? 'Uploading...' : 'Insert Image'}
            </button>
            <input ref={fileInputRef} type="file" accept="image/*" onChange={insertImage} className="hidden" />
          </div>
          <textarea
            ref={textareaRef}
            value={current.content_markdown || ''}
            onChange={(event) => onContentChange(event.target.value)}
            rows={12}
            placeholder={`Write Markdown here (${currentLanguage})...`}
            className="w-full p-3 border border-gray-300 rounded-lg font-mono text-sm resize-y"
          />
        </div>
        {showPreview && <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 min-h-[300px]">
          <p className="text-sm font-semibold text-gray-700 mb-2">Preview ({currentLanguage.toUpperCase()})</p>
          {preview ? <div className="prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: preview }} /> : <p className="text-sm text-gray-500">Start writing to see the preview.</p>}
        </div>}
      </div>
    </div>
  );
};

export default MarkdownTranslationEditor;
