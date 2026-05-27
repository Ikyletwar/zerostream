// backend/database.js
// SQLite database layer - Complete for Fase 3

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'nimegami.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

let dbInstance = null;

export function getDatabase() {
    if (!dbInstance) {
        dbInstance = new DatabaseSync(DB_PATH);
        dbInstance.exec('PRAGMA journal_mode = WAL;');
        dbInstance.exec('PRAGMA synchronous = NORMAL;');
        dbInstance.exec('PRAGMA cache_size = 10000;');
        dbInstance.exec('PRAGMA foreign_keys = ON;');
        initializeSchema(dbInstance);
    }
    return dbInstance;
}

function initializeSchema(db) {
    // Tabel anime (punya updated_at)
    db.exec(`
        CREATE TABLE IF NOT EXISTS anime (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            slug TEXT UNIQUE,
            url TEXT,
            status TEXT CHECK(status IN ('ongoing', 'complete')),
            poster_url TEXT,
            rating REAL,
            synopsis TEXT,
            created_at INTEGER,
            updated_at INTEGER
        )
    `);
    // Tabel anime_info (tanpa updated_at)
    db.exec(`
        CREATE TABLE IF NOT EXISTS anime_info (
            anime_id TEXT PRIMARY KEY,
            alternative_title TEXT,
            duration TEXT,
            studio TEXT,
            season TEXT,
            type TEXT,
            total_episodes INTEGER DEFAULT 0,
            subtitle TEXT,
            credit TEXT,
            series_name TEXT,
            FOREIGN KEY(anime_id) REFERENCES anime(id) ON DELETE CASCADE
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS episodes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            anime_id TEXT NOT NULL,
            episode_number INTEGER NOT NULL,
            title TEXT,
            stream_urls_json TEXT NOT NULL,
            created_at INTEGER,
            updated_at INTEGER,
            UNIQUE(anime_id, episode_number),
            FOREIGN KEY(anime_id) REFERENCES anime(id) ON DELETE CASCADE
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS anime_genres (
            anime_id TEXT NOT NULL,
            genre TEXT NOT NULL,
            PRIMARY KEY(anime_id, genre),
            FOREIGN KEY(anime_id) REFERENCES anime(id) ON DELETE CASCADE
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            applied_at INTEGER NOT NULL
        )
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS feed_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            anime_id TEXT,
            episode_number INTEGER,
            message TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_feed_events_created_at ON feed_events(created_at DESC)`);
    
    const migration = db.prepare("SELECT 1 FROM migrations WHERE name = 'v3_feed_events'").get();
    if (!migration) {
        db.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run('v3_feed_events', Date.now());
    }
}

// ========== FUNGSI UNTUK ANIME ==========

export function upsertAnime(anime) {
    const db = getDatabase();
    const now = Date.now();
    // Upsert ke tabel anime
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO anime 
        (id, title, slug, url, status, poster_url, rating, synopsis, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, ?), ?)
    `);
    stmt.run(
        anime.id,
        anime.title,
        anime.slug || anime.id,
        anime.url,
        anime.status,
        anime.poster_url,
        anime.rating || null,
        anime.synopsis || '',
        anime.created_at || now,
        now
    );
    // Upsert ke anime_info (tanpa updated_at)
    const infoStmt = db.prepare(`
        INSERT OR REPLACE INTO anime_info 
        (anime_id, alternative_title, duration, studio, season, type, total_episodes, subtitle, credit, series_name)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    infoStmt.run(
        anime.id,
        anime.info?.alternative_title || null,
        anime.info?.duration || null,
        anime.info?.studio || null,
        anime.info?.season || null,
        anime.info?.type || null,
        anime.info?.total_episodes || 0,
        anime.info?.subtitle || 'Indonesia',
        anime.info?.credit || null,
        anime.info?.series_name || null
    );
    // Update genres
    db.prepare("DELETE FROM anime_genres WHERE anime_id = ?").run(anime.id);
    if (anime.info?.genres && Array.isArray(anime.info.genres)) {
        const genreStmt = db.prepare("INSERT INTO anime_genres (anime_id, genre) VALUES (?, ?)");
        for (const genre of anime.info.genres) {
            genreStmt.run(anime.id, genre);
        }
    }
    return anime;
}

