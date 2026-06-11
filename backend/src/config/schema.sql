/*M!999999\- enable the sandbox mode */ 
-- MariaDB dump 10.19-11.8.6-MariaDB, for debian-linux-gnu (x86_64)
--
-- Host: 192.168.1.3    Database: tournament
-- ------------------------------------------------------
-- Server version	11.8.6-MariaDB-0+deb13u1 from Debian

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `id` char(36) NOT NULL,
  `event_type` varchar(50) NOT NULL,
  `user_id` char(36) DEFAULT NULL,
  `username` varchar(255) DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `user_agent` text DEFAULT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_user_id` (`user_id`),
  KEY `idx_audit_logs_event_type` (`event_type`),
  KEY `idx_audit_logs_created_at` (`created_at`),
  KEY `idx_audit_logs_ip_address` (`ip_address`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `balance_events`
--

DROP TABLE IF EXISTS `balance_events`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `balance_events` (
  `id` char(36) NOT NULL,
  `event_date` datetime NOT NULL DEFAULT current_timestamp(),
  `patch_version` varchar(20) DEFAULT NULL,
  `event_type` varchar(50) NOT NULL,
  `faction_id` char(36) DEFAULT NULL,
  `map_id` char(36) DEFAULT NULL,
  `description` text NOT NULL,
  `notes` text DEFAULT NULL,
  `created_by` char(36) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `snapshot_before_date` date DEFAULT NULL,
  `snapshot_after_date` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_event_type` (`event_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `countries`
--

DROP TABLE IF EXISTS `countries`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `countries` (
  `code` varchar(2) NOT NULL,
  `names_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT '{}' CHECK (json_valid(`names_json`)),
  `flag_emoji` varchar(10) DEFAULT NULL,
  `official_name` varchar(255) DEFAULT NULL,
  `region` varchar(100) DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `faction_map_statistics`
--

DROP TABLE IF EXISTS `faction_map_statistics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `faction_map_statistics` (
  `id` char(36) NOT NULL,
  `map_id` char(36) NOT NULL,
  `faction_id` char(36) NOT NULL,
  `opponent_faction_id` char(36) NOT NULL,
  `total_games` int(11) DEFAULT 0,
  `wins` int(11) DEFAULT 0,
  `losses` int(11) DEFAULT 0,
  `winrate` decimal(5,2) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `last_updated` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `faction_side` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0=unknown, 1=played as side 1, 2=played as side 2',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_faction_map_opponent_side` (`map_id`,`faction_id`,`opponent_faction_id`,`faction_side`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `faction_map_statistics_history`
--

DROP TABLE IF EXISTS `faction_map_statistics_history`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `faction_map_statistics_history` (
  `id` char(36) NOT NULL,
  `snapshot_date` date NOT NULL,
  `snapshot_timestamp` datetime NOT NULL DEFAULT current_timestamp(),
  `map_id` char(36) NOT NULL,
  `faction_id` char(36) NOT NULL,
  `opponent_faction_id` char(36) NOT NULL,
  `faction_side` tinyint(4) NOT NULL DEFAULT 1,
  `total_games` int(11) DEFAULT 0,
  `wins` int(11) DEFAULT 0,
  `losses` int(11) DEFAULT 0,
  `winrate` decimal(5,2) DEFAULT NULL,
  `sample_size_category` varchar(20) DEFAULT NULL,
  `confidence_level` decimal(5,2) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_snapshot_date` (`snapshot_date`),
  KEY `idx_map_faction` (`map_id`,`faction_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `faction_translations`
--

DROP TABLE IF EXISTS `faction_translations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `faction_translations` (
  `id` char(36) NOT NULL,
  `faction_id` char(36) NOT NULL,
  `language_code` varchar(10) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_faction_lang` (`faction_id`,`language_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `factions`
--

DROP TABLE IF EXISTS `factions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `factions` (
  `id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `icon_path` varchar(500) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `is_active` tinyint(1) DEFAULT 1,
  `is_ranked` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_is_ranked` (`is_ranked`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `faq`
--

DROP TABLE IF EXISTS `faq`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `faq` (
  `id` char(36) NOT NULL,
  `question` varchar(500) NOT NULL,
  `answer` text NOT NULL,
  `translations` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT '{"de": {}, "en": {}, "es": {}, "zh": {}}' CHECK (json_valid(`translations`)),
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `language_code` varchar(10) DEFAULT 'en',
  `order` int(11) DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `game_maps`
--

DROP TABLE IF EXISTS `game_maps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `game_maps` (
  `id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `usage_count` int(11) DEFAULT 1,
  `is_active` tinyint(1) DEFAULT 1,
  `is_ranked` tinyint(1) DEFAULT 1,
  PRIMARY KEY (`id`),
  KEY `idx_is_ranked` (`is_ranked`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `global_statistics`
--

DROP TABLE IF EXISTS `global_statistics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `global_statistics` (
  `id` char(36) NOT NULL DEFAULT uuid(),
  `statistic_key` varchar(100) NOT NULL,
  `statistic_value` bigint(20) NOT NULL DEFAULT 0,
  `last_updated` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `calculated_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `statistic_key` (`statistic_key`),
  KEY `idx_statistic_key` (`statistic_key`),
  KEY `idx_last_updated` (`last_updated`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `map_translations`
--

DROP TABLE IF EXISTS `map_translations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `map_translations` (
  `id` char(36) NOT NULL,
  `map_id` char(36) NOT NULL,
  `language_code` varchar(10) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_map_lang` (`map_id`,`language_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `match_schedule_confirmations`
--

DROP TABLE IF EXISTS `match_schedule_confirmations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `match_schedule_confirmations` (
  `id` char(36) NOT NULL COMMENT 'UUID v4',
  `proposal_id` char(36) NOT NULL COMMENT 'Reference to match_schedule_proposals.id - CHANGED FROM slot_id',
  `user_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `confirmed_at` datetime NOT NULL COMMENT 'Timestamp of confirmation',
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proposal_user` (`proposal_id`,`user_id`),
  KEY `idx_proposal_id` (`proposal_id`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_confirmation_proposal` FOREIGN KEY (`proposal_id`) REFERENCES `match_schedule_proposals` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='User confirmations for scheduling proposals - proposal-level, not per-slot. Each user confirms entire proposal.';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `match_schedule_proposals`
--

DROP TABLE IF EXISTS `match_schedule_proposals`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `match_schedule_proposals` (
  `id` char(36) NOT NULL COMMENT 'UUID v4',
  `tournament_round_match_id` char(36) DEFAULT NULL COMMENT 'Reference to tournament_round_matches.id (series-level)',
  `tournament_match_id` char(36) DEFAULT NULL COMMENT 'Reference to tournament_matches.id (game-level)',
  `proposed_by_user_id` char(36) NOT NULL COMMENT 'User who made the proposal',
  `proposed_at` datetime NOT NULL,
  `status` varchar(20) NOT NULL DEFAULT 'active' COMMENT 'active | superseded | resolved',
  `expires_at` datetime DEFAULT NULL COMMENT 'Calculated when proposal created: max(slot_datetime) + 7 days. Used to auto-expire stale proposals',
  `cancelled_at` datetime DEFAULT NULL COMMENT 'Timestamp when proposal was cancelled or expired. After 7 days in cancelled state, proposal is purged',
  `user_id` char(36) DEFAULT NULL COMMENT 'FK→users_extension.id. For future P2P proposals without tournament context. NULL if tournament-based.',
  `notes` text DEFAULT NULL COMMENT 'Player notes (max 500 chars)',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_round_match_id` (`tournament_round_match_id`),
  KEY `idx_match_id` (`tournament_match_id`),
  KEY `idx_proposed_by` (`proposed_by_user_id`),
  KEY `idx_status` (`status`),
  KEY `idx_expires_at` (`expires_at`),
  KEY `idx_cancelled_at` (`cancelled_at`),
  KEY `idx_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Scheduling proposals at round or individual match level';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `match_schedule_slots`
--

DROP TABLE IF EXISTS `match_schedule_slots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `match_schedule_slots` (
  `id` char(36) NOT NULL COMMENT 'UUID v4',
  `proposal_id` char(36) NOT NULL COMMENT 'Reference to match_schedule_proposals.id',
  `slot_datetime` datetime NOT NULL COMMENT 'UTC timestamp, rounded to nearest 30-minute mark (HH:00 or HH:30)',
  `slot_duration_minutes` int(11) DEFAULT 30 COMMENT 'Always 30 minutes',
  `status` varchar(20) NOT NULL DEFAULT 'pending' COMMENT 'pending | confirmed',
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_proposal_slot_time` (`proposal_id`,`slot_datetime`),
  KEY `idx_proposal_id` (`proposal_id`),
  KEY `idx_slot_datetime` (`slot_datetime`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Individual 30-minute time slots within proposals';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `matches`
--

DROP TABLE IF EXISTS `matches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `matches` (
  `id` char(36) NOT NULL,
  `winner_id` char(36) NOT NULL,
  `loser_id` char(36) NOT NULL,
  `map` varchar(255) NOT NULL,
  `winner_faction` varchar(255) NOT NULL,
  `loser_faction` varchar(255) NOT NULL,
  `winner_comments` text DEFAULT NULL,
  `winner_rating` int(11) DEFAULT NULL,
  `loser_comments` text DEFAULT NULL,
  `loser_rating` int(11) DEFAULT NULL,
  `loser_confirmed` tinyint(1) DEFAULT 0,
  `replay_file_path` varchar(1000) DEFAULT NULL,
  `tournament_id` char(36) DEFAULT NULL,
  `elo_change` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `status` varchar(50) DEFAULT 'unconfirmed',
  `auto_reported` tinyint(1) NOT NULL DEFAULT 0,
  `replay_id` char(36) DEFAULT NULL,
  `admin_reviewed` tinyint(1) DEFAULT 0,
  `admin_reviewed_at` datetime DEFAULT NULL,
  `admin_reviewed_by` char(36) DEFAULT NULL,
  `winner_elo_before` int(11) DEFAULT 1600,
  `winner_elo_after` int(11) DEFAULT 1600,
  `loser_elo_before` int(11) DEFAULT 1600,
  `loser_elo_after` int(11) DEFAULT 1600,
  `winner_level_before` varchar(50) DEFAULT 'novato',
  `winner_level_after` varchar(50) DEFAULT 'novato',
  `loser_level_before` varchar(50) DEFAULT 'novato',
  `loser_level_after` varchar(50) DEFAULT 'novato',
  `replay_downloads` int(11) DEFAULT 0,
  `winner_ranking_pos` int(11) DEFAULT NULL,
  `winner_ranking_change` int(11) DEFAULT NULL,
  `loser_ranking_pos` int(11) DEFAULT NULL,
  `loser_ranking_change` int(11) DEFAULT NULL,
  `round_id` char(36) DEFAULT NULL,
  `tournament_type` varchar(20) DEFAULT NULL,
  `tournament_mode` varchar(20) DEFAULT NULL,
  `winner_side` tinyint(1) DEFAULT NULL COMMENT '1 or 2 — which side the winner played',
  `game_id` int(11) DEFAULT NULL COMMENT 'wesnothd game_id from forum',
  `wesnoth_version` varchar(20) DEFAULT NULL COMMENT 'e.g. 1.18.0',
  `instance_uuid` char(36) DEFAULT NULL COMMENT 'wesnothd instance UUID from forum',
  PRIMARY KEY (`id`),
  UNIQUE KEY `unique_replay_game` (`instance_uuid`,`game_id`),
  KEY `idx_winner_id` (`winner_id`),
  KEY `idx_tournament_id` (`tournament_id`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_auto_reported` (`auto_reported`),
  KEY `idx_replay_id` (`replay_id`),
  CONSTRAINT `fk_matches_replay` FOREIGN KEY (`replay_id`) REFERENCES `replays` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_matches_replay_id` FOREIGN KEY (`replay_id`) REFERENCES `replays` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `matches_faction_fix_backup_20260429`
--

DROP TABLE IF EXISTS `matches_faction_fix_backup_20260429`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `matches_faction_fix_backup_20260429` (
  `id` char(36) NOT NULL,
  `winner_id` char(36) NOT NULL,
  `loser_id` char(36) NOT NULL,
  `map` varchar(255) NOT NULL,
  `winner_faction` varchar(255) NOT NULL,
  `loser_faction` varchar(255) NOT NULL,
  `winner_comments` text DEFAULT NULL,
  `winner_rating` int(11) DEFAULT NULL,
  `loser_comments` text DEFAULT NULL,
  `loser_rating` int(11) DEFAULT NULL,
  `loser_confirmed` tinyint(1) DEFAULT 0,
  `replay_file_path` varchar(1000) DEFAULT NULL,
  `tournament_id` char(36) DEFAULT NULL,
  `elo_change` int(11) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `status` varchar(50) DEFAULT 'unconfirmed',
  `auto_reported` tinyint(1) NOT NULL DEFAULT 0,
  `replay_id` char(36) DEFAULT NULL,
  `admin_reviewed` tinyint(1) DEFAULT 0,
  `admin_reviewed_at` datetime DEFAULT NULL,
  `admin_reviewed_by` char(36) DEFAULT NULL,
  `winner_elo_before` int(11) DEFAULT 1600,
  `winner_elo_after` int(11) DEFAULT 1600,
  `loser_elo_before` int(11) DEFAULT 1600,
  `loser_elo_after` int(11) DEFAULT 1600,
  `winner_level_before` varchar(50) DEFAULT 'novato',
  `winner_level_after` varchar(50) DEFAULT 'novato',
  `loser_level_before` varchar(50) DEFAULT 'novato',
  `loser_level_after` varchar(50) DEFAULT 'novato',
  `replay_downloads` int(11) DEFAULT 0,
  `winner_ranking_pos` int(11) DEFAULT NULL,
  `winner_ranking_change` int(11) DEFAULT NULL,
  `loser_ranking_pos` int(11) DEFAULT NULL,
  `loser_ranking_change` int(11) DEFAULT NULL,
  `round_id` char(36) DEFAULT NULL,
  `tournament_type` varchar(20) DEFAULT NULL,
  `tournament_mode` varchar(20) DEFAULT NULL,
  `winner_side` tinyint(1) DEFAULT NULL COMMENT '1 or 2 — which side the winner played',
  `game_id` int(11) DEFAULT NULL COMMENT 'wesnothd game_id from forum',
  `wesnoth_version` varchar(20) DEFAULT NULL COMMENT 'e.g. 1.18.0',
  `instance_uuid` char(36) DEFAULT NULL COMMENT 'wesnothd instance UUID from forum'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `migrations`
--

DROP TABLE IF EXISTS `migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `migrations` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `name` varchar(255) NOT NULL,
  `executed_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=104 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `news`
--

DROP TABLE IF EXISTS `news`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `news` (
  `id` char(36) NOT NULL,
  `title` varchar(255) NOT NULL,
  `content` text NOT NULL,
  `translations` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT '{"de": {}, "en": {}, "es": {}, "zh": {}}' CHECK (json_valid(`translations`)),
  `author_id` char(36) NOT NULL,
  `published_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `language_code` varchar(10) DEFAULT 'en',
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `player_match_statistics`
--

DROP TABLE IF EXISTS `player_match_statistics`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `player_match_statistics` (
  `id` char(36) NOT NULL,
  `player_id` char(36) NOT NULL,
  `opponent_id` char(36) DEFAULT NULL,
  `map_id` char(36) DEFAULT NULL,
  `faction_id` char(36) DEFAULT NULL,
  `opponent_faction_id` char(36) DEFAULT NULL,
  `total_games` int(11) DEFAULT 0,
  `wins` int(11) DEFAULT 0,
  `losses` int(11) DEFAULT 0,
  `winrate` decimal(5,2) DEFAULT NULL,
  `avg_elo_change` decimal(8,2) DEFAULT NULL,
  `last_elo_against_me` decimal(8,2) DEFAULT NULL,
  `elo_gained` decimal(8,2) DEFAULT 0.00,
  `elo_lost` decimal(8,2) DEFAULT 0.00,
  `last_match_date` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `last_updated` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `player_side` tinyint(1) NOT NULL DEFAULT 0 COMMENT '0=all sides aggregate, 1=played as side 1, 2=played as side 2',
  PRIMARY KEY (`id`),
  KEY `idx_player_id` (`player_id`),
  KEY `idx_opponent_id` (`opponent_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `player_of_month`
--

DROP TABLE IF EXISTS `player_of_month`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `player_of_month` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `player_id` char(36) NOT NULL,
  `nickname` varchar(255) NOT NULL,
  `elo_rating` int(11) NOT NULL,
  `ranking_position` int(11) NOT NULL,
  `elo_gained` int(11) DEFAULT 0,
  `positions_gained` int(11) DEFAULT 0,
  `month_year` date NOT NULL,
  `calculated_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB AUTO_INCREMENT=56 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `replay_parsing_logs`
--

DROP TABLE IF EXISTS `replay_parsing_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `replay_parsing_logs` (
  `id` char(36) NOT NULL,
  `replay_id` char(36) NOT NULL,
  `stage` varchar(50) DEFAULT NULL,
  `status` varchar(20) DEFAULT NULL,
  `duration_ms` int(11) DEFAULT NULL,
  `error_message` text DEFAULT NULL,
  `details` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`details`)),
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_replay_id` (`replay_id`),
  KEY `idx_stage` (`stage`),
  KEY `idx_status` (`status`),
  CONSTRAINT `fk_parsing_logs_replay_id` FOREIGN KEY (`replay_id`) REFERENCES `replays` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `replay_participants`
--

DROP TABLE IF EXISTS `replay_participants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `replay_participants` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `replay_id` varchar(36) NOT NULL,
  `player_id` char(36) DEFAULT NULL,
  `player_name` varchar(255) DEFAULT NULL,
  `side` int(11) DEFAULT NULL,
  `faction_name` varchar(255) DEFAULT NULL,
  `result_side` int(11) DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_replay` (`replay_id`),
  KEY `idx_player` (`player_id`),
  CONSTRAINT `replay_participants_ibfk_1` FOREIGN KEY (`replay_id`) REFERENCES `replays` (`id`) ON DELETE CASCADE,
  CONSTRAINT `replay_participants_ibfk_2` FOREIGN KEY (`player_id`) REFERENCES `users_extension` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=187 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `replays`
--

DROP TABLE IF EXISTS `replays`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `replays` (
  `id` char(36) NOT NULL,
  `replay_filename` varchar(500) NOT NULL,
  `replay_path` varchar(1000) NOT NULL,
  `file_size_bytes` bigint(20) DEFAULT NULL,
  `parsed` tinyint(1) NOT NULL DEFAULT 0,
  `need_integration` tinyint(1) NOT NULL DEFAULT 0,
  `integration_confidence` tinyint(1) DEFAULT 0,
  `match_id` char(36) DEFAULT NULL,
  `tournament_match_id` char(36) DEFAULT NULL,
  `tournament_id` char(36) DEFAULT NULL,
  `tournament_round_match_id` char(36) DEFAULT NULL,
  `parse_status` varchar(50) NOT NULL DEFAULT 'pending',
  `parse_error_message` text DEFAULT NULL,
  `parse_stage` varchar(20) DEFAULT NULL,
  `parse_summary` text DEFAULT NULL,
  `detected_at` datetime NOT NULL DEFAULT current_timestamp(),
  `file_write_closed_at` datetime DEFAULT NULL,
  `file_mtime` datetime DEFAULT NULL,
  `parsing_started_at` datetime DEFAULT NULL,
  `parsing_completed_at` datetime DEFAULT NULL,
  `wesnoth_version` varchar(20) DEFAULT NULL,
  `map_name` varchar(255) DEFAULT NULL,
  `era_id` varchar(100) DEFAULT NULL,
  `tournament_addon_id` varchar(100) DEFAULT NULL,
  `created_at` datetime NOT NULL DEFAULT current_timestamp(),
  `updated_at` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `deleted_at` datetime DEFAULT NULL,
  `game_id` int(10) unsigned DEFAULT NULL,
  `start_time` timestamp NULL DEFAULT NULL,
  `end_time` timestamp NULL DEFAULT NULL,
  `is_reload` tinyint(1) DEFAULT 0,
  `detected_from` varchar(50) DEFAULT 'manual',
  `instance_uuid` char(36) DEFAULT NULL,
  `game_name` varchar(255) DEFAULT NULL,
  `oos` tinyint(1) DEFAULT 0,
  `replay_url` varchar(1000) DEFAULT NULL,
  `last_checked_at` datetime DEFAULT NULL,
  `discard_vote_1` char(36) DEFAULT NULL COMMENT 'First player user_id who voted to discard this replay',
  `discard_vote_2` char(36) DEFAULT NULL COMMENT 'Second player user_id who voted to discard this replay',
  `cancel_requested_by` varchar(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `replay_filename` (`replay_filename`),
  UNIQUE KEY `uq_instance_game` (`instance_uuid`,`game_id`),
  KEY `idx_parsed` (`parsed`),
  KEY `idx_need_integration` (`need_integration`),
  KEY `idx_match_id` (`match_id`),
  KEY `idx_parse_status` (`parse_status`),
  KEY `idx_detected_at` (`detected_at`),
  KEY `idx_tournament_addon` (`tournament_addon_id`),
  KEY `idx_parsed_status` (`parsed`,`parse_status`),
  KEY `idx_parse_summary` (`parse_summary`(100)),
  KEY `idx_match_link` (`match_id`),
  KEY `idx_last_checked` (`last_checked_at`),
  KEY `idx_end_time` (`end_time`),
  KEY `idx_detected_from` (`detected_from`),
  KEY `idx_cancel_requested_by` (`cancel_requested_by`),
  KEY `idx_replay_trm_id` (`tournament_round_match_id`),
  KEY `idx_replay_tournament_id` (`tournament_id`),
  KEY `fk_replays_tournament_match_id` (`tournament_match_id`),
  CONSTRAINT `fk_replays_match_id` FOREIGN KEY (`match_id`) REFERENCES `matches` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_replays_tournament_match_id` FOREIGN KEY (`tournament_match_id`) REFERENCES `tournament_matches` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `system_settings`
--

DROP TABLE IF EXISTS `system_settings`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_settings` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `setting_key` varchar(100) NOT NULL,
  `setting_value` text DEFAULT NULL,
  `description` text DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `updated_by` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `setting_key` (`setting_key`)
) ENGINE=InnoDB AUTO_INCREMENT=6 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `team_substitutes`
--

DROP TABLE IF EXISTS `team_substitutes`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `team_substitutes` (
  `id` char(36) NOT NULL,
  `team_id` char(36) NOT NULL,
  `player_id` char(36) NOT NULL,
  `substitute_order` smallint(6) DEFAULT 1,
  `added_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_team_id` (`team_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tournament_matches`
--

DROP TABLE IF EXISTS `tournament_matches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournament_matches` (
  `id` char(36) NOT NULL,
  `tournament_id` char(36) NOT NULL,
  `round_id` char(36) NOT NULL,
  `player1_id` char(36) NOT NULL,
  `player2_id` char(36) NOT NULL,
  `winner_id` char(36) DEFAULT NULL,
  `loser_id` char(36) DEFAULT NULL,
  `match_id` char(36) DEFAULT NULL,
  `match_status` varchar(20) DEFAULT 'pending',
  `played_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tournament_round_match_id` char(36) DEFAULT NULL,
  `organizer_action` varchar(50) DEFAULT NULL,
  `map` varchar(255) DEFAULT NULL,
  `winner_faction` varchar(255) DEFAULT NULL,
  `loser_faction` varchar(255) DEFAULT NULL,
  `winner_comments` text DEFAULT NULL,
  `winner_rating` int(11) DEFAULT NULL,
  `loser_comments` text DEFAULT NULL,
  `loser_rating` int(11) DEFAULT NULL,
  `replay_file_path` varchar(500) DEFAULT NULL,
  `status` varchar(20) DEFAULT 'unconfirmed',
  `replay_downloads` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tournament_id` (`tournament_id`),
  KEY `idx_round_id` (`round_id`),
  KEY `idx_player1_id` (`player1_id`),
  KEY `idx_player2_id` (`player2_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tournament_participants`
--

DROP TABLE IF EXISTS `tournament_participants`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournament_participants` (
  `id` char(36) NOT NULL,
  `tournament_id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `current_round` int(11) DEFAULT 1,
  `status` varchar(20) DEFAULT 'active',
  `created_at` datetime DEFAULT current_timestamp(),
  `participation_status` varchar(30) DEFAULT 'pending' COMMENT 'Participant status: pending (join request), accepted (active), unconfirmed (awaiting confirmation), pending_replacement (substitute waiting confirmation), replaced (was replaced mid-tournament), rejected' CHECK (`participation_status` in ('pending','accepted','pending_replacement','replaced','rejected','unconfirmed')),
  `tournament_ranking` int(11) DEFAULT NULL,
  `tournament_wins` int(11) DEFAULT 0,
  `tournament_losses` int(11) DEFAULT 0,
  `tournament_points` int(11) DEFAULT 0,
  `omp` decimal(8,2) DEFAULT 0.00,
  `gwp` decimal(5,2) DEFAULT 0.00,
  `ogp` decimal(5,2) DEFAULT 0.00,
  `team_id` char(36) DEFAULT NULL,
  `team_position` smallint(6) DEFAULT NULL,
  `replacement_requested_at` datetime DEFAULT NULL,
  `replaced_by_participant_id` char(36) DEFAULT NULL,
  `requested_replacement_of_id` char(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tournament_id` (`tournament_id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_team_id` (`team_id`),
  KEY `idx_tournament_participants_replacement_requested_at` (`replacement_requested_at`),
  KEY `idx_tournament_participants_replaced_by` (`replaced_by_participant_id`),
  KEY `idx_tournament_participants_replacement_of` (`requested_replacement_of_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tournament_round_matches`
--

DROP TABLE IF EXISTS `tournament_round_matches`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournament_round_matches` (
  `id` char(36) NOT NULL,
  `tournament_id` char(36) NOT NULL,
  `round_id` char(36) NOT NULL,
  `player1_id` char(36) NOT NULL,
  `player2_id` char(36) NOT NULL,
  `best_of` int(11) NOT NULL,
  `wins_required` int(11) NOT NULL,
  `player1_wins` int(11) DEFAULT 0,
  `player2_wins` int(11) DEFAULT 0,
  `matches_scheduled` int(11) DEFAULT 0,
  `series_status` varchar(50) DEFAULT 'in_progress',
  `winner_id` char(36) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `scheduled_datetime` datetime DEFAULT NULL COMMENT 'Proposed/confirmed schedule time (UTC)',
  `scheduled_status` varchar(20) DEFAULT 'pending' COMMENT 'pending, player1_proposed, player2_proposed, confirmed',
  `scheduled_by_player_id` char(36) DEFAULT NULL COMMENT 'Which player proposed the schedule',
  `scheduled_confirmed_at` datetime DEFAULT NULL COMMENT 'When both players confirmed (UTC)',
  PRIMARY KEY (`id`),
  KEY `idx_tournament_id` (`tournament_id`),
  KEY `idx_round_id` (`round_id`),
  KEY `idx_scheduled_status` (`scheduled_status`),
  KEY `idx_scheduled_datetime` (`scheduled_datetime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tournament_rounds`
--

DROP TABLE IF EXISTS `tournament_rounds`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournament_rounds` (
  `id` char(36) NOT NULL,
  `tournament_id` char(36) NOT NULL,
  `round_number` int(11) NOT NULL,
  `match_format` varchar(10) NOT NULL,
  `round_status` varchar(20) DEFAULT 'pending',
  `round_start_date` datetime DEFAULT NULL,
  `round_end_date` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `round_type` varchar(20) DEFAULT 'general',
  `round_classification` varchar(50) DEFAULT 'standard',
  `players_remaining` int(11) DEFAULT NULL,
  `players_advancing_to_next` int(11) DEFAULT NULL,
  `round_phase_label` varchar(100) DEFAULT NULL,
  `round_phase_description` varchar(255) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tournament_id` (`tournament_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tournament_teams`
--

DROP TABLE IF EXISTS `tournament_teams`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournament_teams` (
  `id` char(36) NOT NULL,
  `tournament_id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `created_by` char(36) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `tournament_wins` int(11) DEFAULT 0,
  `tournament_losses` int(11) DEFAULT 0,
  `tournament_points` int(11) DEFAULT 0,
  `omp` decimal(10,2) DEFAULT 0.00,
  `gwp` decimal(5,2) DEFAULT 0.00,
  `ogp` decimal(5,2) DEFAULT 0.00,
  `status` varchar(20) DEFAULT 'active',
  `current_round` int(11) DEFAULT 1,
  `tournament_ranking` int(11) DEFAULT NULL,
  `team_elo` int(11) DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_tournament_id` (`tournament_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tournament_unranked_factions`
--

DROP TABLE IF EXISTS `tournament_unranked_factions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournament_unranked_factions` (
  `id` char(36) NOT NULL,
  `tournament_id` char(36) NOT NULL,
  `faction_id` char(36) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_tournament_id` (`tournament_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tournament_unranked_maps`
--

DROP TABLE IF EXISTS `tournament_unranked_maps`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournament_unranked_maps` (
  `id` char(36) NOT NULL,
  `tournament_id` char(36) NOT NULL,
  `map_id` char(36) NOT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_tournament_id` (`tournament_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `tournaments`
--

DROP TABLE IF EXISTS `tournaments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tournaments` (
  `id` char(36) NOT NULL,
  `name` varchar(255) NOT NULL,
  `description` text NOT NULL,
  `creator_id` char(36) NOT NULL,
  `status` varchar(20) DEFAULT 'pending',
  `approved_at` datetime DEFAULT NULL,
  `started_at` datetime DEFAULT NULL,
  `finished_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `general_rounds` int(11) DEFAULT 0,
  `final_rounds` int(11) DEFAULT 0,
  `registration_closed_at` datetime DEFAULT NULL,
  `prepared_at` datetime DEFAULT NULL,
  `tournament_type` varchar(50) DEFAULT NULL,
  `max_participants` int(11) DEFAULT NULL,
  `round_duration_days` int(11) DEFAULT 7,
  `auto_advance_round` tinyint(1) DEFAULT 0,
  `current_round` int(11) DEFAULT 0,
  `total_rounds` int(11) DEFAULT 0,
  `general_rounds_format` varchar(10) DEFAULT 'bo3',
  `final_rounds_format` varchar(10) DEFAULT 'bo5',
  `discord_thread_id` varchar(255) DEFAULT NULL,
  `tournament_mode` varchar(20) DEFAULT 'ranked',
  PRIMARY KEY (`id`),
  KEY `idx_status` (`status`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `user_notifications`
--

DROP TABLE IF EXISTS `user_notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `user_notifications` (
  `id` char(36) NOT NULL,
  `user_id` char(36) NOT NULL,
  `tournament_id` char(36) NOT NULL,
  `match_id` char(36) NOT NULL,
  `type` varchar(50) NOT NULL COMMENT 'schedule_proposal, schedule_confirmed, schedule_cancelled',
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `is_read` tinyint(1) DEFAULT 0,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `message_extra` text DEFAULT NULL COMMENT 'Optional comment from schedule proposer',
  `is_deleted` tinyint(1) DEFAULT 0 COMMENT 'Soft delete flag for retention',
  PRIMARY KEY (`id`),
  KEY `idx_user_id` (`user_id`),
  KEY `idx_tournament_id` (`tournament_id`),
  KEY `idx_match_id` (`match_id`),
  KEY `idx_is_read` (`is_read`),
  KEY `idx_created_at` (`created_at`),
  KEY `idx_user_is_read` (`user_id`,`is_read`),
  KEY `idx_user_created_at` (`user_id`,`created_at` DESC),
  KEY `idx_user_undeleted` (`user_id`,`is_deleted`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Notifications shown as toasts when users access the app';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wiki_articles`
--

DROP TABLE IF EXISTS `wiki_articles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wiki_articles` (
  `id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `slug` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `translations` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'JSON object with language keys: {"en": {"title": "...", "content_markdown": "..."}, "es": {...}, ...}',
  `author_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'FK→users_extension.id',
  `is_published` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_slug` (`slug`),
  KEY `idx_slug` (`slug`),
  KEY `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Wiki articles with multi-language translations in JSON format';
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wiki_article_images`
--

DROP TABLE IF EXISTS `wiki_article_images`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wiki_article_images` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `article_id` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL COMMENT 'FK→wiki_articles.id',
  `image_id` int(11) NOT NULL COMMENT 'FK→wiki_images.id',
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_article_id` (`article_id`),
  KEY `idx_image_id` (`image_id`),
  CONSTRAINT `fk_wiki_article_images_article` FOREIGN KEY (`article_id`) REFERENCES `wiki_articles` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `wiki_images`
--

DROP TABLE IF EXISTS `wiki_images`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `wiki_images` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `filename` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `original_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `uploaded_by` char(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'FK→users_extension.id',
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_filename` (`filename`),
  KEY `idx_uploaded_by` (`uploaded_by`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;

--
-- Table structure for table `users_extension`
--

DROP TABLE IF EXISTS `users_extension`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `users_extension` (
  `id` char(36) NOT NULL,
  `nickname` varchar(255) NOT NULL,
  `language` varchar(2) DEFAULT 'en',
  `discord_id` varchar(255) DEFAULT NULL,
  `elo_rating` int(11) DEFAULT 1400,
  `level` varchar(50) DEFAULT 'novato',
  `is_active` tinyint(1) DEFAULT 0,
  `is_blocked` tinyint(1) DEFAULT 0,
  `is_admin` tinyint(1) DEFAULT 0,
  `timezone` varchar(100) DEFAULT 'UTC' COMMENT 'IANA timezone name (e.g., Europe/Madrid, America/New_York)',
  `availability_schedule` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL COMMENT 'Object with day keys (monday-sunday) containing array of {start, end} time ranges' CHECK (json_valid(`availability_schedule`)),
  `availability_updated_at` datetime DEFAULT NULL COMMENT 'Timestamp when availability was last modified',
  `created_at` datetime DEFAULT current_timestamp(),
  `updated_at` datetime DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `is_rated` tinyint(1) DEFAULT 0,
  `matches_played` int(11) DEFAULT 0,
  `elo_provisional` tinyint(1) DEFAULT 0,
  `total_wins` int(11) DEFAULT 0,
  `total_losses` int(11) DEFAULT 0,
  `trend` varchar(10) DEFAULT '-',
  `failed_login_attempts` int(11) DEFAULT 0,
  `locked_until` datetime DEFAULT NULL,
  `last_login_attempt` datetime DEFAULT NULL,
  `country` varchar(2) DEFAULT NULL,
  `avatar` varchar(255) DEFAULT NULL,
  `enable_ranked` tinyint(1) NOT NULL DEFAULT 0,
  `last_match_date` datetime DEFAULT NULL COMMENT 'Timestamp of last match participation — used to determine active status',
  PRIMARY KEY (`id`),
  KEY `idx_nickname` (`nickname`),
  KEY `idx_users_extension_last_match_date` (`last_match_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

-- Dump completed on 2026-05-14 21:42:14
