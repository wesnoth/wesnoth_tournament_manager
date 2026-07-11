/** Public and administrative data contracts for the JSON translation model. */

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
