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
            signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
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

        -- Table pour les statistiques globales
        CREATE TABLE IF NOT EXISTS global_stats (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        -- Table pour les sessions de jeu (pour tracking avancé)
        CREATE TABLE IF NOT EXISTS game_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pacte_id INTEGER,
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            ended_at TIMESTAMP,
            result TEXT CHECK (result IN ('win', 'loss', 'ongoing')),
            participants_count INTEGER,
            FOREIGN KEY (pacte_id) REFERENCES pactes(id) ON DELETE CASCADE
        );

        -- Index pour optimiser les requêtes
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

    // Triggers pour mettre à jour automatiquement les timestamps
    await db.exec(`
        -- Trigger pour mettre à jour updated_at sur users
        CREATE TRIGGER IF NOT EXISTS update_users_timestamp 
        AFTER UPDATE ON users
        FOR EACH ROW
        BEGIN
            UPDATE users SET updated_at = CURRENT_TIMESTAMP WHERE discord_id = NEW.discord_id;
        END;

        -- Trigger pour mettre à jour updated_at sur global_stats
        CREATE TRIGGER IF NOT EXISTS update_global_stats_timestamp 
        AFTER UPDATE ON global_stats
        FOR EACH ROW
        BEGIN
            UPDATE global_stats SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
        END;

        -- Trigger pour calculer automatiquement les points lors de la complétion d'un pacte
        CREATE TRIGGER IF NOT EXISTS update_pacte_completion_timestamp 
        AFTER UPDATE OF status ON pactes
        FOR EACH ROW
        WHEN NEW.status IN ('success', 'failed') AND OLD.status NOT IN ('success', 'failed')
        BEGIN
            UPDATE pactes SET completed_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
        END;
    `);

    // Migrations pour ajouter les nouvelles colonnes si elles n'existent pas
    const migrations = [
        {
            table: 'users',
            column: 'created_at',
            definition: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
        },
        {
            table: 'users',
            column: 'updated_at',
            definition: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP'
        },
        {
            table: 'pactes',
            column: 'warning_sent',
            definition: 'BOOLEAN DEFAULT 0'
        },
        {
            table: 'pactes',
            column: 'current_game_id',
            definition: 'TEXT'
        },
        {
            table: 'game_history',
            column: 'game_duration',
            definition: 'INTEGER'
        },
        {
            table: 'game_history',
            column: 'game_end_timestamp',
            definition: 'BIGINT'
        }
    ];

    for (const migration of migrations) {
        try {
            await db.run(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`);
            logger.info(`Added ${migration.column} column to ${migration.table} table`);
        } catch (error) {
            // La colonne existe déjà ou autre erreur - ignorer
        }
    }

    // Initialiser les statistiques globales si elles n'existent pas
    await initGlobalStats();

    logger.info('Database initialized successfully');
    return db;
}

async function initGlobalStats() {
    const stats = [
        { key: 'total_pactes_created', value: '0' },
        { key: 'total_pactes_completed', value: '0' },
        { key: 'total_pactes_successful', value: '0' },
        { key: 'total_games_tracked', value: '0' },
        { key: 'total_users_registered', value: '0' },
        { key: 'server_start_time', value: new Date().toISOString() },
        { key: 'last_monthly_reset', value: new Date().toISOString().slice(0, 7) }, // YYYY-MM
    ];

    for (const stat of stats) {
        try {
            await db.run(
                'INSERT OR IGNORE INTO global_stats (key, value) VALUES (?, ?)',
                [stat.key, stat.value]
            );
        } catch (error) {
            logger.error(`Error initializing global stat ${stat.key}:`, error);
        }
    }
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

// Fonctions utilitaires pour les statistiques
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

// Fonction de maintenance de la base de données
async function runMaintenance() {
    if (!db) return;
    
    try {
        logger.info('Running database maintenance...');
        
        // Nettoyer les anciennes sessions de jeu
        await db.run(
            'DELETE FROM game_sessions WHERE ended_at < datetime("now", "-7 days")'
        );
        
        // Nettoyer les vieux logs de game_history (garder 30 jours)
        await db.run(
            'DELETE FROM game_history WHERE processed_at < datetime("now", "-30 days")'
        );
        
        // Optimiser la base de données
        await db.run('VACUUM');
        await db.run('ANALYZE');
        
        logger.info('Database maintenance completed');
    } catch (error) {
        logger.error('Error during database maintenance:', error);
    }
}

// Fonction pour obtenir des statistiques de santé de la DB
async function getDatabaseStats() {
    if (!db) return null;
    
    try {
        const stats = {};
        
        // Compter les tables principales
        const tables = ['users', 'pactes', 'participants', 'game_history', 'monthly_history'];
        
        for (const table of tables) {
            const result = await db.get(`SELECT COUNT(*) as count FROM ${table}`);
            stats[table] = result.count;
        }
        
        // Statistiques sur les pactes
        const pacteStats = await db.all(`
            SELECT status, COUNT(*) as count 
            FROM pactes 
            GROUP BY status
        `);
        
        stats.pactes_by_status = {};
        pacteStats.forEach(stat => {
            stats.pactes_by_status[stat.status] = stat.count;
        });
        
        // Taille de la base de données
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