export function getAnimeById(id) {
    const db = getDatabase();
    const row = db.prepare(`
        SELECT a.*, 
               ai.alternative_title, ai.duration, ai.studio, ai.season, ai.type, 
               ai.total_episodes, ai.subtitle, ai.credit, ai.series_name
        FROM anime a
        LEFT JOIN anime_info ai ON a.id = ai.anime_id
        WHERE a.id = ?
    `).get(id);
    if (!row) return null;
    const genres = db.prepare("SELECT genre FROM anime_genres WHERE anime_id = ?").all(id).map(r => r.genre);
    const episodes = getEpisodesByAnimeId(id);
    return {
        id: row.id,
        url: row.url,
        title: row.title,
        slug: row.slug,
        status: row.status,
        poster_url: row.poster_url,
        poster_dimensions: { width: null, height: null },
        rating: row.rating,
        synopsis: row.synopsis,
        info: {
            alternative_title: row.alternative_title,
            duration: row.duration,
            studio: row.studio,
            genres,
            season: row.season,
            type: row.type,
            total_episodes: row.total_episodes,
            subtitle: row.subtitle,
            credit: row.credit,
            series_name: row.series_name,
            is_complete: row.status === 'complete'
        },
        episodes,
        created_at: row.created_at,
        updated_at: row.updated_at
    };
}

export function getAllAnime({ page = 1, limit = 50, genre = null, status = null, search = null, sort = 'title', order = 'asc' } = {}) {
    const db = getDatabase();
    let sql = `
        SELECT DISTINCT a.id, a.title, a.status, a.poster_url, a.rating, a.synopsis,
               ai.total_episodes, ai.studio, ai.series_name,
               (SELECT GROUP_CONCAT(genre, ',') FROM anime_genres WHERE anime_id = a.id) as genres_csv
        FROM anime a
        LEFT JOIN anime_info ai ON a.id = ai.anime_id
    `;
    const params = [];
    const conditions = [];
    if (genre && genre !== 'all') {
        conditions.push(`a.id IN (SELECT anime_id FROM anime_genres WHERE genre = ?)`);
        params.push(genre);
    }
    if (status && status !== 'all') {
        conditions.push(`a.status = ?`);
        params.push(status);
    }
    if (search && search.trim()) {
        conditions.push(`(a.title LIKE ? OR ai.alternative_title LIKE ?)`);
        const pat = `%${search.trim()}%`;
        params.push(pat, pat);
    }
    if (conditions.length) sql += ` WHERE ${conditions.join(' AND ')}`;
    switch (sort) {
        case 'rating': sql += ` ORDER BY a.rating DESC NULLS LAST`; break;
        case 'title-asc': sql += ` ORDER BY a.title ASC`; break;
        case 'title-desc': sql += ` ORDER BY a.title DESC`; break;
        default: sql += ` ORDER BY a.title ASC`;
    }
    const offset = (page - 1) * limit;
    const countParams = [...params];
    params.push(limit, offset);
    let countSql = `SELECT COUNT(DISTINCT a.id) as total FROM anime a LEFT JOIN anime_info ai ON a.id = ai.anime_id`;
    if (conditions.length) countSql += ` WHERE ${conditions.join(' AND ')}`;
    const { total } = db.prepare(countSql).get(...countParams);
    const rows = db.prepare(sql).all(...params);
    const data = rows.map(row => ({
        id: row.id,
        title: row.title,
        status: row.status,
        poster_url: row.poster_url,
        rating: row.rating,
        synopsis: row.synopsis,
        info: {
            total_episodes: row.total_episodes,
            studio: row.studio,
            series_name: row.series_name,
            genres: row.genres_csv ? row.genres_csv.split(',') : []
        }
    }));
    return {
        data,
        pagination: {
            current_page: page,
            per_page: limit,
            total_items: total,
            total_pages: Math.ceil(total / limit),
            has_next: page < Math.ceil(total / limit),
            has_prev: page > 1
        }
    };
}

export function getAllAnimeNoPagination() {
    const db = getDatabase();
    const rows = db.prepare(`
        SELECT a.id, a.title, a.status, a.poster_url, a.rating, a.synopsis, a.url,
               ai.total_episodes, ai.studio, ai.series_name, ai.alternative_title, ai.duration, ai.season, ai.type, ai.credit,
               (SELECT GROUP_CONCAT(genre, ',') FROM anime_genres WHERE anime_id = a.id) as genres_csv
        FROM anime a
        LEFT JOIN anime_info ai ON a.id = ai.anime_id
        ORDER BY a.title ASC
    `).all();
    return rows.map(row => ({
        id: row.id,
        url: row.url,
        title: row.title,
        status: row.status,
        poster_url: row.poster_url,
        rating: row.rating,
        synopsis: row.synopsis,
        info: {
            alternative_title: row.alternative_title,
            duration: row.duration,
            studio: row.studio,
            season: row.season,
            type: row.type,
            total_episodes: row.total_episodes,
            subtitle: 'Indonesia',
            credit: row.credit,
            series_name: row.series_name,
            genres: row.genres_csv ? row.genres_csv.split(',') : []
        }
    }));
}

