// backend/middleware.js
import rateLimit from 'express-rate-limit';
import NodeCache from 'node-cache';
import { config } from './config.js';
import { logger } from './logger.js';

// Cache instance
export const cache = new NodeCache({
    stdTTL: config.CACHE_TTL_SECONDS,
    checkperiod: config.CACHE_CHECK_PERIOD_SECONDS
});

// Rate limiter untuk API
export const apiLimiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS,
    max: config.RATE_LIMIT_MAX_REQUESTS,
    message: { success: false, error: 'Too many requests, please try again later.' },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
        return req.ip || req.connection.remoteAddress;
    }
});

// Rate limiter lebih ketat untuk admin endpoints
export const adminLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 menit
    max: 5,
    message: { success: false, error: 'Too many admin requests, slow down.' }
});

// Middleware untuk API key admin (production)
export function requireAdminApiKey(req, res, next) {
    if (!config.isProduction()) {
        return next(); // skip di development
    }
    const apiKey = req.headers['x-api-key'];
    if (!apiKey || apiKey !== config.ADMIN_API_KEY) {
        logger.warn(`Unauthorized admin access attempt from ${req.ip}`);
        return res.status(401).json({ success: false, error: 'Unauthorized' });
    }
    next();
}

// Middleware untuk cache GET requests
export function cacheMiddleware(durationSeconds = config.CACHE_TTL_SECONDS) {
    return (req, res, next) => {
        if (req.method !== 'GET') return next();
        const key = `cache:${req.originalUrl || req.url}`;
        const cached = cache.get(key);
        if (cached) {
            res.setHeader('X-Cache', 'HIT');
            return res.json(cached);
        }
        res.originalJson = res.json;
        res.json = function(data) {
            cache.set(key, data, durationSeconds);
            res.setHeader('X-Cache', 'MISS');
            res.originalJson(data);
        };
        next();
    };
}

// Middleware untuk logging request duration
export function requestLogger(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        logger.http(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
    });
    next();
}

// Middleware untuk security headers
export function securityHeaders(req, res, next) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    if (config.isProduction()) {
        res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
}