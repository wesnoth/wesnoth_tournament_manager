# Contributing to Wesnoth Tournament Manager

Thank you for your interest in contributing to this project! This document explains how to contribute and what you need to know about our AGPL license.

## 📋 Legal Requirements - AGPL-3.0-or-later

This project uses the GNU Affero General Public License v3 (AGPL-3.0-or-later).

### What this means for contributors:

1. Your contributions are also AGPL-3.0
   - Any code you submit is automatically licensed under the AGPL.
   - There is nothing special you need to do — licensing is applied automatically.

2. If you use our code in a service, you must share improvements
   - If you deploy improvements in a service, you must make the source available to users.
   - This is the core of AGPL: improvements benefit the community.

3. License compatibility
   - Our dependencies (MIT, BSD, ISC, Apache-2.0 dev-only) are compatible.
   - Your new code will be AGPL, which is compatible with those licenses.

### Why AGPL?

- ✅ Transparency: Service source code is visible to users.
- ✅ Community: Improvements benefit everyone.
- ✅ Trust: Users can audit the code.
- ✅ Open philosophy: Reflects our commitment to open-source tournaments.

## 🔧 Contribution Process

### Step 1: Fork and Clone

```bash
git clone https://github.com/your-username/wesnoth_tournament_manager.git
cd wesnoth_tournament_manager
```

### Step 2: Create a branch

```bash
git checkout -b feature/your-feature-name
# or for bug fixes:
# git checkout -b fix/brief-bug-description
```

### Step 3: Make changes

```bash
# Edit files and commit
git commit -m "Clear description of changes"
```

### Step 4: Push and open a Pull Request

```bash
git push origin feature/your-feature-name
```

Then open a Pull Request on GitHub.

## 📝 Style Guides

### Commits

Use clear commit messages in English or Spanish:
- ✅ "Fix avatar display on user profile page"
- ✅ "Add AGPL license disclaimer to footer"
- ❌ "fix stuff"
- ❌ "asdfgh"

### Code

- Backend (TypeScript / Node.js)
  - Use strict TypeScript.
  - Follow the existing code style.
  - Add explicit types where needed.

- Frontend (React / TypeScript)
  - Use functional components.
  - Prefer React hooks.
  - Keep components small and reusable.
  - Add stable `data-help-id` hooks to new or functionally changed controls so Wiki Help can capture and document them without relying on translated text or CSS structure.
  - Use semantic `action-`, `field-`, and `option-` prefixes for controls, and reserve `region-` for large documentation areas that need an independent screenshot.

- Tests
  - Include tests for critical new code.
  - Ensure tests pass locally.

### Documentation

- Update README.md if configuration changes.
- Document new APIs.
- Write all source-code comments/JSDoc and Markdown documentation in English.
- Treat comments/JSDoc in the source code as the detailed documentation for functions and implementation behavior.
- Keep Markdown documentation high-level and stable: describe architecture, responsibilities, configuration, workflows, and policies without duplicating volatile code details.
- Add concise comments for complex code, focusing on intent and non-obvious behavior.

## 🐛 Reporting Bugs

Please use GitHub Issues and include:

```markdown
**Description:**
[Clear description of the bug]

**Steps to reproduce:**
1.
2.
3.

**Expected result:**
[What should happen]

**Actual result:**
[What happens]

**Environment:**
- OS:
- Node.js version:
- Browser:
```

## 💡 Suggesting Improvements

Open an Issue and include:

```markdown
**Improvement description:**
[What you want to add or change]

**Why is it useful?**
[How it benefits the project]

**Possible implementation:**
[Ideas on how to implement it]
```

## 🏗️ Overall Architecture

### Backend

```
backend/
├── src/
│   ├── server.ts          # Entry point
│   ├── app.ts             # Express configuration
│   ├── routes/            # API routes
│   ├── middleware/        # Middleware (auth, CORS, etc.)
│   ├── services/          # Business logic
│   ├── utils/             # Helper functions
│   ├── types/             # TypeScript interfaces
│   └── config/            # Configuration
├── migrations/            # DB migrations
└── package.json

Key: Database (MariaDB) via app configuration
```

### Frontend

```
frontend/
├── src/
│   ├── main.tsx           # Entry point
│   ├── App.tsx            # Root component
│   ├── pages/             # Pages (routes)
│   ├── components/        # Reusable components
│   ├── services/          # API calls (axios)
│   ├── store/             # Zustand stores
│   ├── utils/             # Helper functions
│   ├── styles/            # CSS modules
│   ├── locales/           # i18n translations
│   └── types/             # TypeScript interfaces
├── public/
│   └── wesnoth-avatars/   # Avatar images and manifest
└── package.json

Key: React 18 + Vite + React Router + i18next
```

## 🚀 Development Setup

```bash
# Clone
git clone https://github.com/your-username/wesnoth_tournament_manager.git

# Backend
cd backend
npm ci
cp .env.example .env
# Edit .env with your values
npm run dev

# Frontend (in another terminal)
cd frontend
npm ci
npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:3000

## ✅ Pre-push Checklist

- [ ] Code follows project style
- [ ] Commit messages are clear
- [ ] Builds and TypeScript checks pass; integration tests follow [TESTING.md](TESTING.md)
- [ ] No unnecessary console.log() calls
- [ ] No unused dependencies
- [ ] Documentation updated
- [ ] You understand your code will be AGPL-3.0

## 📚 Important Documentation

- [TESTING.md](TESTING.md) - Verification baseline and integration-test constraints
- [AGENTS.md](AGENTS.md) - Repository engineering policies
- [LICENSE](LICENSE) - Full AGPL-3.0 text
- [README.md](README.md) - Project overview

## ❓ Questions?

- Open an Issue for questions about the code.
- Check existing issues before opening a new one.
- Be respectful and constructive in discussions.

## 🙏 Thank you

Thank you for considering contributing to this project! Every contribution, no matter the size, helps improve the software for the entire Wesnoth community.

---

**Legal Note**: By contributing you agree that your code will be licensed under AGPL-3.0-or-later, the same as the rest of the project.
