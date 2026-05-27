// backend/admin.js
// Admin API endpoints for manual control (trigger scrape, get status)

import { triggerManualScrape } from './scheduler.js';
import { getTotalAnimeCount, getStats } from './database.js';

/**
 * Register admin routes on Express app
 * Note: In production, you should add authentication middleware
 */
export function registerAdminRoutes(app) {
    
    // Trigger manual scrape
    app.post('/api/admin/scrape', async (req, res) => {
        try {
            // In production, add API key check here
            // const apiKey = req.headers['x-api-key'];
            // if (apiKey !== process.env.ADMIN_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
            
            console.log('🖐️ Manual scrape triggered via API');
            
            // Run scrape asynchronously, but return quickly
            triggerManualScrape().then(summary => {
                console.log('Manual scrape completed:', summary);
            }).catch(err => {
                console.error('Manual scrape error:', err);
            });
            
            res.json({ 
                success: true, 
                message: 'Scrape started in background. Check logs for results.' 
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
    
    // Get scraper status
    app.get('/api/admin/status', async (req, res) => {
        try {
            const totalAnime = getTotalAnimeCount();
            const stats = getStats();
            
            res.json({
                success: true,
                database: 'SQLite',
                total_anime: totalAnime,
                stats: stats,
                scheduler: {
                    enabled: true,
                    interval_minutes: 10
                }
            });
        } catch (error) {
            res.status(500).json({ success: false, error: error.message });
        }
    });
}