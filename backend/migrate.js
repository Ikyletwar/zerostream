// backend/migrate.js
import { getDatabase, upsertAnime, saveEpisodes, getTotalAnimeCount, closeDatabase } from './database.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JSON_DATA_PATH = path.join(__dirname, '../data/anime_nimegami_adaptive.json');

async function migrate() {
    console.log('🚀 Starting JSON to SQLite migration (with episodes)...');
    if (!fs.existsSync(JSON_DATA_PATH)) {
        console.error(`❌ JSON file not found: ${JSON_DATA_PATH}`);
        process.exit(1);
    }
    let jsonData;
    try {
        const rawData = fs.readFileSync(JSON_DATA_PATH, 'utf8');
        jsonData = JSON.parse(rawData);
        console.log(`✅ Loaded JSON data: ${jsonData.anime_list?.length || 0} anime`);
    } catch (err) {
        console.error('❌ Failed to parse JSON:', err.message);
        process.exit(1);
    }
    const animeList = jsonData.anime_list || [];
    if (animeList.length === 0) {
        console.log('⚠️ No anime data found');
        process.exit(0);
    }
    const db = getDatabase();
    const existingCount = getTotalAnimeCount();
    if (existingCount > 0) {
        console.log(`⚠️ Database already has ${existingCount} anime records. Delete the file to re-migrate.`);
        process.exit(0);
    }
    let successCount = 0, failCount = 0, episodeCount = 0;
    for (let i = 0; i < animeList.length; i++) {
        const anime = animeList[i];
        try {
            if (!anime.id) { failCount++; continue; }
            // Simpan anime (tanpa episode dulu)
            upsertAnime(anime);
            // Simpan episode
            const episodesToSave = (anime.episodes || []).map(ep => ({
                episode_number: ep.episode_number,
                title: ep.title || `Episode ${ep.episode_number}`,
                stream_urls: ep.stream_urls || {}
            }));
            if (episodesToSave.length) {
                saveEpisodes(anime.id, episodesToSave);
                episodeCount += episodesToSave.length;
            }
            successCount++;
            if ((i+1) % 50 === 0) {
                console.log(`📊 Progress: ${i+1}/${animeList.length} (${successCount} success, ${failCount} failed, ${episodeCount} episodes)`);
            }
        } catch (err) {
            console.error(`❌ Failed to migrate anime ${anime.id}: ${err.message}`);
            failCount++;
        }
    }
    console.log(`\n🎉 Migration completed!`);
    console.log(`   ✅ Success: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}`);
    console.log(`   📀 Episodes saved: ${episodeCount}`);
    console.log(`   📁 Database: ${path.join(__dirname, 'data', 'nimegami.db')}`);
    closeDatabase();
}
migrate().catch(console.error);