import { Router } from 'express';
import { generateTokenWithUsername, verifyToken } from '../utils/auth.js';
import { authenticatePhpbbUser, getPhpbbUser, checkForumBanlist, checkUserIsForumModerator } from '../services/phpbbAuth.js';
import { generateUUID } from '../utils/uuid.js';
import { queryTournament } from '../config/tournamentDatabase.js';
import { query } from '../config/database.js';
import { logAuditEvent, getUserIP, getUserAgent } from '../middleware/audit.js';
import { isAccountLocked, recordFailedLoginAttempt, recordSuccessfulLogin, getRemainingLockoutTime } from '../services/accountLockout.js';

const router = Router();

// Login - RATE LIMITED with phpBB database authentication
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    // Validate required fields
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    // Warn clearly if TEST_MODE is active
    const isTestMode = process.env.TEST_MODE === 'true' && process.env.NODE_ENV?.toLowerCase() !== 'production';
    if (isTestMode) {
      console.warn(`⚠️  [LOGIN] *** TEST_MODE IS ACTIVE — password validation may be skipped ***`);
    }

    // Normalize username to lowercase for case-insensitive comparison
    const normalizedUsername = username.toLowerCase();

    console.log(`🔐 [LOGIN] Attempting login for user: ${normalizedUsername}`);

     // Check if user exists in users_extension and validate account status
    const existingUsers = await queryTournament(
      'SELECT id, is_blocked, is_admin FROM users_extension WHERE LOWER(nickname) = LOWER(?)',
      [normalizedUsername]
    ) as any[];

    let tournamentUserId: string = '';

    // Maintenance is enforced before password authentication so it also blocks
    // users who have never received an application token.
    if (!existingUsers?.[0]?.is_admin) {
      const maintenanceResult = await query(
        'SELECT setting_value FROM system_settings WHERE setting_key = ?',
        ['maintenance_mode']
      );
      if (maintenanceResult.rows[0]?.setting_value === 'true') {
        return res.status(503).json({
          code: 'MAINTENANCE_MODE',
          error: 'Maintenance mode is active. Please try again later.',
        });
      }
    }

    if (existingUsers && existingUsers.length > 0) {
      tournamentUserId = existingUsers[0].id;
      const isBlocked = existingUsers[0].is_blocked;
      
      // Check if account is administratively blocked
      if (isBlocked) {
        console.warn(`❌ [LOGIN] Account administratively blocked for ${normalizedUsername}`);
        await logAuditEvent({
          event_type: 'LOGIN_FAILED',
          username: normalizedUsername,
          user_id: tournamentUserId,
          ip_address: getUserIP(req),
          user_agent: getUserAgent(req),
          details: { reason: 'account_blocked_by_admin' }
        });
        return res.status(401).json({ 
          error: 'account_blocked',
          message: 'Your account has been blocked by an administrator'
        });
      }
      
      // Check if account is locked due to failed login attempts
      const locked = await isAccountLocked(tournamentUserId);
      if (locked) {
        const remainingTime = await getRemainingLockoutTime(tournamentUserId);
        console.warn(`❌ [LOGIN] Account locked for ${normalizedUsername}. Remaining lockout time: ${remainingTime}s`);
        await logAuditEvent({
          event_type: 'LOGIN_FAILED',
          username: normalizedUsername,
          user_id: tournamentUserId,
          ip_address: getUserIP(req),
          user_agent: getUserAgent(req),
          details: { reason: 'account_locked', remainingSeconds: remainingTime }
        });
        return res.status(401).json({ 
          error: 'account_locked',
          remainingSeconds: remainingTime
        });
      }
    }

    // In TEST_MODE, determine if this user is privileged (admin/moderator) — always validate their password
    let skipPasswordCheck = false;
    if (isTestMode) {
      const isPhpbbModerator = await checkUserIsForumModerator(normalizedUsername);

      // Check tournament admin in users_extension (may not exist yet on first login)
      const existingUserForAdminCheck = await queryTournament(
        'SELECT is_admin FROM users_extension WHERE LOWER(nickname) = LOWER(?)',
        [normalizedUsername]
      ) as any[];
      const isTournamentAdmin = existingUserForAdminCheck?.[0]?.is_admin ?? false;

      if (isPhpbbModerator || isTournamentAdmin) {
        console.warn(`⚠️  [LOGIN] TEST_MODE active but ${normalizedUsername} is admin/moderator — enforcing password validation`);
      } else {
        skipPasswordCheck = true;
      }
    }

    // Authenticate user against phpBB database
    const authResult = await authenticatePhpbbUser(normalizedUsername, password, skipPasswordCheck);
    
    if (!authResult.valid) {
      console.log(`❌ [LOGIN] Failed login for ${normalizedUsername}: ${authResult.error}`);
      
      // Record failed login attempt if user exists in tournament database
      if (tournamentUserId) {
        await recordFailedLoginAttempt(tournamentUserId, normalizedUsername);
        console.warn(`🚨 [LOGIN] Failed attempt recorded for ${normalizedUsername}`);
      }
      
      // Log failed login attempt
      await logAuditEvent({
        event_type: 'LOGIN_FAILED',
        user_id: tournamentUserId || undefined,
        username: normalizedUsername,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: { reason: authResult.error }
      });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    console.log(`✅ [LOGIN] Successfully authenticated ${normalizedUsername}`);

    // Check forum banlist (by user_id and active dates)
    const banCheck = await checkForumBanlist(authResult.user_id);
    if (banCheck.banned) {
      console.warn(`❌ [LOGIN] User ${normalizedUsername} has an active forum ban`);
      await logAuditEvent({
        event_type: 'LOGIN_FAILED',
        user_id: tournamentUserId || undefined,
        username: normalizedUsername,
        ip_address: getUserIP(req),
        user_agent: getUserAgent(req),
        details: { reason: 'forum_banned', banReason: banCheck.reason, banUntil: banCheck.until }
      });
      return res.status(401).json({
        error: 'forum_banned',
        banReason: banCheck.reason,
        banUntil: banCheck.until ?? null,
      });
    }

    // Get or create user in users_extension (tournament database)
    if (!tournamentUserId) {
      // Create new user in users_extension table
      console.log(`🔐 [LOGIN] Creating new user in users_extension: ${normalizedUsername}`);
      tournamentUserId = generateUUID();
      
      await queryTournament(
        `INSERT INTO users_extension (id, nickname, is_active, is_blocked, locked_until, failed_login_attempts)
         VALUES (?, ?, 1, 0, NULL, 0)`,
        [tournamentUserId, authResult.username]
      );
      
      console.log(`✅ [LOGIN] User created in users_extension: ${tournamentUserId}`);
    } else {
      console.log(`✅ [LOGIN] User already exists in users_extension: ${tournamentUserId}`);
    }

    // Record successful login (resets failed attempts and lockout)
    await recordSuccessfulLogin(tournamentUserId);
    console.log(`✅ [LOGIN] Successful login recorded for ${normalizedUsername}`);

    // Generate JWT token with tournament database user ID
    const token = generateTokenWithUsername(normalizedUsername, tournamentUserId);

    // Check if user is a tournament moderator via forum group membership
    const isTournamentModerator = await checkUserIsForumModerator(normalizedUsername);

    // Log successful login
    await logAuditEvent({
      event_type: 'LOGIN_SUCCESS',
      user_id: tournamentUserId,
      username: normalizedUsername,
      ip_address: getUserIP(req),
      user_agent: getUserAgent(req),
      details: { isNewUser: !existingUsers || existingUsers.length === 0 }
    });

    res.json({ 
      token, 
      username: normalizedUsername,
      userId: tournamentUserId,
      isTournamentModerator,
    });

  } catch (error) {
    console.error(`❌ [LOGIN] Error:`, error);
    res.status(500).json({ error: 'Login failed', details: error instanceof Error ? error.message : String(error) });
  }
});