export function getAllGenres() {
    const db = getDatabase();
    const rows = db.prepare("SELECT DISTINCT genre FROM anime_genres ORDER BY genre ASC").all();
    return rows.map(r => r.genre);
}

export function getTotalAnimeCount() {
    const db = getDatabase();
    const row = db.prepare("SELECT COUNT(*) as total FROM anime").get();
    return row.total;
}

export function getStats() {
    const db = getDatabase();
    const total = db.prepare("SELECT COUNT(*) as total FROM anime").get().total;
    const ongoing = db.prepare("SELECT COUNT(*) as total FROM anime WHERE status = 'ongoing'").get().total;
    const complete = db.prepare("SELECT COUNT(*) as total FROM anime WHERE status = 'complete'").get().total;
    const epRow = db.prepare("SELECT SUM(total_episodes) as total FROM anime_info").get();
    const totalEpisodes = epRow.total || 0;
    const lastEvent = db.prepare("SELECT created_at FROM feed_events ORDER BY created_at DESC LIMIT 1").get();
    return {
        total_anime: total,
        ongoing_anime: ongoing,
        complete_anime: complete,
        total_episodes: totalEpisodes,
        last_updated: lastEvent ? lastEvent.created_at : null,
        scraped_at: null
    };
}

// ========== FUNGSI UNTUK EPISODE ==========

export function saveEpisode(animeId, episode) {
    const db = getDatabase();
    const now = Date.now();
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO episodes
        (anime_id, episode_number, title, stream_urls_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        animeId,
        episode.episode_number,
        episode.title || `Episode ${episode.episode_number}`,
        JSON.stringify(episode.stream_urls || {}),
        now,
        now
    );
}

export function saveEpisodes(animeId, episodes) {
    for (const ep of episodes) {
        saveEpisode(animeId, ep);
    }
    // Update total_episodes di anime_info
    const db = getDatabase();
    const maxEp = db.prepare("SELECT MAX(episode_number) as max FROM episodes WHERE anime_id = ?").get(animeId);
    if (maxEp && maxEp.max) {
        db.prepare("UPDATE anime_info SET total_episodes = ? WHERE anime_id = ?").run(maxEp.max, animeId);
    }
}

export function getEpisodesByAnimeId(animeId) {
    const db = getDatabase();
    const rows = db.prepare(`
        SELECT episode_number, title, stream_urls_json
        FROM episodes
        WHERE anime_id = ?
        ORDER BY episode_number ASC
    `).all(animeId);
    return rows.map(row => ({
        episode_number: row.episode_number,
        title: row.title,
        stream_urls: JSON.parse(row.stream_urls_json)
    }));
}

// ========== FUNGSI UNTUK CAROUSEL DAN LIVE FEED ==========

export function getLatestEpisodes(limit = 10) {
    const db = getDatabase();
    return db.prepare(`
        SELECT e.anime_id, a.title as anime_title, a.poster_url,
               e.episode_number, e.title as episode_title, e.created_at
        FROM episodes e
        JOIN anime a ON a.id = e.anime_id
        ORDER BY e.created_at DESC
        LIMIT ?
    `).all(limit);
}

export function getRecentlyUpdatedAnime(limit = 10) {
    const db = getDatabase();
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return db.prepare(`
        SELECT DISTINCT a.id, a.title, a.slug, a.status, a.poster_url, a.rating,
               ai.total_episodes, MAX(e.created_at) as last_episode_at
        FROM anime a
        JOIN episodes e ON e.anime_id = a.id
        LEFT JOIN anime_info ai ON ai.anime_id = a.id
        WHERE e.created_at > ?
        GROUP BY a.id
        ORDER BY last_episode_at DESC
        LIMIT ?
    `).all(oneDayAgo, limit);
}

export function getNewReleases(limit = 10) {
    const db = getDatabase();
    return db.prepare(`
        SELECT a.id, a.title, a.slug, a.status, a.poster_url, a.rating, a.created_at,
               ai.total_episodes
        FROM anime a
        LEFT JOIN anime_info ai ON ai.anime_id = a.id
        ORDER BY a.created_at DESC
        LIMIT ?
    `).all(limit);
}

export function addFeedEvent(eventType, animeId, episodeNumber, message) {
    const db = getDatabase();
    db.prepare(`
        INSERT INTO feed_events (event_type, anime_id, episode_number, message, created_at)
        VALUES (?, ?, ?, ?, ?)
    `).run(eventType, animeId, episodeNumber || null, message, Date.now());
}

export function getFeedEvents(limit = 50) {
    const db = getDatabase();
    return db.prepare(`
        SELECT id, event_type, anime_id, episode_number, message, created_at
        FROM feed_events
        ORDER BY created_at DESC
        LIMIT ?
    `).all(limit);
}

export function closeDatabase() {
    if (dbInstance) dbInstance.close();
}