# News

News is the public publication stream for platform updates and announcements. The data remains in the `news` table because each publication is an independent, multilingual item; its content is now written and rendered as Markdown using the same sanitized renderer as Wiki articles.

## Public Flow

- Home displays the five most recent localized items.
- The Home News section links to `/news`, which lists all available publications with language fallback, publication date, author, and rendered Markdown content.
- `/news` is public and does not require authentication.

## Administration

Administrators manage publications from `/admin/news` using the shared multilingual Markdown editor with preview and Wiki image insertion. News writes and reads are protected by the backend admin authorization middleware; frontend redirects are not the security boundary.

The public API returns all language rows from `/api/public/news`. The frontend groups rows by publication ID and selects the active language, falling back to English and then to the first available translation.
