const winston = require('winston');
const path = require('path');
const fs = require('fs');

// Créer le dossier logs s'il n'existe pas
const logDir = path.join(__dirname, '../../logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}

// Format personnalisé pour éviter les logs répétitifs
const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
    let msg = `${timestamp} ${level}: ${message}`;
    if (Object.keys(metadata).length > 0) {
        msg += ` ${JSON.stringify(metadata)}`;
    }
    return msg;
});

// Filtre pour éviter les logs de polling répétitifs
const filterPolling = winston.format((info) => {
    // Ignorer les logs de polling sauf s'il y a un changement
    if (info.message && info.message.includes('Checking pacte') && info.level === 'debug') {
        return false;
    }
    return info;
})();

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info', // Configurable via .env
    format: winston.format.combine(
        filterPolling,
        winston.format.timestamp({
            format: 'YYYY-MM-DD HH:mm:ss'
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        customFormat
    ),
    defaultMeta: { service: 'pacte-aram-bot' },
    transports: [
        // Fichier pour les erreurs uniquement
        new winston.transports.File({ 
            filename: path.join(logDir, 'error.log'), 
            level: 'error',
            maxsize: 10485760, // 10MB
            maxFiles: 5,
            tailable: true
        }),
        // Fichier pour les événements importants (pas le debug)
        new winston.transports.File({ 
            filename: path.join(logDir, 'combined.log'),
            level: 'info', // Ne log que info, warn, error
            maxsize: 20971520, // 20MB
            maxFiles: 7,
            tailable: true
        }),
        // Console pour le développement
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            ),
            level: process.env.NODE_ENV === 'production' ? 'info' : 'debug'
        })
    ]
});

// Ajouter un transport daily rotate si en production
if (process.env.NODE_ENV === 'production') {
    const DailyRotateFile = require('winston-daily-rotate-file');
    
    // Logs quotidiens avec rotation automatique
    logger.add(new DailyRotateFile({
        filename: path.join(logDir, 'app-%DATE%.log'),
        datePattern: 'YYYY-MM-DD',
        zippedArchive: true,
        maxSize: '20m',
        maxFiles: '14d', // Garde seulement 14 jours
        level: 'info'
    }));
}

// Méthodes utilitaires pour éviter les logs répétitifs
let lastPollingLog = 0;
const POLLING_LOG_INTERVAL = 60000; // Log le polling seulement toutes les minutes

logger.logPolling = (message, metadata = {}) => {
    const now = Date.now();
    if (now - lastPollingLog > POLLING_LOG_INTERVAL) {
        logger.debug(message, metadata);
        lastPollingLog = now;
    }
};

// Log uniquement les changements d'état
const stateCache = new Map();

logger.logStateChange = (key, newState, message) => {
    const previousState = stateCache.get(key);
    if (JSON.stringify(previousState) !== JSON.stringify(newState)) {
        stateCache.set(key, newState);
        logger.info(message, { key, newState });
        return true;
    }
    return false;
};

module.exports = logger;