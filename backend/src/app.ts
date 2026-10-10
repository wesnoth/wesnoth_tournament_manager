import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import matchRoutes from './routes/matches.js';
import tournamentRoutes from './routes/tournaments.js';
import tournamentCompetitionRoutes from './routes/tournamentCompetition.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import statisticsRoutes from './routes/statistics.js';
import playerStatisticsRoutes from './routes/player-statistics.js';
import replaysRoutes from './routes/replays.js';
import schedulingRoutes from './routes/tournament-scheduling.js';
import notificationsRoutes from './routes/notifications.js';
import challengesRoutes from './routes/challenges.js';
import wikiRoutes from './routes/wiki.js';
import wikiAdminRoutes from './routes/wikiAdmin.js';
import adminRuleTemplatesRoutes from './routes/adminRuleTemplates.js';
import ruleTemplatesRoutes from './routes/ruleTemplates.js';
import testToolsRoutes from './routes/testTools.js';
import { generalLimiter } from './middleware/rateLimiter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

/**
 * Resolve Express's `trust proxy` setting from `TRUST_PROXY`.
 *
 * The backend is reachable only through a reverse proxy, so the TCP peer is
 * always the proxy and the real client address arrives in `X-Forwarded-For`.
 * Express only derives `req.ip` from that header when told which proxies to
 * trust; every IP-keyed rate limiter depends on `req.ip`.
 *
 * Accepted values:
 * - unset, empty, `false`, `off`, or `0`: trust nothing (`req.ip` is the TCP peer).
 * - a positive integer: the number of proxy hops in front of the backend.
 * - an address, CIDR, or Express preset (`loopback`, `linklocal`, `uniquelocal`),
 *   comma-separated: trust only those proxy addresses (the strictest option).
 *
 * `true` is rejected on purpose: it trusts the left-most `X-Forwarded-For`
 * entry, which the client controls, so any client could choose its own
 * rate-limit key and audit IP. It falls back to trusting nothing.
 */
const resolveTrustProxy = (value: string | undefined): boolean | number | string[] => {
  const normalized = (value || '').trim();
  const lower = normalized.toLowerCase();
  if (['', 'false', 'off', '0'].includes(lower)) return false;
  if (['true', 'on'].includes(lower)) {
    console.warn('⚠️  TRUST_PROXY=true is unsafe (client-controlled X-Forwarded-For); set a hop count or proxy address. Trusting no proxy.');
    return false;
  }
  if (/^\d+$/.test(normalized)) return Number(normalized);
  return normalized.split(',').map((entry) => entry.trim()).filter(Boolean);
};

const trustProxy = resolveTrustProxy(process.env.TRUST_PROXY);
app.set('trust proxy', trustProxy);
console.log(`ℹ️  TRUST_PROXY: ${JSON.stringify(trustProxy)}`);

/**
 * CORS: exact origins only. Production and TEST serve the frontend and the
 * API from the same host behind the reverse proxy, so cross-origin requests
 * come only from the local Vite dev server. Origins are compared exactly; a
 * substring check (as the former Cloudflare Pages setup used) would also
 * accept hosts such as tournament.wesnoth.org.example.com.
 */
const allowedOrigins = new Set([
  'https://tournament.wesnoth.org',
  'https://tournament-test.wesnoth.org',
  'http://localhost:5173',
]);

app.use(cors({
  origin: (origin, callback) => {
    // Requests without an Origin header (curl, server-to-server, same-origin
    // navigation) are not subject to CORS.
    if (!origin || allowedOrigins.has(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  // Let a cross-origin frontend (the local dev server) read the stale-session
  // signal set by optionalAuthMiddleware; browsers hide non-safelisted headers
  // otherwise.
  exposedHeaders: ['X-Session-Rejected'],
}));

// Expose only this non-sensitive feature flag to the frontend. The simulator
// routes below still enforce authentication and authorization independently.
app.get('/api/config/features', (_req, res) => {
  res.json({
    tournament_simulation: ['on', 'true', '1'].includes(
      String(process.env.TOURNAMENT_SIMULATION || '').toLowerCase()
    ),
  });
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve uploaded files (replays, wiki images)
const uploadsPath = path.join(__dirname, '..', 'uploads');
app.use('/uploads', express.static(uploadsPath));

// Apply general rate limiting to all API routes (except specific endpoints with stricter limits)
app.use('/api/', generalLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/matches', matchRoutes);
// The phase-engine competition router is mounted before the tournament
// management router so it owns shared paths such as /:id/prepare and /:id/start.
app.use('/api/tournaments', tournamentCompetitionRoutes);
app.use('/api/tournaments', tournamentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/admin/wiki', wikiAdminRoutes);
app.use('/api/admin/rule-templates', adminRuleTemplatesRoutes);
app.use('/api/public', publicRoutes);
app.use('/api/public/wiki', wikiRoutes);
app.use('/api/rule-templates', ruleTemplatesRoutes);
app.use('/api/statistics', statisticsRoutes);
app.use('/api/player-statistics', playerStatisticsRoutes);
app.use('/api/replays', replaysRoutes);
app.use('/api/tournament-scheduling', schedulingRoutes);
app.use('/api/challenges', challengesRoutes);
app.use('/api/notifications', notificationsRoutes);
if (['on', 'true', '1'].includes(String(process.env.TOURNAMENT_SIMULATION || '').toLowerCase())) {
  app.use('/api/test-tools', testToolsRoutes);
}

// Health check endpoints
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Global error handler - MUST be last
// Only client errors explicitly marked `expose` (set by http-errors, e.g. body
// parser failures such as malformed JSON or 413) keep their message. Every
// other error, including all 5xx, returns a generic message so SQL, paths, or
// stack-derived text never reach the client; the full error stays in the log.
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', err);
  const status = Number.isInteger(err?.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  const exposeMessage = status < 500 && err?.expose === true && typeof err.message === 'string';
  res.status(status).json({
    error: exposeMessage ? err.message : 'Internal server error',
    path: req.path,
    method: req.method,
  });
});

// 404 handler - catch all unmatched routes
app.use((req: express.Request, res: express.Response) => {
  console.error('404 - Route not found:', req.method, req.path);
  res.status(404).json({
    error: 'Route not found',
    path: req.path,
    method: req.method,
  });
});

export default app;
