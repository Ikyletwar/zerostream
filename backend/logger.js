// backend/logger.js
import winston from 'winston';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDir = path.join(__dirname, 'logs');
import fs from 'fs';
if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });

const logFormat = winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
);

const consoleFormat = winston.format.combine(
    winston.format.colorize(),
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
        return `${timestamp} [${level}]: ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
    })
);

export const logger = winston.createLogger({
    level: config.LOG_LEVEL,
    format: logFormat,
    transports: [
        new winston.transports.File({ filename: path.join(logDir, 'error.log'), level: 'error' }),
        new winston.transports.File({ filename: path.join(logDir, 'combined.log') }),
        new winston.transports.Console({ format: consoleFormat })
    ]
});

export function logScrapeStart() {
    logger.info('Incremental scrape started');
}

export function logScrapeComplete(summary) {
    logger.info(`Scrape completed: ${summary.newEpisodes.length} new episodes, ${summary.newAnime.length} new anime`);
}

export function logScrapeError(error) {
    logger.error(`Scrape failed: ${error.message}`, { stack: error.stack });
}

export function logApiRequest(req, res, duration) {
    logger.http(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
}