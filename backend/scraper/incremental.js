// backend/scraper/incremental.js
// Incremental scraper with WebSocket integration & Dual-Source Scheduling
import axios from 'axios';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { 
    getDatabase, 
    upsertAnime, 
    getAnimeById,
    addFeedEvent
} from '../database.js';
import { emitNewEpisode } from '../websocket.js';
import { logger } from '../logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CACHE_FILE_PATH = path.join(__dirname, '../data/ongoing_schedule_cache.json');

const BASE_URL = 'https://nimegami.id';
const ONGOING_URL = 'https://nimegami.id/anime-terbaru-sub-indo/';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml'
};
const REQUEST_DELAY_MS = 500;
const MAX_RETRIES = 2;

let lastKnownHash = null;
let currentOngoingData = null;
let lastFetchedHtml = null;
let lastFetchedUrl = null;

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function fetchHtml(url, retries = MAX_RETRIES) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await axios.get(url, { timeout: 15000, headers: HEADERS });
            return response.data;
        } catch (error) {
            if (i === retries - 1) return null;
            await sleep(1000 * (i + 1));
        }
    }
    return null;
}

async function fetchHtmlWithCache(url) {
    if (lastFetchedUrl === url && lastFetchedHtml) {
        const html = lastFetchedHtml;
        lastFetchedHtml = null; // Clear so it only gets used once
        return html;
    }
    const html = await fetchHtml(url);
    if (html) {
        lastFetchedHtml = html;
        lastFetchedUrl = url;
    }
    return html;
}

