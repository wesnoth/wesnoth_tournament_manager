# Wiki Help Generator Skill

A Copilot skill that automates the creation of help articles for the Wesnoth Tournament Manager by using Playwright to capture screenshots, organize images by language, and generate structured markdown.

## Quick Start

### Example Usage

```
Generate help for the matches page. Document how to confirm preliminary matches, use match actions (Inform/Report/Dispute), and show match statuses.
```

The skill will:

1. ✅ Capture screenshots in TEST environment for all 5 languages
2. ✅ Organize images into language-specific folders
3. ✅ Generate markdown following the obligatory 3-step structure
4. ✅ Prepare everything for wiki import

### Output Location

All generated files go to:
```
wiki-artifacts/
└── {page-slug}/
    ├── en/
    │   ├── markdown.md
    │   └── screenshots/
    ├── es/
    │   ├── markdown.md
    │   └── screenshots/
    ├── de/
    ├── zh/
    └── ru/
```

## Key Concepts

### The 3-Step Structure

Every article follows this mandatory pattern:

```
## What is this page?
→ Explanation + prerequisites

## What can you do?
→ List of actions

## What happens when you do each action?
→ Detailed explanations + screenshots
```

### Multi-Language Support

Screenshots are captured for **all 5 languages**:

| Language | Code |
|----------|------|
| English  | `en` |
| Spanish  | `es` |
| German   | `de` |
| Chinese  | `zh` |
| Russian  | `ru` |

Each language gets its own folder with:
- Screenshots in that language's UI
- Markdown with localized formatting

### Image Organization

```
matches/
├── en/screenshots/
│   ├── auto-confirmed-match.png
│   ├── preliminary-match.png
│   └── dispute-form.png
├── es/screenshots/
│   ├── auto-confirmed-match.png
│   ├── preliminary-match.png
│   └── dispute-form.png
└── (de, zh, ru follow same pattern)
```

Each language folder contains **identical screenshots** but with UI rendered in that language.

## How It Works

### 1. You Describe What to Document

In natural language, tell what you want documented:

> "Create help for the tournaments page. Show how to create a new tournament, configure match formats, and start tournament play."

### 2. Skill Captures with Playwright

For each of 5 languages:
- Opens test environment in correct language
- Navigates through the page
- Captures screenshots of each section/action
- Saves images organized by language

### 3. Generates Structured Markdown

Creates markdown files following the 3-step pattern:

```markdown
# Tournaments

## What is this page?

The **Tournaments** page allows you to...

## What can you do?

- Create tournaments
- Configure match formats
- Start tournament play

## What happens when you do each action?

### Create Tournaments
First, navigate to the tournaments page...
[screenshot here]

### Configure Match Formats
Choose your format...
[screenshot here]
```

### 4. Outputs Ready-to-Import

All files are organized and ready to import via the wiki admin UI:

```
wiki-artifacts/tournaments/
├── en/markdown.md + screenshots/
├── es/markdown.md + screenshots/
├── de/markdown.md + screenshots/
├── zh/markdown.md + screenshots/
└── ru/markdown.md + screenshots/
```

## Describing What to Document

### ✅ Good Descriptions

**Specific and actionable:**
> "Document the rankings page. Show the global rankings table, how to view a player's rank, and how to filter by season and faction."

**Clear sections:**
> "For the matches page, I need:
> 1. Visual difference between auto-confirmed (white) vs preliminary (yellow) matches
> 2. How to confirm a preliminary match with the form
> 3. The match actions: Inform Match, Report Match, Dispute Match"

**Action-oriented:**
> "Create help for profile page. Include setting up ranked matches, changing language preference, and rating opponent history."

### ❌ Vague Descriptions

**Too vague:**
> "Document the matches page"

→ What specifically about matches? What actions?

**Missing details:**
> "Help for tournaments"

→ Which aspects? Creation? Management? Participation?

## Requirements for Skill Input

When you request the skill, provide:

1. **Page name** (e.g., "matches", "tournaments", "players")
2. **What to document** (sections, actions, workflows)
3. **Languages** (default: all 5, or specify subset)
4. **Any special notes** (login required? Prerequisites?)

### Example Complete Request

```
Page: matches
Document:
- Visual differences between auto-confirmed vs preliminary matches
- How to confirm preliminary matches (form, fields, outcomes)
- Available match actions (Inform Match, Report Match, Dispute)
- Match statuses (Reported, Confirmed, Cancelled, Disputed)

Languages: all 5 (en, es, de, zh, ru)

Note: User must be logged in to view actions. Show which matches are displayed with colored backgrounds.
```

## Generated Markdown Format

### Header Hierarchy

```markdown
# Page Title (H1)

## What is this page? (H2)
Content...

## What can you do? (H2)
- List of actions
- Each action
- With descriptions

## What happens when you do each action? (H2)

### Action 1 Name (H3)
Description and screenshots...

### Action 2 Name (H3)
Description and screenshots...
```

### Image Embedding

Images are embedded with this format:

```markdown
![Descriptive alt text](/api/public/wiki/images/FILENAME.png)
```

**Example:**
```markdown
![Preliminary match with yellow background and confirmation button](/api/public/wiki/images/1781818945833_8ug06.png)
```

### Internal Links

Link to other help articles using:

```markdown
[link text](/help/page-slug)
```

**Examples:**
- `[Rankings](/help/rankings)` — links to rankings help
- `[Players](/help/players)` — links to players help
- `[Getting Started](/help/getting-started)` — links to getting started

**NOT** application URLs:
- ❌ `/matches` (app route)
- ❌ `/tournaments` (app route)
- ✅ `/help/matches` (wiki route)

## After Generation

### 1. Review the Output

