import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import MainLayout from '../components/MainLayout';
import MarkdownPreview from '../components/MarkdownPreview';
import { adminService } from '../services/api';

interface RuleTemplate {
  id: string;
  title: string;
  content_markdown: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

const emptyForm = {
  id: '',
  title: '',
  content_markdown: '',
  is_active: true,
};

const AdminRuleTemplates: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, isTournamentModerator } = useAuthStore();
  const [templates, setTemplates] = useState<RuleTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [form, setForm] = useState(emptyForm);

  useEffect(() => {
    if (!isAuthenticated || (!isAdmin && !isTournamentModerator)) {
      navigate('/');
      return;
    }
    void fetchTemplates();
  }, [isAuthenticated, isAdmin, isTournamentModerator, navigate]);

  const fetchTemplates = async () => {
    try {
      setLoading(true);
      const res = await adminService.getRuleTemplates();
      setTemplates(res.data || []);
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to load rule templates');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => setForm(emptyForm);

  const handleSave = async () => {
    if (!form.title.trim() || !form.content_markdown.trim()) {
      setError('Title and markdown content are required');
      return;
    }

    try {
      setSaving(true);
      setError('');
      if (form.id) {
        await adminService.updateRuleTemplate(form.id, {
          title: form.title.trim(),
          content_markdown: form.content_markdown,
          is_active: form.is_active,
        });
        setSuccess('Rule template updated');
      } else {
        await adminService.createRuleTemplate({
          title: form.title.trim(),
          content_markdown: form.content_markdown,
          is_active: form.is_active,
        });
        setSuccess('Rule template created');
      }
      resetForm();
      await fetchTemplates();
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to save rule template');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (tpl: RuleTemplate) => {
    setForm({
      id: tpl.id,
      title: tpl.title,
      content_markdown: tpl.content_markdown,
      is_active: tpl.is_active === 1,
    });
  };

  const handleDelete = async (templateId: string) => {
    if (!window.confirm('Delete this rule template?')) return;
    try {
      setError('');
      await adminService.deleteRuleTemplate(templateId);
      await fetchTemplates();
      setSuccess('Rule template deleted');
      setTimeout(() => setSuccess(''), 2500);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Failed to delete rule template');
    }
  };

  return (
    <MainLayout>
      <div className="max-w-7xl mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-800 mb-6">Tournament Rule Templates</h1>

        {error && <p className="bg-red-100 border border-red-300 text-red-700 px-4 py-3 rounded mb-4">{error}</p>}
        {success && <p className="bg-green-100 border border-green-300 text-green-700 px-4 py-3 rounded mb-4">{success}</p>}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">{form.id ? 'Edit template' : 'New template'}</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
                <input
                  value={form.title}
                  onChange={(e) => setForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full border border-gray-300 rounded px-3 py-2"
                  placeholder="e.g. Standard 1v1 Rules"
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  id="template-active"
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((prev) => ({ ...prev, is_active: e.target.checked }))}
                />
                <label htmlFor="template-active" className="text-sm text-gray-700">Active template</label>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rules markdown</label>
                <textarea
                  value={form.content_markdown}
                  onChange={(e) => setForm((prev) => ({ ...prev, content_markdown: e.target.value }))}
                  className="w-full min-h-[280px] border border-gray-300 rounded px-3 py-2 font-mono text-sm"
                  placeholder="# Rules&#10;&#10;- Rule 1&#10;- Rule 2"
                />
              </div>
              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : form.id ? 'Update template' : 'Create template'}
                </button>
                {form.id && (
                  <button onClick={resetForm} className="px-4 py-2 bg-gray-200 rounded hover:bg-gray-300">
                    Cancel edit
                  </button>
                )}
              </div>
            </div>
          </section>

          <section className="bg-white rounded-lg shadow p-6">
            <h2 className="text-xl font-semibold mb-4">Preview</h2>
            <MarkdownPreview markdown={form.content_markdown} emptyMessage="Write markdown to preview the rendered rules." />
          </section>
        </div>

        <section className="bg-white rounded-lg shadow p-6 mt-6">
          <h2 className="text-xl font-semibold mb-4">Existing templates</h2>
          {loading ? (
            <p className="text-gray-600">Loading templates...</p>
          ) : templates.length === 0 ? (
            <p className="text-gray-600">No templates yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2">Title</th>
                    <th className="text-left py-2">Status</th>
                    <th className="text-left py-2">Updated</th>
                    <th className="text-left py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {templates.map((tpl) => (
                    <tr key={tpl.id} className="border-b">
                      <td className="py-2">{tpl.title}</td>
                      <td className="py-2">{tpl.is_active === 1 ? 'Active' : 'Disabled'}</td>
                      <td className="py-2">{new Date(tpl.updated_at).toLocaleString()}</td>
                      <td className="py-2">
                        <button
                          onClick={() => handleEdit(tpl)}
                          className="mr-3 text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDelete(tpl.id)}
                          className="text-red-600 hover:text-red-800"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </MainLayout>
  );
};

export default AdminRuleTemplates;

