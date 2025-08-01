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

    // Enable foreign keys
    await db.run('PRAGMA foreign_keys = ON');
    
    // Optimize for performance
    await db.run('PRAGMA journal_mode = WAL');
    await db.run('PRAGMA synchronous = NORMAL');
    await db.run('PRAGMA cache_size = 10000');
    await db.run('PRAGMA temp_store = memory');

    // Create tables
    await db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            discord_id TEXT PRIMARY KEY,
            riot_puuid TEXT UNIQUE NOT NULL,
            summoner_name TEXT NOT NULL,
            points_total INTEGER DEFAULT 0,
            points_monthly INTEGER DEFAULT 0,
            best_streak_ever INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
            last_checked TIMESTAMP,
            warning_sent BOOLEAN DEFAULT 0,
            current_game_id TEXT
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
            FOREIGN KEY (pacte_id) REFERENCES pactes(id) ON DELETE CASCADE,
            FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS monthly_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            discord_id TEXT,
            month TEXT,
            points_monthly INTEGER DEFAULT 0,
            points_end_of_month INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (discord_id) REFERENCES users(discord_id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS game_history (
            match_id TEXT PRIMARY KEY,
            pacte_id INTEGER,
            processed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            result TEXT CHECK (result IN ('win', 'loss')),
            game_duration INTEGER,
            game_end_timestamp BIGINT,
            FOREIGN KEY (pacte_id) REFERENCES pactes(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS global_stats (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS game_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pacte_id INTEGER,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP,
            result TEXT CHECK (result IN ('win', 'loss', 'ongoing')),
            participants_count INTEGER,
            FOREIGN KEY (pacte_id) REFERENCES pactes(id) ON DELETE CASCADE
        );
    `);

    // Create indexes
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_pactes_status ON pactes(status);
        CREATE INDEX IF NOT EXISTS idx_pactes_channel ON pactes(log_channel_id);
        CREATE INDEX IF NOT EXISTS idx_pactes_created_at ON pactes(created_at);
        CREATE INDEX IF NOT EXISTS idx_pactes_last_checked ON pactes(last_checked);
        CREATE INDEX IF NOT EXISTS idx_pactes_in_game ON pactes(in_game);
        CREATE INDEX IF NOT EXISTS idx_pactes_status_in_game ON pactes(status, in_game);
        CREATE INDEX IF NOT EXISTS idx_users_points ON users(points_total DESC);
        CREATE INDEX IF NOT EXISTS idx_users_monthly ON users(points_monthly DESC);
        CREATE INDEX IF NOT EXISTS idx_users_streak ON users(best_streak_ever DESC);
        CREATE INDEX IF NOT EXISTS idx_users_updated ON users(updated_at);
        CREATE INDEX IF NOT EXISTS idx_participants_pacte ON participants(pacte_id);
        CREATE INDEX IF NOT EXISTS idx_participants_user ON participants(discord_id);
        CREATE INDEX IF NOT EXISTS idx_participants_signed ON participants(signed_at);
        CREATE INDEX IF NOT EXISTS idx_participants_left ON participants(left_at);
        CREATE INDEX IF NOT EXISTS idx_participants_kicked ON participants(kicked_at);
        CREATE INDEX IF NOT EXISTS idx_participants_active ON participants(pacte_id, left_at, kicked_at);
        CREATE INDEX IF NOT EXISTS idx_monthly_history ON monthly_history(discord_id, month);
        CREATE INDEX IF NOT EXISTS idx_game_history_match ON game_history(match_id);
        CREATE INDEX IF NOT EXISTS idx_game_history_pacte ON game_history(pacte_id);
        CREATE INDEX IF NOT EXISTS idx_game_history_processed ON game_history(processed_at);
        CREATE INDEX IF NOT EXISTS idx_game_history_result ON game_history(result);
        CREATE INDEX IF NOT EXISTS idx_global_stats_key ON global_stats(key);
        CREATE INDEX IF NOT EXISTS idx_game_sessions_pacte ON game_sessions(pacte_id);
        CREATE INDEX IF NOT EXISTS idx_game_sessions_result ON game_sessions(result);
    `);

    // Migrations pour les colonnes manquantes
    const migrations = [
        {
            check: "SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name='created_at'",
            sql: "ALTER TABLE users ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        },
        {
            check: "SELECT COUNT(*) as count FROM pragma_table_info('users') WHERE name='updated_at'",
            sql: "ALTER TABLE users ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        },
        {
            check: "SELECT COUNT(*) as count FROM pragma_table_info('pactes') WHERE name='warning_sent'",
            sql: "ALTER TABLE pactes ADD COLUMN warning_sent BOOLEAN DEFAULT 0"
        },
        {
            check: "SELECT COUNT(*) as count FROM pragma_table_info('pactes') WHERE name='current_game_id'",
            sql: "ALTER TABLE pactes ADD COLUMN current_game_id TEXT"
        },
        {
            check: "SELECT COUNT(*) as count FROM pragma_table_info('game_history') WHERE name='game_duration'",
            sql: "ALTER TABLE game_history ADD COLUMN game_duration INTEGER"
        },
        {
            check: "SELECT COUNT(*) as count FROM pragma_table_info('game_history') WHERE name='game_end_timestamp'",
            sql: "ALTER TABLE game_history ADD COLUMN game_end_timestamp BIGINT"
        },
        {
            check: "SELECT COUNT(*) as count FROM pragma_table_info('pactes') WHERE name='error_count'",
            sql: "ALTER TABLE pactes ADD COLUMN error_count INTEGER DEFAULT 0"
        },
        // Migration pour nettoyer les états incohérents
        {
            check: "SELECT COUNT(*) as count FROM pactes WHERE in_game = 1 AND current_game_id IS NULL",
            sql: "UPDATE pactes SET in_game = 0 WHERE in_game = 1 AND current_game_id IS NULL"
        }
    ];

    for (const migration of migrations) {
        try {
            const result = await db.get(migration.check);
            if (result.count === 0) {
                await db.run(migration.sql);
                logger.info(`Migration executed: ${migration.sql.substring(0, 50)}...`);
            }
        } catch (error) {
            // Ignorer si la colonne existe déjà
        }
    }

    // Initialiser les stats globales
    const defaultStats = [
        ['total_pactes_created', '0'],
        ['total_pactes_completed', '0'],
        ['total_pactes_successful', '0'],
        ['total_games_tracked', '0'],
        ['total_users_registered', '0'],
        ['server_start_time', new Date().toISOString()],
        ['last_monthly_reset', new Date().toISOString().slice(0, 7)]
    ];

    for (const [key, value] of defaultStats) {
        await db.run(
            'INSERT OR IGNORE INTO global_stats (key, value) VALUES (?, ?)',
            [key, value]
        ).catch(() => {}); // Ignorer les erreurs si la clé existe déjà
    }

    logger.info('Database initialized successfully');
    return db;
}

function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase() first.');
    }
    return db;
}

async function closeDatabase() {
    if (db) {
        await db.close();
        db = null;
        logger.info('Database connection closed');
    }
}

// Fonctions utilitaires
async function updateGlobalStat(key, value) {
    if (!db) return;
    try {
        await db.run(
            'INSERT OR REPLACE INTO global_stats (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
            [key, value.toString()]
        );
    } catch (error) {
        logger.error(`Error updating global stat ${key}:`, error);
    }
}

async function getGlobalStat(key) {
    if (!db) return null;
    try {
        const result = await db.get('SELECT value FROM global_stats WHERE key = ?', [key]);
        return result ? result.value : null;
    } catch (error) {
        logger.error(`Error getting global stat ${key}:`, error);
        return null;
    }
}

async function incrementGlobalStat(key, increment = 1) {
    if (!db) return;
    try {
        const current = await getGlobalStat(key);
        const newValue = (parseInt(current) || 0) + increment;
        await updateGlobalStat(key, newValue);
    } catch (error) {
        logger.error(`Error incrementing global stat ${key}:`, error);
    }
}

async function runMaintenance() {
    if (!db) return;
    
    try {
        logger.info('Running database maintenance...');
        
        await db.run('DELETE FROM game_sessions WHERE ended_at < datetime("now", "-7 days")');
        await db.run('DELETE FROM game_history WHERE processed_at < datetime("now", "-30 days")');
        
        await db.run('VACUUM');
        await db.run('ANALYZE');
        
        logger.info('Database maintenance completed');
    } catch (error) {
        logger.error('Error during database maintenance:', error);
    }
}

async function getDatabaseStats() {
    if (!db) return null;
    
    try {
        const stats = {};
        
        const tables = ['users', 'pactes', 'participants', 'game_history', 'monthly_history'];
        
        for (const table of tables) {
            const result = await db.get(`SELECT COUNT(*) as count FROM ${table}`);
            stats[table] = result.count;
        }
        
        const pacteStats = await db.all(`
            SELECT status, COUNT(*) as count 
            FROM pactes 
            GROUP BY status
        `);
        
        stats.pactes_by_status = {};
        pacteStats.forEach(stat => {
            stats.pactes_by_status[stat.status] = stat.count;
        });
        
        const dbStats = await db.get("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()");
        stats.database_size_bytes = dbStats.size;
        stats.database_size_mb = Math.round(dbStats.size / 1024 / 1024 * 100) / 100;
        
        return stats;
    } catch (error) {
        logger.error('Error getting database stats:', error);
        return null;
    }
}

module.exports = {
    initDatabase,
    getDb,
    closeDatabase,
    updateGlobalStat,
    getGlobalStat,
    incrementGlobalStat,
    runMaintenance,
    getDatabaseStats
};