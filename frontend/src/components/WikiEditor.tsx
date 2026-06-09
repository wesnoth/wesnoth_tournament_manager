/**
 * WikiEditor Component
 * Simple markdown editor with live preview
 * Supports image uploads
 */

import React, { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import WikiViewer from './WikiViewer';

interface WikiEditorProps {
  initialSlug?: string;
  initialTitle?: string;
  initialContent?: string;
  initialLanguage?: string;
  onSave: (data: {
    slug: string;
    title: string;
    content_markdown: string;
    language: string;
    is_published: boolean;
  }) => Promise<void>;
  onCancel?: () => void;
  isLoading?: boolean;
  token?: string;
}

const WikiEditor: React.FC<WikiEditorProps> = ({
  initialSlug = '',
  initialTitle = '',
  initialContent = '',
  initialLanguage = 'en',
  onSave,
  onCancel,
  isLoading = false,
  token
}) => {
  const { t } = useTranslation();
  const [slug, setSlug] = useState(initialSlug);
  const [title, setTitle] = useState(initialTitle);
  const [content, setContent] = useState(initialContent);
  const [language, setLanguage] = useState(initialLanguage);
  const [isPublished, setIsPublished] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [loadingArticle, setLoadingArticle] = useState(!!initialSlug && !initialContent);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Fetch article content on mount if editing
  useEffect(() => {
    if (initialSlug && !initialContent && !content) {
      fetchArticle();
    }
  }, [initialSlug]);

  const fetchArticle = async () => {
    try {
      const response = await fetch(`/api/admin/wiki/${initialSlug}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to load article');

      const data = await response.json();
      setTitle(data.title);
      setContent(data.content_markdown);
      setLanguage(data.language);
      setIsPublished(data.is_published === 1);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load article';
      setError(msg);
    } finally {
      setLoadingArticle(false);
    }
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
      const textarea = document.getElementById('content-textarea') as HTMLTextAreaElement;
      if (textarea) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newContent = 
          content.substring(0, start) + 
          `![alt-text](${url})` + 
          content.substring(end);
        setContent(newContent);
        
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
    if (!slug.trim()) {
      setError('Slug is required');
      return;
    }
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    if (!content.trim()) {
      setError('Content is required');
      return;
    }

    setIsSaving(true);
    setError(null);

    try {
      await onSave({
        slug: slug.trim(),
        title: title.trim(),
        content_markdown: content,
        language,
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

  if (loadingArticle) {
    return (
      <div className="flex justify-center items-center py-12 min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  return (
    <div className="wiki-editor grid grid-cols-2 gap-6 p-6">
      {/* Left Panel: Editor */}
      <div className="editor-panel flex flex-col">
        <h2 className="text-2xl font-bold mb-4">{initialSlug ? 'Edit Article' : 'New Article'}</h2>

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
              disabled={!!initialSlug}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            <p className="text-xs text-gray-500 mt-1">URL-friendly identifier (lowercase, hyphens, underscores)</p>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Article title"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {/* Language & Published */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="en">English</option>
                <option value="es">Español</option>
                <option value="fr">Français</option>
                <option value="de">Deutsch</option>
              </select>
            </div>
            <div className="flex items-end">
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
            id="content-textarea"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Write markdown here..."
            className="flex-1 p-3 border border-gray-300 rounded-lg font-mono text-sm focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
          />
          <p className="text-xs text-gray-500 mt-2">
            Supports: **bold**, *italic*, `code`, # headers, - lists, [links](/help/article), ![images](/uploads/wiki/file.jpg)
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
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Preview</h3>
        <div className="flex-1 overflow-y-auto">
          {content.trim() ? (
            <div className="prose prose-sm max-w-none">
              <WikiViewer slug="preview" language={language} isLoading={() => {}} />
            </div>
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
