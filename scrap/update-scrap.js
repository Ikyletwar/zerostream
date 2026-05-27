// update-anime-details.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs/promises');
const path = require('path');

const INPUT_FILE = 'anime_nimegami_repaired.json';
const OUTPUT_FILE = 'anime_nimegami_updated.json';
const CHECKPOINT_UPDATE = 'checkpoint_update.json';
const CONCURRENCY = 20;
const BASE_URL = 'https://nimegami.id';

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml'
};

async function fetchHtml(url) {
    try {
        const res = await axios.get(url, { timeout: 10000, headers: HEADERS });
        return res.data;
    } catch (e) {
        console.error(`❌ Gagal fetch ${url}: ${e.message}`);
        return null;
    }
}

// Parse detail info tambahan dari halaman detail menggunakan regex
function parseAdditionalInfo(html) {
    const $ = cheerio.load(html);

    // Ambil seluruh teks dari area info2 atau dari body
    let infoText = '';
    $('.info2, .single .info2, .single .info').each((i, el) => {
        infoText += $(el).text();
    });
    // Jika tidak ketemu, cari dari body
    if (!infoText) infoText = $('body').text();

    // Helper extract menggunakan regex
    function extract(label) {
        // Pola: "label : nilai" atau "label : | nilai"
        const regex = new RegExp(`${label}\\s*:\\s*\\|?\\s*([^\\n,]+)`, 'i');
        const match = infoText.match(regex);
        return match ? match[1].trim() : null;
    }

    const duration = extract('Durasi Per Episode');
    const studio = extract('Studio');
    const season = extract('Musim / Rilis');
    const type = extract('Type');
    const credit = extract('Credit');

    // Alternatif: cari dari tabel .info2 tr jika ada struktur tabel
    if (!duration) {
        const durRow = $('.info2 tr:contains("Durasi Per Episode")');
        if (durRow.length) {
            return {
                duration: durRow.find('td').last().text().trim(),
                studio: $('.info2 tr:contains("Studio")').find('td').last().text().trim(),
                season: $('.info2 tr:contains("Musim / Rilis")').find('td').last().text().trim(),
                type: $('.info2 tr:contains("Type")').find('td').last().text().trim(),
                credit: $('.info2 tr:contains("Credit")').find('td').last().text().trim()
            };
        }
    }

    return { duration, studio, season, type, credit };
}

async function updateAnimeDetails() {
    console.log('📂 Membaca data existing...');
    const rawData = await fs.readFile(INPUT_FILE, 'utf-8');
    const data = JSON.parse(rawData);
    const animeList = data.anime_list;
    console.log(`📊 Total anime: ${animeList.length}`);

    // Load checkpoint update
    let checkpoint = {};
    try {
        const checkpointRaw = await fs.readFile(CHECKPOINT_UPDATE, 'utf-8');
        checkpoint = JSON.parse(checkpointRaw);
    } catch (e) { }
    const processedUrls = new Set(checkpoint.processed_urls || []);

    // Filter anime yang perlu diupdate: yang memiliki info null atau kosong untuk field tertentu
    const toUpdate = animeList.filter(anime => {
        return !processedUrls.has(anime.url) && (
            !anime.info.duration ||
            !anime.info.studio ||
            !anime.info.season ||
            !anime.info.type ||
            !anime.info.credit
        );
    });

    console.log(`🔄 Anime perlu update info: ${toUpdate.length}`);

    if (toUpdate.length === 0) {
        console.log('✅ Semua data sudah lengkap!');
        return;
    }

    let updatedCount = 0;
    let failedCount = 0;
    const queue = [...toUpdate];
    const running = new Set();

    while (queue.length > 0 || running.size > 0) {
        while (running.size < CONCURRENCY && queue.length > 0) {
            const anime = queue.shift();
            const promise = (async () => {
                console.log(`🔄 Update: ${anime.title}`);
                const html = await fetchHtml(anime.url);
                if (html) {
                    const extra = parseAdditionalInfo(html);
                    // Update hanya jika ada data baru
                    if (extra.duration) anime.info.duration = extra.duration;
                    if (extra.studio) anime.info.studio = extra.studio;
                    if (extra.season) anime.info.season = extra.season;
                    if (extra.type) anime.info.type = extra.type;
                    if (extra.credit) anime.info.credit = extra.credit;
                    updatedCount++;
                    console.log(`   ✅ ${anime.title} -> Durasi: ${extra.duration || '-'}, Studio: ${extra.studio || '-'}`);
                } else {
                    failedCount++;
                    console.log(`   ❌ Gagal fetch ${anime.title}`);
                }
                processedUrls.add(anime.url);
                // Simpan checkpoint setiap 10 update
                if (processedUrls.size % 10 === 0) {
                    await fs.writeFile(CHECKPOINT_UPDATE, JSON.stringify({ processed_urls: Array.from(processedUrls) }, null, 2));
                }
                running.delete(promise);
            })();
            running.add(promise);
        }
        if (running.size > 0) await Promise.race(running);
    }

    // Simpan data final
    data.anime_list = animeList;
    data.metadata.last_updated = new Date().toISOString();
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2));
    console.log(`\n🎉 Update selesai! Berhasil: ${updatedCount}, Gagal: ${failedCount}`);
    console.log(`📁 Data disimpan di: ${OUTPUT_FILE}`);
}

updateAnimeDetails().catch(console.error);