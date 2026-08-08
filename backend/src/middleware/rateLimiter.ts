import rateLimit from 'express-rate-limit';

// Local development makes many parallel requests while loading tournament pages.
// Keep production limits unchanged, but make the development defaults forgiving;
// every value can still be overridden explicitly through the environment.
const isProduction = process.env.NODE_ENV === 'production';
const getLimit = (name: string, productionDefault: number, developmentDefault: number): number => {
  const configured = Number(process.env[name]);
  if (Number.isFinite(configured) && configured > 0) return configured;
  return isProduction ? productionDefault : developmentDefault;
};

const getWindowMs = (name: string, defaultValue: number): number => {
  const configured = Number(process.env[name]);
  return Number.isFinite(configured) && configured > 0 ? configured : defaultValue;
};

const loginWindowMs = getWindowMs('RATE_LIMIT_LOGIN_WINDOW_MS', 15 * 60 * 1000);
const generalWindowMs = getWindowMs('RATE_LIMIT_GENERAL_WINDOW_MS', 60 * 1000);
const searchWindowMs = getWindowMs('RATE_LIMIT_SEARCH_WINDOW_MS', 60 * 1000);
const loginMax = getLimit('RATE_LIMIT_LOGIN_MAX', 10, 50);
const generalMax = getLimit('RATE_LIMIT_GENERAL_MAX', 100, 1000);
const searchMax = getLimit('RATE_LIMIT_SEARCH_MAX', 10, 60);

/**
 * Rate limiter for login endpoint
 * Prevents brute force password attacks
 * Production limit: 10 attempts per 15 minutes per IP.
 */
export const loginLimiter = rateLimit({
  windowMs: loginWindowMs,
  max: loginMax,
  message: 'Too many login attempts from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
  handler: (req, res) => {
    console.warn(`Login rate limit exceeded for IP: ${req.ip}, attempted user: ${req.body?.nickname}`);
    res.status(429).json({
      error: 'Too many login attempts',
      message: 'Please try again after 15 minutes',
      retryAfter: res.getHeader('Retry-After')
    });
  }
});

/**
 * General rate limiter for API endpoints
 * Prevents resource exhaustion and API abuse
 * Production limit: 100 requests per minute per IP; local development defaults to 1000.
 */
export const generalLimiter = rateLimit({
  windowMs: generalWindowMs,
  max: generalMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
  handler: (req, res) => {
    console.warn(`General rate limit exceeded for IP: ${req.ip}, endpoint: ${req.path}`);
    res.status(429).json({
      error: 'Too many requests',
      message: 'Please slow down your requests',
      retryAfter: res.getHeader('Retry-After')
    });
  }
});

/**
 * Strict rate limiter for search endpoints
 * Prevents user enumeration and information gathering
 * Production limit: 10 requests per minute per IP; local development defaults to 60.
 */
export const searchLimiter = rateLimit({
  windowMs: searchWindowMs,
  max: searchMax,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    return req.ip || req.socket.remoteAddress || 'unknown';
  },
  skip: (req) => {
    return process.env.NODE_ENV === 'test';
  },
  handler: (req, res) => {
    console.warn(`Search rate limit exceeded for IP: ${req.ip}, query: ${req.params?.searchQuery}`);
    res.status(429).json({
      error: 'Too many search requests',
      message: 'Please slow down your searches',
      retryAfter: res.getHeader('Retry-After')
    });
  }
});

export default {
  loginLimiter,
  generalLimiter,
  searchLimiter
};
