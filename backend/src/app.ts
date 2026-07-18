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

// CORS configuration - allow Cloudflare Pages and custom domains
const allowedOrigins = [
  'https://wesnoth-tournament-manager.pages.dev',       // Cloudflare Pages (production)
  'https://main.wesnoth-tournament-manager.pages.dev',  // Cloudflare Pages preview (main branch)
  'https://wesnoth.playranked.org',                     // PlayRanked custom domain
  'https://tournament.wesnoth.org',                     // Nginx reverse proxy (production)
  'https://tournament-test.wesnoth.org',                // Test environment
  'http://localhost:3000',                              // Local backend
  'http://localhost:5173'                               // Local frontend (Vite)
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      // Allow requests with no origin (like mobile apps or curl requests)
      callback(null, true);
    } else if (allowedOrigins.includes(origin)) {
      // Exact match
      callback(null, true);
    } else if (origin.endsWith('.wesnoth-tournament-manager.pages.dev') || origin.includes('wesnoth-tournament-manager.pages.dev')) {
      // Allow all subdomains of wesnoth-tournament-manager.pages.dev (main, PR previews, etc.)
      callback(null, true);
    } else if (origin.includes('tournament.wesnoth.org')) {
      // Allow requests from tournament.wesnoth.org (for Cloudflare preview deployments)
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
}));

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
if (process.env.NODE_ENV === 'test') {
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
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Global error handler:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
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