Check the generated `wiki-artifacts/{page-slug}/` folder:

```bash
tree wiki-artifacts/matches/
matches/
├── en/
│   ├── markdown.md
│   └── screenshots/ (3+ images)
├── es/
│   ├── markdown.md
│   └── screenshots/
└── (de, zh, ru...)
```

### 2. Edit if Needed

You can manually edit generated markdown files:

```bash
vim wiki-artifacts/matches/en/markdown.md
```

### 3. Import to Wiki Admin

Navigate to `https://tournament-test.wesnoth.org/admin/wiki`:

- Click **"New Article"** or **"Import Article"**
- Upload the markdown content and images
- Select language (en, es, de, zh, or ru)
- Set slug to page name (e.g., "matches")
- Click **"Save"**

### 4. Repeat for All Languages

Import each language version from the corresponding folder.

## File Structure

```
.github/skills/wiki-help-generator/
├── SKILL.md                    # Detailed skill instructions
├── README.md                   # This file (user guide)
├── playwright-wrapper.ts       # Playwright utilities
├── markdown-builder.ts         # Markdown generation logic
├── image-processor.ts          # Image organization
└── examples/
    └── example-article/        # Example of generated output
        ├── en/
        │   ├── markdown.md
        │   └── screenshots/
        ├── es/
        ├── de/
        ├── zh/
        └── ru/
```

## Common Workflows

### Document a New Page

1. User: "Create help for [page name]. Document [actions]."
2. Skill: Captures screenshots, generates markdown
3. User: Reviews output, possibly edits
4. User: Imports to wiki admin UI for each language

### Update Existing Help

1. User: "Update the matches page help. Add documentation for [new feature]."
2. Skill: Captures new screenshots, generates updated markdown
3. User: Reviews, decides to overwrite or keep both versions
4. User: Imports updated version to wiki admin UI

### Multi-Language Help

Skill automatically handles all 5 languages:

- Captures UI in each language
- Organizes screenshots by language
- Generates markdown for each language
- Each language folder is independent and complete

### Export/Import Between Environments

Once imported to wiki:

1. Admin clicks **"Export"** on an article → downloads ZIP
2. ZIP contains all language versions + images
3. Can import ZIP to another environment or backup
4. On import, system asks about overwrites

## Markdown Support

### ✅ Supported Elements

- Headers (H1-H6) with `#`
- **Bold** with `**text**`
- *Italic* with `*text*`
- Unordered lists with `-`, `*`, or `+`
- Ordered lists with `1.`, `2.`, etc.
- Blockquotes with `>`
- Code blocks with triple backticks
- Inline code with backticks
- Links `[text](url)`
- Images `![alt](url)`
- Horizontal rules `---`
- Tables

### ❌ NOT Supported (Filtered for Security)

- HTML tags (e.g., `<div>`, `<span>`)
- Colored text with `<span style="color:...">`
- Custom styles
- JavaScript event handlers
- External stylesheets

### Markdown Best Practices

1. **Start with H1** — The page title
2. **Use clear headers** — Descriptive section names
3. **Use lists** — Better than paragraphs for procedures
4. **Add examples** — Show what users will see
5. **Link related articles** — Use `/help/` paths
6. **Use alt text** — Make images accessible
7. **Keep sections short** — Break into logical chunks

## Playwright Configuration

The skill uses Playwright with these settings:

- **Browser**: Chromium
- **Headless**: Yes (no GUI)
- **Viewport**: 1920x1080 (standard desktop)
- **Timeout**: 30s per action
- **Screenshots**: PNG format

### Environment

- **Test URL**: `https://tournament-test.wesnoth.org`
- **Test User**: Provided or prompted
- **Languages**: en, es, de, zh, ru

## Troubleshooting

### Missing Screenshots

**Problem**: Some language folders are empty  
**Solution**: Check that test environment is accessible for all languages. May need to retry capturing.

### Incorrect Language

**Problem**: Screenshots show English even for Spanish folder  
**Solution**: Verify that UI language selector works and test user has all language settings enabled.

### Image URLs Not Working

**Problem**: Images show broken links in preview  
**Solution**: 
- Check that images are in correct folder
- Verify filenames match in markdown (e.g., `1781817452133_xyz.png`)
- Ensure image URL format: `/api/public/wiki/images/FILENAME.png`

### Markdown Not Rendering

**Problem**: Markdown looks broken in wiki editor  
**Solution**:
- Check for unclosed markdown syntax (missing closing `**`, `*`, etc.)
- Verify no HTML tags are used
- Check internal links use `/help/` prefix, not app routes

## Tips & Tricks

### Batch Generate Multiple Articles

Request multiple articles in sequence:

1. Generate help for "matches"
2. Generate help for "tournaments"
3. Generate help for "players"
4. Import all to wiki admin

### Focus on Key Actions

Don't document every minor feature. Focus on:
- Main workflows users follow
- Common questions users ask
- Complex features that need explanation
- How to get help or report issues

### Use Existing Help as Reference

Look at already-documented pages (e.g., matches help on production) to understand the style and depth expected.

### Review Before Importing

Always review generated markdown:
- Is structure clear?
- Are screenshots helpful?
- Do links work?
- Is text accurate?

### Version Control

Generated wiki-artifacts are not version controlled. Keep backups:
```bash
zip -r wiki-artifacts-backup.zip wiki-artifacts/
```

## License

AGPL-3.0-or-later

This skill is part of the Wesnoth Tournament Manager and follows the same license as the main project.

## Support

For issues or questions:
1. Check SKILL.md for detailed instructions
2. Review examples/ folder for reference output
3. Check wiki editor syntax in the application itself
4. File an issue on GitHub if skill has bugs
