# Frontend Environment Configuration

The Vite frontend reads configuration at build time. Environment files are local or deployment-specific and must not be committed; `frontend/.env.example` documents the supported baseline.

## API Endpoint

`VITE_API_BASE_URL` is the absolute backend API base URL, including `/api`.

```env
VITE_API_BASE_URL=http://localhost:3000/api
```

Production and test builds must set this value to their corresponding HTTPS API endpoint. Because Vite embeds it in the generated bundle, changing the variable requires rebuilding the frontend.

## Debug Logging

`VITE_DEBUG_LOGS=true` enables selected frontend diagnostic messages. Leave it unset or false for public builds.

Environment values prefixed with `VITE_` are visible to browser code and must never contain credentials, private tokens, or server-only configuration.
