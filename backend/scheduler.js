// backend/scheduler.js
import cron from 'node-cron';
import { incrementalScrape } from './scraper/incremental.js';
import { config } from './config.js';
import { logger, logScrapeStart, logScrapeComplete, logScrapeError } from './logger.js';

let isScraping = false;
let currentCronTask = null;

async function runScrape() {
    if (isScraping) {
        logger.warn('Scrape already in progress, skipping');
        return;
    }
    isScraping = true;
    logScrapeStart();
    try {
        const summary = await incrementalScrape();
        logScrapeComplete(summary);
        if (summary.newEpisodes.length > 0) {
            logger.info(`New episodes found: ${summary.newEpisodes.map(e => `${e.animeTitle} EP${e.episodeNumber}`).join(', ')}`);
        }
    } catch (error) {
        logScrapeError(error);
    } finally {
        isScraping = false;
    }
}

export function initScheduler() {
    if (currentCronTask) currentCronTask.stop();
    const pattern = `*/${config.SCRAPE_INTERVAL_MINUTES} * * * *`;
    currentCronTask = cron.schedule(pattern, runScrape);
    logger.info(`Scheduler initialized: every ${config.SCRAPE_INTERVAL_MINUTES} minutes (${pattern})`);
}

export async function triggerManualScrape() {
    return await runScrape();
}

export function stopScheduler() {
    if (currentCronTask) currentCronTask.stop();
    logger.info('Scheduler stopped');
}