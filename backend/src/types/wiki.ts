/**
 * Wiki Article Types
 */

export interface WikiArticle {
  id: number;
  slug: string;
  title: string;
  content_markdown: string;
  language: string;
  author_id: number | null;
  is_published: boolean;
  created_at: string;
  updated_at: string;
}

export interface WikiArticleResponse extends Omit<WikiArticle, 'is_published'> {
  is_published: 0 | 1;
}

export interface WikiArticlePublic {
  slug: string;
  title: string;
  content_markdown: string;
  language: string;
  created_at: string;
  updated_at: string;
}

export interface WikiListItem {
  slug: string;
  title: string;
  language: string;
  updated_at: string;
}

export interface WikiArticleRequestParams {
  slug: string;
  lang?: string;
}