function extractSlug(url) {
    if (!url) return null;
    const match = url.match(/\/([^\/?#]+)\/?$/);
    return match ? match[1] : null;
}

// B.1. scrapeOngoingSchedule()
export async function scrapeOngoingSchedule() {
    console.log('🔍 Scraping ongoing schedule...');
    const html = await fetchHtmlWithCache(ONGOING_URL);
    if (!html) throw new Error('Failed to fetch ongoing schedule HTML');
    
    const $ = cheerio.load(html);
    const schedule = [];
    
    $('.wrapper-3.post-3, #senin, #selasa, #rabu, #kamis, #jumat, #sabtu, #minggu').each((i, dayEl) => {
        const dayId = $(dayEl).attr('id');
        if (!dayId) return;
        const day = dayId.toLowerCase();
        if (!['senin', 'selasa', 'rabu', 'kamis', 'jumat', 'sabtu', 'minggu'].includes(day)) return;
        
        $(dayEl).find('article').each((j, el) => {
            const $el = $(el);
            const thumbA = $el.find('.thumb a');
            const animeUrl = thumbA.attr('href');
            if (!animeUrl) return;
            
            const slug = extractSlug(animeUrl);
            if (!slug) return;
            
            const titleLink = $el.find('h3 a');
            const title = titleLink.text().trim();
            
            const epsText = $el.find('.eps_ongo').text().trim();
            const epsMatch = epsText.match(/\d+/);
            const latestEpisode = epsMatch ? parseInt(epsMatch[0], 10) : 0;
            
            const isUpdatedToday = $el.find('.ongoing_updated.updated_yes').length > 0;
            const genre = $el.find('.live-action-live a').text().trim();
            const synopsisShort = $el.find('.snippet').text().trim();
            
            schedule.push({
                day,
                title,
                slug,
                animeUrl,
                latestEpisode,
                isUpdatedToday,
                genre,
                synopsisShort
            });
        });
    });
    
    console.log(`📊 Found ${schedule.length} schedule entries`);
    return schedule;
}

// B.2. getPageHash(url)
export async function getPageHash(url) {
    const html = await fetchHtmlWithCache(url);
    if (!html) throw new Error(`Failed to fetch page for hashing: ${url}`);
    return crypto.createHash('md5').update(html).digest('hex');
}

// B.3. validateEpisodeUpdate(animeSlug, episodeNumber)
export function validateEpisodeUpdate(animeSlug, episodeNumber) {
    if (currentOngoingData) {
        const match = currentOngoingData.find(a => a.slug === animeSlug);
        return match ? match.isUpdatedToday === true : false;
    }
    try {
        const cache = loadScheduleFromCache();
        if (cache) {
            const match = cache.find(a => a.slug === animeSlug);
            return match ? match.isUpdatedToday === true : false;
        }
    } catch (e) {
        logger.error(`Error in validateEpisodeUpdate: ${e.message}`);
    }
    return false;
}

// B.4. updateAnimeInfoIfChanged(animeData)
export async function updateAnimeInfoIfChanged(animeData) {
    try {
        const existing = getAnimeById(animeData.id);
        if (!existing) return false;
        
        const getHash = (data) => {
            const genres = data.info?.genres || [];
            const totalEps = data.info?.total_episodes || 0;
            const text = `${data.title || ''}${data.synopsis || ''}${genres.join(',')}${totalEps}`;
            return crypto.createHash('sha256').update(text).digest('hex');
        };
        
        const oldHash = getHash(existing);
        const newHash = getHash(animeData);
        
        if (oldHash !== newHash) {
            upsertAnime(animeData);
            return true;
        }
    } catch (e) {
        logger.error(`Error in updateAnimeInfoIfChanged: ${e.message}`);
    }
    return false;
}

// B.5. saveScheduleToCache(data)
export function saveScheduleToCache(data) {
    try {
        const dir = path.dirname(CACHE_FILE_PATH);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify({
            timestamp: Date.now(),
            data
        }, null, 2), 'utf8');
    } catch (error) {
        logger.error(`Failed to save schedule to cache: ${error.message}`);
    }
}

// B.6. loadScheduleFromCache()
export function loadScheduleFromCache() {
    try {
        if (!fs.existsSync(CACHE_FILE_PATH)) return null;
        const content = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
        const parsed = JSON.parse(content);
        const ageMs = Date.now() - parsed.timestamp;
        if (ageMs < 24 * 60 * 60 * 1000) {
            return parsed.data;
        }
        logger.warn('Schedule cache expired (> 24 hours)');
    } catch (error) {
        logger.error(`Failed to load schedule from cache: ${error.message}`);
    }
    return null;
}

// B.7. notifyAdmin(errorMessage)
export async function notifyAdmin(errorMessage) {
    logger.error(`[Admin Notification] ${errorMessage}`);
    if (process.env.ADMIN_WEBHOOK_URL) {
        try {
            await axios.post(process.env.ADMIN_WEBHOOK_URL, {
                text: `[Nimegami] ${errorMessage}`
            }, { timeout: 5000 });
        } catch (error) {
            logger.error(`Failed to send admin notification webhook: ${error.message}`);
        }
    }
}

async function scrapeHomepage() {
    console.log('🔍 Scraping homepage for recent updates...');
    const html = await fetchHtml(BASE_URL);
    if (!html) return [];
    const $ = cheerio.load(html);
    const recentAnime = [];
    $('article, .post-article, .list-anime .item, .recent-post .item, .anime-list .item').each((i, el) => {
        const $el = $(el);
        const titleLink = $el.find('h2 a, .title a, a[href*="/anime/"]').first();
        const animeUrl = titleLink.attr('href');
        if (!animeUrl || !animeUrl.includes('/anime/')) return;
        const title = titleLink.text().trim();
        const animeSlug = extractSlug(animeUrl);
        if (!animeSlug) return;
        let latestEpisodeNumber = 0;
        const episodeText = $el.find('.episode, .eps, .meta-ep, .episode-number, .latest-ep').text();
        const episodeMatch = episodeText.match(/Episode\s*(\d+)|EP\s*(\d+)|(\d+)\s*eps/i);
        if (episodeMatch) latestEpisodeNumber = parseInt(episodeMatch[1] || episodeMatch[2] || episodeMatch[3]) || 0;
        const episodeLink = $el.find('a[href*="/episode/"]').attr('href');
        if (episodeLink && !latestEpisodeNumber) {
            const epMatch = episodeLink.match(/\/episode\/(\d+)/);
            if (epMatch) latestEpisodeNumber = parseInt(epMatch[1]);
        }
        recentAnime.push({ animeUrl, animeSlug, title, latestEpisodeNumber });
    });
    const unique = new Map();
    for (const item of recentAnime) {
        if (!unique.has(item.animeSlug) || unique.get(item.animeSlug).latestEpisodeNumber < item.latestEpisodeNumber) {
            unique.set(item.animeSlug, item);
        }
    }
    console.log(`📊 Found ${unique.size} unique anime on homepage`);
    return Array.from(unique.values());
}

async function fetchAnimeDetail(animeUrl, slug) {
    const html = await fetchHtml(animeUrl);
    if (!html) return null;
    const $ = cheerio.load(html);
    const title = $('h1.title, h1.entry-title, .single-title').first().text().trim();
    const synopsis = $('#Sinopsis p, .synopsis p, .description p').first().text().trim();
    let posterUrl = $('.thumbnail-a img, .poster img, .anime-poster img').first().attr('src');
    if (posterUrl && !posterUrl.startsWith('http')) posterUrl = BASE_URL + posterUrl;
    let rating = null;
    const ratingText = $('.rating, .info2 tr:contains("Rating") td, .score').text();
    const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
    if (ratingMatch) rating = parseFloat(ratingMatch[1]);
    let status = 'complete';
    if ($('.term_tag-a a:contains("On-going"), .status-ongoing, [class*="ongoing"]').length > 0) status = 'ongoing';
    const genres = [];
    $('.info2 tr:contains("Kategori") td a, .genres a, .genre-list a').each((i, el) => {
        const genre = $(el).text().trim();
        if (genre) genres.push(genre);
    });
    let duration = null, studio = null, season = null, type = null, credit = null, alternativeTitle = null, seriesName = null;
    $('.info2 tr, .info-table tr').each((i, row) => {
        const label = $(row).find('td:first-child, th').text().trim().toLowerCase();
        const value = $(row).find('td:last-child').text().trim();
        if (label.includes('durasi')) duration = value;
        if (label.includes('studio')) studio = value;
        if (label.includes('musim') || label.includes('rilis')) season = value;
        if (label.includes('type') || label.includes('tipe')) type = value;
        if (label.includes('credit')) credit = value;
        if (label.includes('judul alternatif')) alternativeTitle = value;
        if (label.includes('series')) seriesName = value;
    });
    const episodes = [];
    $('.list_eps_stream li, .episode-list li, .eps-list .eps-item').each((idx, el) => {
        const $el = $(el);
        const episodeNum = idx + 1;
        let streamUrls = { '360p': null, '480p': null, '720p': null, '1080p': null };
        const dataAttr = $el.attr('data');
        if (dataAttr) {
            try {
                const decoded = Buffer.from(dataAttr, 'base64').toString();
                const items = JSON.parse(decoded);
                if (Array.isArray(items)) {
                    items.forEach(item => {
                        if (item.format && item.url && item.url[0]) {
                            streamUrls[item.format] = item.url[0];
                        }
                    });
                }
            } catch (e) {}
        }
        const iframeSrc = $el.find('iframe').attr('src');
        if (iframeSrc && !streamUrls['720p']) streamUrls['720p'] = iframeSrc;
        episodes.push({
            episode_number: episodeNum,
            title: `Episode ${episodeNum}`,
            stream_urls: streamUrls
        });
    });
    if (episodes.length === 0) {
        $('a[href*="/episode/"]').each((idx, el) => {
            const epUrl = $(el).attr('href');
            const epMatch = epUrl.match(/\/episode\/(\d+)/);
            const epNum = epMatch ? parseInt(epMatch[1]) : idx + 1;
            episodes.push({
                episode_number: epNum,
                title: $(el).text().trim() || `Episode ${epNum}`,
                stream_urls: { '720p': epUrl }
            });
        });
    }
    return {
        id: slug,
        url: animeUrl,
        title: title || slug,
        slug,
        status,
        poster_url: posterUrl,
        poster_dimensions: { width: null, height: null },
        rating,
        synopsis,
        info: {
            alternative_title: alternativeTitle,
            duration,
            studio,
            genres,
            season,
            type,
            total_episodes: episodes.length,
            subtitle: 'Indonesia',
            credit,
            series_name: seriesName,
            is_complete: status === 'complete'
        },
        episodes,
        created_at: Date.now(),
        updated_at: Date.now()
    };
}

async function fetchNewEpisodes(animeUrl, slug, lastKnownEpisode) {
    const html = await fetchHtml(animeUrl);
    if (!html) return [];
    const $ = cheerio.load(html);
    const newEpisodes = [];
    $('.list_eps_stream li, .episode-list li, .eps-list .eps-item').each((idx, el) => {
        const episodeNum = idx + 1;
        if (episodeNum <= lastKnownEpisode) return;
        const $el = $(el);
        let streamUrls = { '360p': null, '480p': null, '720p': null, '1080p': null };
        const dataAttr = $el.attr('data');
        if (dataAttr) {
            try {
                const decoded = Buffer.from(dataAttr, 'base64').toString();
                const items = JSON.parse(decoded);
                if (Array.isArray(items)) {
                    items.forEach(item => {
                        if (item.format && item.url && item.url[0]) {
                            streamUrls[item.format] = item.url[0];
                        }
                    });
                }
            } catch (e) {}
        }
        const iframeSrc = $el.find('iframe').attr('src');
        if (iframeSrc && !streamUrls['720p']) streamUrls['720p'] = iframeSrc;
        newEpisodes.push({
            episode_number: episodeNum,
            title: `Episode ${episodeNum}`,
            stream_urls: streamUrls
        });
    });
    return newEpisodes;
}

function saveEpisode(animeId, episode) {
    const db = getDatabase();
    const now = Date.now();
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO episodes 
        (anime_id, episode_number, title, stream_urls_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(animeId, episode.episode_number, episode.title, JSON.stringify(episode.stream_urls), now, now);
    const updateCountStmt = db.prepare(`
        UPDATE anime_info 
        SET total_episodes = (SELECT MAX(episode_number) FROM episodes WHERE anime_id = ?),
        updated_at = ?
        WHERE anime_id = ?
    `);
    updateCountStmt.run(animeId, now, animeId);
}

export async function incrementalScrape() {
    const startTime = Date.now();
    console.log('\n🔄 ========== INCREMENTAL SCRAPE START ==========');
    const summary = { newAnime: [], newEpisodes: [], updatedAnime: [], errors: [] };
    
    // 1. Scrape halaman utama (ongoing schedule) dengan fallback
    let ongoingData = null;
    let scheduleError = false;
    
    try {
        const hashNow = await getPageHash(ONGOING_URL);
        if (hashNow !== lastKnownHash) {
            ongoingData = await scrapeOngoingSchedule();
            await saveScheduleToCache(ongoingData);
            lastKnownHash = hashNow;
        } else {
            ongoingData = await loadScheduleFromCache();
        }
    } catch (error) {
        scheduleError = true;
        await notifyAdmin(`Ongoing scrape failed: ${error.message}`);
        ongoingData = await loadScheduleFromCache(); // fallback ke cache
    }
    
    currentOngoingData = ongoingData;
    
    try {
        // 2. Scrape homepage (existing logic)
        const recentAnimeList = await scrapeHomepage();
        if (recentAnimeList.length === 0) return summary;
        
        // 3. Untuk setiap anime di homepage, validasi dengan ongoingData
        for (const item of recentAnimeList) {
            await sleep(REQUEST_DELAY_MS);
            try {
                let existingAnime = getAnimeById(item.animeSlug);
                
                if (!existingAnime) {
                    // Anime baru: fetch detail dan insert (tanpa validasi updated_yes)
                    console.log(`🆕 New anime detected: ${item.title}`);
                    const newAnime = await fetchAnimeDetail(item.animeUrl, item.animeSlug);
                    if (newAnime && newAnime.title) {
                        upsertAnime(newAnime);
                        summary.newAnime.push({ id: newAnime.id, title: newAnime.title });
                        addFeedEvent('NEW_ANIME', newAnime.id, null, `${newAnime.title} added to catalog`);
                        console.log(`   ✅ Added new anime: ${newAnime.title}`);
                    } else {
                        summary.errors.push({ slug: item.animeSlug, reason: 'fetch failed' });
                    }
                } 
                else {
                    const lastEpisodeNumber = existingAnime.episodes.length;
                    const latestFromHomepage = item.latestEpisodeNumber;
                    
                    if (latestFromHomepage > lastEpisodeNumber) {
                        // Episode baru terdeteksi di homepage
                        const isValid = scheduleError ? true : validateEpisodeUpdate(item.animeSlug, latestFromHomepage);
                        
                        if (isValid) {
                            console.log(`🆕 New episode for ${existingAnime.title}: ${lastEpisodeNumber} → ${latestFromHomepage}`);
                            const newEpisodes = await fetchNewEpisodes(item.animeUrl, item.animeSlug, lastEpisodeNumber);
                            for (const ep of newEpisodes) {
                                saveEpisode(existingAnime.id, ep);
                                summary.newEpisodes.push({
                                    animeId: existingAnime.id,
                                    animeTitle: existingAnime.title,
                                    episodeNumber: ep.episode_number,
                                    episodeTitle: ep.title
                                });
                                // Emit WebSocket event for each new episode
                                emitNewEpisode(existingAnime.id, existingAnime.title, ep.episode_number, ep.title);
                                console.log(`   ✅ Emitted NEW_EPISODE for ${existingAnime.title} EP${ep.episode_number}`);
                            }
                            if (newEpisodes.length > 0) summary.updatedAnime.push({ id: existingAnime.id, title: existingAnime.title });
                        } else {
                            console.log(`⚠️ Episode baru untuk ${existingAnime.title} EP${latestFromHomepage} terdeteksi tapi belum divalidasi updated_yes. Ditunda.`);
                        }
                    }
                }
            } catch (err) {
                console.error(`❌ Error processing ${item.animeSlug}:`, err.message);
                summary.errors.push({ slug: item.animeSlug, error: err.message });
            }
        }
        
        // 4. Update info anime jika ada perubahan (hash comparison)
        for (const scheduleItem of ongoingData || []) {
            const anime = getAnimeById(scheduleItem.slug);
            if (anime) {
                // Preserve existing genres if possible
                let genres = anime.info.genres || [];
                if (scheduleItem.genre) {
                    if (!genres.includes(scheduleItem.genre)) {
                        genres = [...genres, scheduleItem.genre];
                    }
                }
                
                const changed = await updateAnimeInfoIfChanged({
                    ...anime,
                    synopsis: scheduleItem.synopsisShort || anime.synopsis,
                    info: {
                        ...anime.info,
                        genres: genres
                    }
                });
                if (changed) {
                    addFeedEvent('ANIME_UPDATED', anime.id, null, `${anime.title} info updated`);
                    console.log(`   ℹ️ Updated info for: ${anime.title}`);
                }
            }
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ Scrape completed in ${duration}s`);
        console.log(`   New anime: ${summary.newAnime.length}`);
        console.log(`   New episodes: ${summary.newEpisodes.length}`);
        console.log(`   Errors: ${summary.errors.length}`);
        console.log('🔄 ========== INCREMENTAL SCRAPE END ==========\n');
        return summary;
    } catch (err) {
        console.error('🔥 Fatal error during incremental scrape:', err);
        summary.errors.push({ fatal: err.message });
        return summary;
    }
}