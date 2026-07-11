import { marked } from 'marked';
import DOMPurify from 'dompurify';

export interface WikiHeading {
  level: number;
  text: string;
  id: string;
}

export interface RenderedWikiMarkdown {
  html: string;
  headings: WikiHeading[];
}

const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'strong', 'em', 'u', 'del',
  'ol', 'ul', 'li',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'blockquote', 'pre', 'code', 'a', 'img', 'div', 'span',
];

const ALLOWED_ATTR = [
  'href', 'title', 'class', 'id', 'src', 'alt', 'width', 'height',
  'target', 'rel', 'colspan', 'rowspan', 'data-language',
];

/**
 * Convert Markdown into the sanitized HTML shared by wiki, tournament forms,
 * tournament detail pages, and rule-template previews.
 */
export function renderWikiMarkdown(markdown: string): RenderedWikiMarkdown {
  const trimmed = markdown?.trim() || '';
  if (!trimmed) return { html: '', headings: [] };

  const headings: WikiHeading[] = trimmed
    .split('\n')
    .filter((line) => /^#{1,6}\s/.test(line))
    .map((line, index) => {
      const match = line.match(/^(#+)\s+(.*)$/);
      const text = (match?.[2] || '').replace(/[*_`]/g, '').trim();
      return { level: match?.[1].length || 1, text, id: `wiki-heading-${index}` };
    });

  try {
    marked.setOptions({ breaks: false, gfm: true });
    const rawHtml = marked(trimmed) as string;
    let html = DOMPurify.sanitize(rawHtml, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      KEEP_CONTENT: true,
    });

    let renderedHeadingIndex = 0;
    html = html
      .replace(/<h1>/g, '<h1 class="text-4xl font-bold mt-8 mb-4 text-gray-900">')
      .replace(/<h2>/g, '<h2 class="text-3xl font-bold mt-6 mb-3 text-gray-800 border-b-2 border-blue-500 pb-2">')
      .replace(/<h3>/g, '<h3 class="text-2xl font-bold mt-5 mb-2 text-gray-800">')
      .replace(/<h4>/g, '<h4 class="text-xl font-bold mt-4 mb-2 text-gray-700">')
      .replace(/<h5>/g, '<h5 class="text-lg font-bold mt-3 mb-2 text-gray-700">')
      .replace(/<h6>/g, '<h6 class="text-base font-bold mt-2 mb-2 text-gray-600">')
      .replace(/<p>/g, '<p class="my-4 text-gray-800 leading-relaxed">')
      .replace(/<ol>/g, '<ol class="list-decimal list-inside ml-4 my-2 space-y-1">')
      .replace(/<ul>/g, '<ul class="list-disc list-inside ml-4 my-2 space-y-1">')
      .replace(/<li>(\s*)<p>/g, '<li class="text-gray-700">$1')
      .replace(/<\/p>(\s*)<\/li>/g, '$1</li>')
      .replace(/<li>(?!.*class)/g, '<li class="text-gray-700">')
      .replace(/<a /g, '<a class="text-blue-600 underline hover:text-blue-800 hover:no-underline transition-colors" ')
      .replace(/<img src="\/uploads\/wiki\//g, '<img src="' + (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000/api') + '/public/wiki/images/')
      .replace(/<img /g, '<img class="max-w-full h-auto rounded-lg my-2 block" ');

    html = html.replace(/<h([1-6])([^>]*)>([\s\S]*?)<\/h\1>/g, (match, level, attributes, content) => {
      const heading = headings[renderedHeadingIndex++];
      return `<h${level}${attributes} id="${heading?.id || `wiki-heading-${renderedHeadingIndex - 1}`}">${content}</h${level}>`;
    });

    return { html, headings };
  } catch {
    return {
      html: `<p>${DOMPurify.sanitize(trimmed)}</p>`,
      headings,
    };
  }
}
