/**
 * Wiki Admin Page
 * Manage wiki articles and images
 */

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/authStore';
import WikiEditor from '../components/WikiEditor';
import JSZip from 'jszip';

interface WikiTranslation {
  title: string;
  content_markdown: string;
}

interface WikiArticle {
  id: number;
  slug: string;
  translations: {
    en?: WikiTranslation;
    es?: WikiTranslation;
    de?: WikiTranslation;
    fr?: WikiTranslation;
    zh?: WikiTranslation;
  };
  is_published: number;
  created_at: string;
  updated_at: string;
}

interface WikiImage {
  id: number;
  filename: string;
  original_name: string;
  uploaded_by: number | null;
  created_at: string;
  usage_count: number;
}

interface ImageUsage {
  id: number;
  slug: string;
  title: string;
}

const AdminWiki: React.FC = () => {
  const { t } = useTranslation();
  const { token, userId } = useAuthStore();

  const [activeTab, setActiveTab] = useState<'articles' | 'images'>('articles');
  const [articles, setArticles] = useState<WikiArticle[]>([]);
  const [images, setImages] = useState<WikiImage[]>([]);
  const [orphanedImages, setOrphanedImages] = useState<Array<{ filename: string; size: number }>>([]);
  const [orphanedTotalSize, setOrphanedTotalSize] = useState(0);
  const [showOrphanedTab, setShowOrphanedTab] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editor state
  const [showEditor, setShowEditor] = useState(false);
  const [editingSlug, setEditingSlug] = useState<string | null>(null);
  const [editingArticle, setEditingArticle] = useState<WikiArticle | null>(null);

  // Image deletion state
  const [deletingImage, setDeletingImage] = useState<string | null>(null);
  const [imageUsage, setImageUsage] = useState<ImageUsage[]>([]);

  useEffect(() => {
    if (activeTab === 'articles') {
      fetchArticles();
    } else {
      fetchImages();
      fetchOrphanedImages();
    }
  }, [activeTab]);

  const fetchArticles = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/wiki', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to fetch articles');

      const data = await response.json();
      setArticles(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch articles';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchImages = async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/admin/wiki/images', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to fetch images');

      const data = await response.json();
      setImages(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to fetch images';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrphanedImages = async () => {
    try {
      const response = await fetch('/api/admin/wiki/images/orphaned/list', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to fetch orphaned images');

      const data = await response.json();
      setOrphanedImages(data.orphaned || []);
      setOrphanedTotalSize(data.total_size_bytes || 0);
    } catch (err) {
      console.error('Failed to fetch orphaned images:', err);
    }
  };

  const cleanupOrphanedImages = async (filenames: string[]) => {
    if (!confirm(`Delete ${filenames.length} orphaned image(s)? This cannot be undone.`)) {
      return;
    }

    try {
      setLoading(true);
      const response = await fetch('/api/admin/wiki/images/orphaned/cleanup', {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ filenames })
      });

      if (!response.ok) throw new Error('Cleanup failed');

      const result = await response.json();
      setError(null);
      alert(`Deleted ${result.deleted.length} files. ${result.failed.length > 0 ? `Failed: ${result.failed.join(', ')}` : ''}`);
      fetchOrphanedImages();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Cleanup failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateArticle = () => {
    setEditingSlug(null);
    setEditingArticle(null);
    setShowEditor(true);
  };

  const handleEditArticle = (article: WikiArticle) => {
    setEditingSlug(article.slug);
    setEditingArticle(article);
    setShowEditor(true);
  };

  const handleSaveArticle = async (data: {
    slug: string;
    translations: {
      en?: { title: string; content_markdown: string };
      es?: { title: string; content_markdown: string };
      de?: { title: string; content_markdown: string };
      fr?: { title: string; content_markdown: string };
      zh?: { title: string; content_markdown: string };
    };
    is_published: boolean;
    author_id?: string;
  }) => {
    setError(null);

    try {
      const endpoint = editingArticle ? `/api/admin/wiki/${editingArticle.slug}` : '/api/admin/wiki';
      const method = editingArticle ? 'PUT' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Save failed');
      }

      setShowEditor(false);
      fetchArticles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      setError(msg);
      throw err;
    }
  };

  const handleDeleteArticle = async (slug: string, hard: boolean) => {
    if (!confirm(`Are you sure? This will ${hard ? 'permanently delete' : 'archive'} the article.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/wiki/${slug}?hard=${hard}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Delete failed');

      fetchArticles();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setError(msg);
    }
  };

  const handleDeleteImage = async (filename: string) => {
    // First check usage
    try {
      const response = await fetch(`/api/admin/wiki/images/${filename}/usage`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to check usage');

      const usage = await response.json();
      setImageUsage(usage);
      setDeletingImage(filename);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to check image usage';
      setError(msg);
    }
  };

  const confirmDeleteImage = async (filename: string) => {
    if (!confirm(`Are you sure? This will permanently delete the image.`)) {
      return;
    }

    try {
      const response = await fetch(`/api/admin/wiki/images/${filename}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Delete failed');

      setDeletingImage(null);
      setImageUsage([]);
      fetchImages();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      setError(msg);
    }
  };

  const handleExportArticle = async (slug: string) => {
    try {
      setLoading(true);
      const response = await fetch(`/api/admin/wiki/${slug}/export`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Export failed');

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${slug}-${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Export failed';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleImportArticle = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip,application/zip';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        setLoading(true);
        setError(null);

        // Parse ZIP file
        const zip = new JSZip();
        const zipData = await zip.loadAsync(file);

        // Extract metadata
        const metadataFile = zipData.file('article-metadata.json');
        if (!metadataFile) {
          throw new Error('article-metadata.json not found in ZIP');
        }

        const metadataText = await metadataFile.async('text');
        const metadata = JSON.parse(metadataText);

        // Validate metadata
        if (!metadata.slug) {
          throw new Error('Invalid metadata: missing slug');
        }

        // Extract images
        const images: Array<{ filename: string; data: string }> = [];
        const imagesFolder = zipData.folder('images');

        if (imagesFolder) {
          await Promise.all(
            imagesFolder.file(/.+/).map(async (file) => {
              try {
                const data = await file.async('base64');
                images.push({
                  filename: file.name.split('/').pop() || '',
                  data: data,
                });
              } catch (err) {
                console.warn(`Failed to extract image ${file.name}:`, err);
              }
            })
          );
        }

        // Check for conflicts first (best effort)
        let conflictInfo: { exists: boolean; current_languages?: string[] } = { exists: false };
        const checkResponse = await fetch(
          `/api/admin/wiki/import-check/${metadata.slug}`,
          {
            headers: { 'Authorization': `Bearer ${token}` },
          }
        );

        if (checkResponse.ok) {
          conflictInfo = await checkResponse.json();
        }

        let forceImport = false;
        if (conflictInfo.exists) {
          const confirmed = confirm(
            `Article "${metadata.slug}" already exists with languages: ${conflictInfo.current_languages?.join(', ')}\n\nOverwrite all translations?`
          );
          if (!confirmed) {
            setLoading(false);
            return;
          }
          forceImport = true;
        }

        // Send import request
        let importResponse = await fetch('/api/admin/wiki/import', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            metadata,
            images,
            force: forceImport,
            overwriteConfirmed: forceImport,
          }),
        });

        // Fallback: if backend reports conflict, ask confirmation and retry with force=true
        if (!importResponse.ok) {
          const error = await importResponse.json().catch(() => ({ error: 'Import failed' }));
          const errorMessage = error.error || 'Import failed';
          const conflictDetected = errorMessage.includes('already exists');

          if (conflictDetected && !forceImport) {
            const confirmed = confirm(
              `Article "${metadata.slug}" already exists.\n\nOverwrite all translations?`
            );
            if (!confirmed) {
              setLoading(false);
              return;
            }

            importResponse = await fetch('/api/admin/wiki/import', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                metadata,
                images,
                force: true,
                overwriteConfirmed: true,
              }),
            });
          } else {
            throw new Error(errorMessage);
          }
        }

        if (!importResponse.ok) {
          const error = await importResponse.json().catch(() => ({ error: 'Import failed' }));
          throw new Error(error.error || 'Import failed');
        }

        const result = await importResponse.json();
        alert(
          `✅ Import successful!\n\n${result.message}`
        );

        // Refresh articles list
        fetchArticles();
        setActiveTab('articles');
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Import failed';
        setError(msg);
        console.error('Import error:', err);
      } finally {
        setLoading(false);
      }
    };
    input.click();
  };

  if (showEditor) {
    return (
      <WikiEditor
        editingArticle={editingArticle || undefined}
        onSave={handleSaveArticle}
        onCancel={() => setShowEditor(false)}
        token={token}
        userId={userId || ''}
      />
    );
  }

  return (
    <div className="admin-wiki p-6 max-w-7xl mx-auto">
      <h1 className="text-4xl font-bold text-gray-900 mb-6">Wiki Management</h1>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
          <p className="text-red-800 font-semibold">{t('common.error')}</p>
          <p className="text-red-700">{error}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-4 mb-6 border-b border-gray-200">
        <button
          onClick={() => setActiveTab('articles')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'articles'
              ? 'text-primary border-b-2 border-primary'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Articles
        </button>
        <button
          onClick={() => setActiveTab('images')}
          className={`px-6 py-3 font-medium transition-colors ${
            activeTab === 'images'
              ? 'text-primary border-b-2 border-primary'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          Images
        </button>
      </div>

      {/* Articles Tab */}
      {activeTab === 'articles' && (
        <div>
          <div className="flex gap-2 mb-6">
            <button
              onClick={handleCreateArticle}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark font-medium"
            >
              ➕ New Article
            </button>
            <button
              onClick={handleImportArticle}
              className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 font-medium"
            >
              📥 Import Article
            </button>
          </div>

          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : articles.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
              <p className="text-gray-600">No articles yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-300 bg-gray-50">
                    <th className="text-left px-4 py-3 font-semibold text-gray-900">Slug</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-900">Languages</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-900">Status</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-900">Updated</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {articles.map((article) => (
                    <tr key={article.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-sm text-gray-600">{article.slug}</td>
                      <td className="px-4 py-3 text-sm">
                        <div className="flex gap-2">
                          {Object.keys(article.translations).map((lang) => (
                            <span
                              key={lang}
                              className={`inline-block px-2 py-1 rounded text-xs font-semibold ${
                                article.translations[lang as keyof typeof article.translations]?.title
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-600'
                              }`}
                            >
                              {lang.toUpperCase()}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold ${
                            article.is_published
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {article.is_published ? 'Published' : 'Draft'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(article.updated_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleEditArticle(article)}
                          className="text-blue-600 hover:text-blue-800 text-sm font-medium mr-3"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => handleExportArticle(article.slug)}
                          className="text-green-600 hover:text-green-800 text-sm font-medium mr-3"
                        >
                          📥 Export
                        </button>
                        <button
                          onClick={() => handleDeleteArticle(article.slug, false)}
                          className="text-yellow-600 hover:text-yellow-800 text-sm font-medium mr-3"
                        >
                          🗑️ Archive
                        </button>
                        <button
                          onClick={() => handleDeleteArticle(article.slug, true)}
                          className="text-red-600 hover:text-red-800 text-sm font-medium"
                        >
                          🔴 Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Images Tab */}
      {activeTab === 'images' && (
        <div>
          {loading ? (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : images.length === 0 ? (
            <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
              <p className="text-gray-600">No images uploaded yet. Upload images in the article editor.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b-2 border-gray-300 bg-gray-50">
                    <th className="text-left px-4 py-3 font-semibold text-gray-900">Filename</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-900">Original Name</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-900">Usage</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-900">Uploaded</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-900">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {images.map((image) => (
                    <tr key={image.id} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono text-sm text-gray-600">{image.filename}</td>
                      <td className="px-4 py-3 text-gray-700 truncate">{image.original_name}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block px-3 py-1 bg-gray-100 rounded text-sm font-semibold">
                          {image.usage_count}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {new Date(image.created_at).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => handleDeleteImage(image.filename)}
                          className={`text-sm font-medium ${
                            image.usage_count > 0
                              ? 'text-gray-400 cursor-not-allowed'
                              : 'text-red-600 hover:text-red-800'
                          }`}
                          disabled={image.usage_count > 0}
                        >
                          🗑️ Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Orphaned Images Section */}
          {orphanedImages.length > 0 && (
            <div className="mt-8 border-t-2 border-gray-300 pt-8">
              <div className="bg-yellow-50 border-2 border-yellow-300 rounded-lg p-4 mb-4">
                <h3 className="text-lg font-bold text-yellow-900 mb-2">
                  ⚠️ Orphaned Images Found ({orphanedImages.length})
                </h3>
                <p className="text-yellow-800 text-sm">
                  These image files exist on the server but are not registered in the database. 
                  They can be safely deleted to free up disk space.
                </p>
                <p className="text-yellow-800 text-sm font-semibold mt-2">
                  Total size: {(orphanedTotalSize / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b-2 border-gray-300 bg-gray-50">
                      <th className="text-left px-4 py-3 font-semibold text-gray-900">Filename</th>
                      <th className="text-right px-4 py-3 font-semibold text-gray-900">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orphanedImages.map((image) => (
                      <tr key={image.filename} className="border-b border-gray-200 hover:bg-yellow-50">
                        <td className="px-4 py-3 font-mono text-sm text-gray-600">{image.filename}</td>
                        <td className="px-4 py-3 text-right text-sm text-gray-600">
                          {(image.size / 1024).toFixed(2)} KB
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <button
                onClick={() => cleanupOrphanedImages(orphanedImages.map((img) => img.filename))}
                className="mt-4 px-6 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                disabled={loading}
              >
                🗑️ Delete All Orphaned Images
              </button>
            </div>
          )}
        </div>
      )}
      {deletingImage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg p-6 max-w-md">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Delete Image</h3>

            {imageUsage.length > 0 ? (
              <>
                <p className="text-red-600 font-semibold mb-3">
                  ⚠️ This image is used in {imageUsage.length} article(s):
                </p>
                <ul className="bg-red-50 border border-red-200 rounded p-3 mb-4 max-h-48 overflow-y-auto">
                  {imageUsage.map((usage) => (
                    <li key={usage.id} className="text-sm text-red-700">
                      • {usage.title} ({usage.slug})
                    </li>
                  ))}
                </ul>
                <p className="text-gray-600 mb-4">
                  Remove the image from these articles before deleting it.
                </p>
                <button
                  onClick={() => setDeletingImage(null)}
                  className="w-full px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300 font-medium"
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <p className="text-gray-700 mb-6">
                  Are you sure? This will permanently delete the image.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeletingImage(null)}
                    className="flex-1 px-4 py-2 bg-gray-200 text-gray-800 rounded-lg hover:bg-gray-300"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => confirmDeleteImage(deletingImage)}
                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium"
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminWiki;
