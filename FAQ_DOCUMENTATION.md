# FAQ

The FAQ is published as the Wiki article with slug `faq` rather than as a separate FAQ data model.

## Navigation

- `/faq` remains the stable public navbar entry point and redirects to `/help/faq`.
- `/help/faq` renders the article through the shared Wiki viewer. Markdown headings provide the article index and navigation targets.
- `/admin/faq` remains a compatibility URL and redirects to `/admin/wiki`.

## Content Management

Administrators edit the FAQ from Wiki management using the shared multilingual Markdown editor. The article currently has English, Spanish, German, Russian, and Chinese translations. Missing translations can follow the Wiki language fallback behavior.

The legacy `faq` table and dedicated FAQ endpoints are no longer part of the active application path. Migration `20260712_000000_drop_legacy_faq_table.sql` removes the legacy table from existing databases after the Wiki article has been verified.

The import-ready source package is generated under `wiki-artifacts/faq/faq-import.zip` and contains the five translated article bodies.
