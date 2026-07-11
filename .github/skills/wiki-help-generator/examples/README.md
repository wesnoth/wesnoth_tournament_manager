# Wiki Help Generator - Example Output

This folder contains an example of what the wiki-help-generator skill produces.

## Structure

```
matches-output/
├── en/
│   ├── markdown.md
│   └── screenshots/
│       ├── 1781817655396_hgn6m6o.png
│       ├── 1781818945833_8ug06.png
│       ├── 1781819051699_alfi6s.png
│       ├── 1781817919922_hpq8cs.png
│       ├── 1781817981599_cpr72v.png
│       ├── 1781818545716_b3x044.png
│       └── 1781818721602_2x0psi.png
├── es/
│   ├── markdown.md
│   └── screenshots/
│       ├── 1781817655396_hgn6m6o.png  (same images, different language in UI)
│       ├── 1781818945833_8ug06.png
│       ├── 1781819051699_alfi6s.png
│       ├── 1781817919922_hpq8cs.png
│       ├── 1781817981599_cpr72v.png
│       ├── 1781818545716_b3x044.png
│       └── 1781818721602_2x0psi.png
├── de/
│   ├── markdown.md
│   └── screenshots/
└── (zh, ru follow same pattern)
```

## What This Shows

### Markdown Files

- `en/markdown.md` - Article in English following the 3-step structure
- `es/markdown.md` - Article in Spanish with same structure
- `de/`, `zh/`, `ru/` - Additional language versions

Each markdown file:
- Follows the obligatory 3-step pattern:
  1. **What is this page?** - Purpose and prerequisites
  2. **What can you do?** - List of main actions
  3. **What happens when you do each action?** - Detailed explanations with screenshots
- References images using `/api/public/wiki/images/{filename}.png` format
- Links to other help articles using `/help/{slug}` format
- Uses Markdown syntax (no HTML)

### Screenshots

Each language folder contains the same screenshots but:
- Captured with the UI in that language
- Users see their native language UI in the help article
- All screenshots have the same filenames (universal reference)

**Example filenames:**
- `1781817655396_hgn6m6o.png` - Match list view
- `1781818945833_8ug06.png` - Preliminary match indicator
- `1781819051699_alfi6s.png` - Confirmation form
- etc.

## How to Use This Example

1. **Review the markdown** - See how articles are structured
2. **Check the image references** - Notice how they reference `/api/public/wiki/images/`
3. **Check internal links** - Notice they use `/help/` paths
4. **Follow the pattern** - When generating new articles, follow this 3-step structure

## Import to Wiki Admin

After the skill generates output like this:

1. Go to `https://tournament-test.wesnoth.org/admin/wiki`
2. Click **"New Article"** (or **"Import Article"** for ZIP import)
3. For each language:
   - Paste the markdown content from `{language}/markdown.md`
   - Set slug to `matches` (same for all languages)
   - Select the language (en, es, de, etc.)
   - Upload screenshots from `{language}/screenshots/`
   - Click **"Save"**

## Key Points

✅ **3-step structure** - Obligatory pattern for all articles
✅ **Multi-language** - 5 languages with same images, different UI language
✅ **Internal links** - Use `/help/` not app routes
✅ **Image references** - Use `/api/public/wiki/images/` format
✅ **No HTML** - Markdown only, no HTML tags

## Notes

- The example uses filenames from the actual production matches article
- Actual images would be captured fresh for each article
- The markdown content is for demonstration (real content would be generated from actual captures)
- This structure is ready for import via the wiki admin UI