// Validate token endpoint - used by frontend on app load
router.get('/validate-token', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.substring(7);
    console.log(`🔐 [VALIDATE] Token validation requested`);

    // Verify JWT token
    const decoded = verifyToken(token);
    console.log(`✅ [VALIDATE] Token verified for user: ${decoded.username}`);

    // Get full user info from phpBB
    const phpbbUser = await getPhpbbUser(decoded.username);
    if (!phpbbUser) {
      console.warn(`⚠️  [VALIDATE] User no longer exists in phpBB: ${decoded.username}`);
      return res.status(401).json({ error: 'User not found' });
    }

    // Get tournament user info to check if admin
    const tournamentUserResult = await query(
      'SELECT is_admin, token_invalidated_at FROM users_extension WHERE id = ?',
      [decoded.userId]
    );

    const isAdmin = tournamentUserResult.rows[0]?.is_admin || false;
    const invalidatedAt = tournamentUserResult.rows[0]?.token_invalidated_at;
    if (invalidatedAt && decoded.iat * 1000 <= new Date(invalidatedAt).getTime()) {
      return res.status(401).json({ code: 'TOKEN_INVALIDATED', error: 'Session expired. Please log in again.' });
    }
    if (!isAdmin) {
      const maintenanceResult = await query(
        'SELECT setting_value FROM system_settings WHERE setting_key = ?',
        ['maintenance_mode']
      );
      if (maintenanceResult.rows[0]?.setting_value === 'true') {
        return res.status(503).json({ code: 'MAINTENANCE_MODE', error: 'Maintenance mode is active. Please try again later.' });
      }
    }
    const isTournamentModerator = await checkUserIsForumModerator(decoded.username);

    // Return user info
    res.json({
      valid: true,
      userId: decoded.userId,
      username: phpbbUser.username,
      nickname: tournamentUserResult.rows[0]?.nickname || phpbbUser.username,
      isAdmin: isAdmin,
      isTournamentModerator,
    });

  } catch (error) {
    console.error('❌ [VALIDATE] Token validation error:', error);
    res.status(401).json({ error: 'Token validation failed' });
  }
});

export default router;
