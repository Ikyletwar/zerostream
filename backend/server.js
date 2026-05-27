// backend/server.js - Fase 4 Production Ready
import express from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import { fileURLToPath } from 'url';
import fs from 'fs';

import { config } from './config.js';
import { logger, logApiRequest } from './logger.js';
import { 
    apiLimiter, adminLimiter, cacheMiddleware, 
    requestLogger, securityHeaders, requireAdminApiKey 
} from './middleware.js';

import { 
    getAnimeById, getAllAnime, getAllAnimeNoPagination,
    getAllGenres, getStats, getTotalAnimeCount,
    getLatestEpisodes, getRecentlyUpdatedAnime, getNewReleases, getFeedEvents
} from './database.js';

import { initScheduler, triggerManualScrape } from './scheduler.js';
import { initWebSocketServer, getConnectedClientsCount } from './websocket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = config.PORT;

// Middleware
app.use(cors({ origin: config.CORS_ORIGIN }));
app.use(express.json());
app.use(securityHeaders);
app.use(requestLogger);
app.use(express.static(path.join(__dirname, '../frontend')));

// Rate limiting untuk API routes
app.use('/api', apiLimiter);

// ========== API ROUTES dengan caching ==========
app.get('/api', (req, res) => {
    res.json({
        name: 'ZeroStream API',
        version: '4.0.0',
        total_anime: getTotalAnimeCount(),
        database: 'SQLite',
        websocket: 'enabled',
        scheduler: `active (every ${config.SCRAPE_INTERVAL_MINUTES} min)`,
        uptime: process.uptime(),
        endpoints: ['...']
    });
});

app.get('/api/schedule', cacheMiddleware(3600), (req, res) => {
    try {
        const cachePath = path.join(__dirname, 'data/ongoing_schedule_cache.json');
        if (!fs.existsSync(cachePath)) {
            return res.json({ success: true, data: [], cachedAt: Date.now() });
        }
        const cache = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
        res.json({ success: true, data: cache.data, cachedAt: cache.timestamp });
    } catch (error) {
        logger.error('Error in /api/schedule', { error: error.message });
        res.status(500).json({ success: false, error: 'Schedule not available' });
    }
});

app.get('/api/anime/all', cacheMiddleware(), (req, res) => {
    try {
        const data = getAllAnimeNoPagination();
        res.json({ success: true, total: data.length, data });
    } catch (error) {
        logger.error('Error in /api/anime/all', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/anime', cacheMiddleware(30), (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const result = getAllAnime({
            page, limit,
            genre: req.query.genre,
            status: req.query.status,
            search: req.query.search,
            sort: req.query.sort,
            order: req.query.order
        });
        res.json({ success: true, ...result });
    } catch (error) {
        logger.error('Error in /api/anime', { error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/anime/:id', cacheMiddleware(300), (req, res) => {
    try {
        const anime = getAnimeById(req.params.id);
        if (!anime) return res.status(404).json({ success: false, error: 'Not found' });
        res.json({ success: true, data: anime });
    } catch (error) {
        logger.error('Error in /api/anime/:id', { id: req.params.id, error: error.message });
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/genres', cacheMiddleware(3600), (req, res) => {
    try {
        const genres = getAllGenres();
        res.json({ success: true, total: genres.length, data: genres });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/stats', cacheMiddleware(300), (req, res) => {
    try {
        const stats = getStats();
        res.json({ success: true, stats });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Fase 3 endpoints dengan cache
app.get('/api/latest/episodes', cacheMiddleware(30), (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const episodes = getLatestEpisodes(limit);
        res.json({ success: true, data: episodes });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/latest/anime', cacheMiddleware(60), (req, res) => {
    try {
        const type = req.query.type || 'new_release';
        const limit = Math.min(parseInt(req.query.limit) || 10, 50);
        const data = type === 'recently_updated' ? getRecentlyUpdatedAnime(limit) : getNewReleases(limit);
        res.json({ success: true, type, data });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

app.get('/api/live-feed', cacheMiddleware(10), (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 30, 100);
        const events = getFeedEvents(limit);
        res.json({ success: true, data: events });
    } catch (error) {
        res.status(500).json({ success: false, error: 'Internal server error' });
    }
});

// Admin routes dengan API key
app.post('/api/admin/scrape', adminLimiter, requireAdminApiKey, async (req, res) => {
    try {
        logger.info('Manual scrape triggered via API');
        triggerManualScrape().then(summary => {
            logger.info(`Manual scrape completed: ${summary.newEpisodes.length} new episodes`);
        }).catch(err => {
            logger.error('Manual scrape error', { error: err.message });
        });
        res.json({ success: true, message: 'Scrape started in background' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.get('/api/admin/status', requireAdminApiKey, (req, res) => {
    res.json({
        success: true,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        websocket_clients: getConnectedClientsCount(),
        db_anime_count: getTotalAnimeCount(),
        scheduler_interval_minutes: config.SCRAPE_INTERVAL_MINUTES,
        node_version: process.version,
        env: config.NODE_ENV
    });
});

// Health check endpoint (no cache, no rate limit)
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok', timestamp: Date.now() });
});

// Frontend routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});
app.get('/anime', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/anime.html'));
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({ success: false, error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error', { error: err.message, stack: err.stack });
    res.status(500).json({ success: false, error: 'Internal server error' });
});

// ========== SERVER STARTUP ==========
const server = http.createServer(app);
initWebSocketServer(server);
initScheduler();

server.listen(PORT, '0.0.0.0', () => {
    logger.info(`ZeroStream server started on port ${PORT}`);
    console.log(`
╔══════════════════════════════════════════════════╗
║        🎬 ZEROSTREAM STREAMING SERVER 🎬        ║
╠══════════════════════════════════════════════════╣
║  Server: http://localhost:${PORT}                 ║
║  API: http://localhost:${PORT}/api               ║
║  WebSocket: ws://localhost:${PORT}                ║
║  Environment: ${config.NODE_ENV}                    ║
║  Cache: TTL ${config.CACHE_TTL_SECONDS}s            ║
╚══════════════════════════════════════════════════╝
    `);
});