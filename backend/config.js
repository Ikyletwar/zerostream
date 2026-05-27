// backend/config.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../.env') });

export const config = {
    // Server
    PORT: process.env.PORT || 3000,
    NODE_ENV: process.env.NODE_ENV || 'development',
    
    // Scheduler
    SCRAPE_INTERVAL_MINUTES: parseInt(process.env.SCRAPE_INTERVAL_MINUTES) || 10,
    
    // Rate limiting
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 menit
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    
    // Scraper
    REQUEST_DELAY_MS: parseInt(process.env.REQUEST_DELAY_MS) || 500,
    SCRAPE_CONCURRENCY: parseInt(process.env.SCRAPE_CONCURRENCY) || 5,
    
    // Cache
    CACHE_TTL_SECONDS: parseInt(process.env.CACHE_TTL_SECONDS) || 60,
    CACHE_CHECK_PERIOD_SECONDS: parseInt(process.env.CACHE_CHECK_PERIOD_SECONDS) || 120,
    
    // Security
    CORS_ORIGIN: process.env.CORS_ORIGIN || '*',
    ADMIN_API_KEY: process.env.ADMIN_API_KEY || null, // untuk production, set ini
    
    // Logging
    LOG_LEVEL: process.env.LOG_LEVEL || 'info',
    
    // Database
    DB_PATH: path.join(__dirname, 'data', 'nimegami.db'),
    
    isProduction: () => process.env.NODE_ENV === 'production',
    isDevelopment: () => process.env.NODE_ENV === 'development'
};