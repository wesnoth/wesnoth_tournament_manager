# Localization

The application interface supports English, Spanish, German, Russian, and Chinese through the frontend i18n resources. English is the default and fallback language.

## Content Models

Interface labels belong in the locale JSON files. User-authored multilingual content keeps its translations with its own data model:

- News records are grouped by logical item and resolved to the viewer's language in the frontend, falling back to English and then to any available translation.
- Wiki articles, including FAQ and Help content, use the Wiki translation and fallback workflow.
- Administrative forms use the shared Markdown translation editor where rich translated content is required.

The fallback must produce one visible logical item, not one item per stored language. Missing translations must not hide content that has a valid English version.

## Maintenance

When adding a supported language, update the locale resources, language selectors, content-editor language definitions, backend validation, and database constraints together. Detailed transformation behavior belongs beside `frontend/src/utils/languageFallback.ts`; Wiki-specific policy belongs in `WIKI_DOCUMENTATION.md`.
