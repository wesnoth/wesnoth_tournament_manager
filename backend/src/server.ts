import app from './app.js';
import { initializeScheduledJobs, autoDiscardUnconfirmedReplays } from './jobs/scheduler.js';
import { runMigrations } from './services/migrationRunner.js';
import { avatarManifestService } from './services/avatarManifestService.js';
import { recoverInterruptedGlobalStatsRecalculationJobs } from './services/globalStatsRecalculationJobService.js';
import { invalidateNonAdminTokensIfMaintenanceIsActive } from './services/systemPauseService.js';

// Port configuration - 7100 for test, 8100 for production
const PORT = parseInt(process.env.PORT || '7100', 10);

// Validate and load replay auto-discard configuration
const validateReplayAutoDiscardConfig = (): number => {
  const envValue = process.env.REPLAY_AUTO_DISCARD_TIME;
  const defaultValue = 30;
  
  if (!envValue) {
    console.log(`ℹ️  REPLAY_AUTO_DISCARD_TIME not set, using default: ${defaultValue} days`);
    return defaultValue;
  }
  
  const thresholdDays = parseInt(envValue, 10);
  if (isNaN(thresholdDays) || thresholdDays <= 0) {
    console.error(`❌ REPLAY_AUTO_DISCARD_TIME must be a positive integer, got: ${envValue}. Using default: ${defaultValue}`);
    return defaultValue;
  }
  
  console.log(`✅ Auto-discard threshold: ${thresholdDays} days`);
  return thresholdDays;
};

const startServer = async () => {
  try {
    // NOTE: PostgreSQL initialization removed - using MariaDB instead
    console.log('ℹ️  Using MariaDB for database operations (phpBB and Tournament Manager)');
    
    // Log environment configuration
    console.log(`\n⚙️  Configuration:`);
    console.log(`   PORT: ${PORT}`);
    console.log(`   DISCORD_ENABLED: ${process.env.DISCORD_ENABLED === 'true' ? 'true' : 'false'}\n`);
    
    // Validate replay auto-discard configuration
    validateReplayAutoDiscardConfig();
    
    // Run migrations on startup (for all environments)
    console.log('\n🔄 Running database migrations...\n');
    await runMigrations();
    console.log('\n');

    await invalidateNonAdminTokensIfMaintenanceIsActive();

    await recoverInterruptedGlobalStatsRecalculationJobs();

    // Generate/regenerate avatar manifest from PNG files
    console.log('📦 Generating avatar manifest...');
    await avatarManifestService.generateAvatarManifest();
    await avatarManifestService.validateManifest();
    console.log('');

    // Start server using Express app directly
    app.listen(PORT, () => {
      console.log(`🚀 Backend server running on http://0.0.0.0:${PORT}`);
      console.log('📡 Nginx will reverse proxy tournament.wesnoth.org:443 → localhost:8100');
    });

    // Initialize all scheduled jobs (crons)
    initializeScheduledJobs();
    
    // Run auto-discard on startup in case backend was down during scheduled time
    console.log('\n🔄 Running replay auto-discard on startup...');
    try {
      await autoDiscardUnconfirmedReplays();
      console.log('✅ Startup auto-discard completed\n');
    } catch (error) {
      console.error('❌ Startup auto-discard failed:', error);
      // Don't exit, just log the error
    }
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('\n⏹️  SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('\n⏹️  SIGINT received, shutting down gracefully...');
  process.exit(0);
});

startServer();
