const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');
const logger = require('./logger');
const fs = require('fs');
const path = require('path');

let db;

async function initDatabase() {
    // Ensure directories exist
    const dirs = ['./database', './logs'];
    dirs.forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    db = await open({
        filename: './database/pactes.db',
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            discord_id TEXT PRIMARY KEY,
            riot_puuid TEXT UNIQUE NOT NULL,
            summoner_name TEXT NOT NULL,
            points_total INTEGER DEFAULT 0,
            points_monthly INTEGER DEFAULT 0,
            best_streak_ever INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS pactes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            objective INTEGER NOT NULL CHECK (objective >= 3 AND objective <= 10),
            status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'success', 'failed')),
            current_wins INTEGER DEFAULT 0 CHECK (current_wins >= 0),
            best_streak_reached INTEGER DEFAULT 0,
            in_game BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP,
            completed_at TIMESTAMP,
            log_channel_id TEXT,
            last_checked TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS participants (
            pacte_id INTEGER,
            discord_id TEXT,
            signed_at TIMESTAMP,
            left_at TIMESTAMP,
            points_gained INTEGER DEFAULT 0,
            kicked_at TIMESTAMP,
            kick_reason TEXT,
            PRIMARY KEY (pacte_id, discord_id),
            FOREIGN KEY (pacte_id) REFERENCES pactes(id),
            FOREIGN KEY (discord_id) REFERENCES users(discord_id)
        );

        CREATE TABLE IF NOT EXISTS monthly_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT,
            month TEXT,
            points_monthly INTEGER DEFAULT 0,
            points_end_of_month INTEGER DEFAULT 0,
            FOREIGN KEY (discord_id) REFERENCES users(discord_id)
        );

        CREATE TABLE IF NOT EXISTS game_history (
            match_id TEXT PRIMARY KEY,
            pacte_id INTEGER,
            processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            result TEXT CHECK (result IN ('win', 'loss')),
            FOREIGN KEY (pacte_id) REFERENCES pactes(id)
        );

        CREATE INDEX IF NOT EXISTS idx_pactes_status ON pactes(status);
        CREATE INDEX IF NOT EXISTS idx_pactes_channel ON pactes(log_channel_id);
        CREATE INDEX IF NOT EXISTS idx_pactes_created_at ON pactes(created_at);
        CREATE INDEX IF NOT EXISTS idx_pactes_last_checked ON pactes(last_checked);
        CREATE INDEX IF NOT EXISTS idx_users_points ON users(points_total);
        CREATE INDEX IF NOT EXISTS idx_participants_pacte ON participants(pacte_id);
        CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(discord_id);
        CREATE INDEX IF NOT EXISTS idx_participants_signed ON participants(signed_at);
        CREATE INDEX IF NOT EXISTS idx_participants_left ON participants(left_at);
        CREATE INDEX IF NOT EXISTS idx_participants_kicked ON participants(kicked_at);
        CREATE INDEX IF NOT EXISTS idx_monthly_history ON monthly_history(discord_id, month);
        CREATE INDEX IF NOT EXISTS idx_game_history_match ON game_history(match_id);
        CREATE INDEX IF NOT EXISTS idx_game_history_pacte ON game_history(pacte_id);
        CREATE INDEX IF NOT EXISTS idx_game_history_processed ON game_history(processed_at);
    `);

    // Migration pour ajouter created_at si elle n'existe pas
    try {
        await db.run(`ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
        logger.info('Added created_at column to users table');
    } catch (error) {
        // La colonne existe déjà ou autre erreur - ignorer
    }

    logger.info('Database initialized');
}

function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

module.exports = {
    initDatabase,
    getDb
};