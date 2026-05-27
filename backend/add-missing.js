// backend/add-missing.js
// Script interaktif untuk menambahkan anime manual dari URL
// Jalankan: node backend/add-missing.js

import axios from 'axios';
import * as cheerio from 'cheerio';
import readline from 'readline';
import { upsertAnime, saveEpisodes, getAnimeById } from './database.js';

const BASE_URL = 'https://nimegami.id';
const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml'
};

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

async function fetchHtml(url) {
    try {
        const response = await axios.get(url, { timeout: 15000, headers: HEADERS });
        return response.data;
    } catch (error) {
        console.error(`❌ Gagal fetch ${url}: ${error.message}`);
        return null;
    }
}

function extractSlug(url) {
    const match = url.match(/\.id\/([^\/?#]+)/);
    return match ? match[1] : null;
}

async function scrapeAnimeDetail(animeUrl) {
    console.log(`🔍 Mengambil data dari ${animeUrl} ...`);
    const html = await fetchHtml(animeUrl);
    if (!html) return null;

    const $ = cheerio.load(html);
    const slug = extractSlug(animeUrl);
    if (!slug) return null;

    // Title
    const title = $('h1.entry-title').first().text().trim();

    // Synopsis
    const synopsis = $('#Sinopsis p').first().text().trim();

    // Poster
    let posterUrl = $('.thumbnail-a img').first().attr('src');
    if (posterUrl && !posterUrl.startsWith('http')) posterUrl = BASE_URL + posterUrl;

    // Rating
    let rating = null;
    const ratingText = $('.info2 tr:contains("Rating") td.ratingx').text();
    const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
    if (ratingMatch) rating = parseFloat(ratingMatch[1]);

    // Status
    let status = 'complete';
    if ($('.term_tag-a a:contains("On-going")').length > 0) status = 'ongoing';

    // Genres
    const genres = [];
    $('.info2 tr:contains("Kategori") td.info_a a, .genres a, .category a').each((i, el) => {
        const genre = $(el).text().trim();
        if (genre && !genres.includes(genre)) genres.push(genre);
    });

    // Additional info
    let duration = null, studio = null, season = null, type = null, credit = null, alternativeTitle = null, seriesName = null;
    $('.info2 tr').each((i, row) => {
        const label = $(row).find('td:first-child').text().trim().toLowerCase();
        let value = $(row).find('td:last-child').text().trim();
        if (label.includes('durasi')) duration = value;
        if (label.includes('studio')) studio = value;
        if (label.includes('musim') || label.includes('rilis')) season = value;
        if (label.includes('type')) type = value;
        if (label.includes('credit')) credit = value;
        if (label.includes('judul alternatif')) alternativeTitle = value;
        if (label.includes('series')) seriesName = value;
    });

    // Episode list
    const episodes = [];
    $('.list_eps_stream li.select-eps, .episode-list li, .eps-list li').each((idx, el) => {
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

        // Jika tidak ada stream URL, cari iframe
        const iframeSrc = $el.find('iframe').attr('src');
        if (iframeSrc && !streamUrls['720p']) streamUrls['720p'] = iframeSrc;

        episodes.push({
            episode_number: episodeNum,
            title: `Episode ${episodeNum}`,
            stream_urls: streamUrls
        });
    });

    // Fallback: cari link episode dari href
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

    const anime = {
        id: slug,
        url: animeUrl,
        title: title || slug,
        slug: slug,
        status: status,
        poster_url: posterUrl,
        poster_dimensions: { width: null, height: null },
        rating: rating,
        synopsis: synopsis,
        info: {
            alternative_title: alternativeTitle,
            duration: duration,
            studio: studio,
            genres: genres,
            season: season,
            type: type,
            total_episodes: episodes.length,
            subtitle: 'Indonesia',
            credit: credit,
            series_name: seriesName || title,
            is_complete: status === 'complete'
        },
        episodes: episodes,
        created_at: Date.now(),
        updated_at: Date.now()
    };

    return anime;
}

async function addAnime() {
    console.log(`
╔══════════════════════════════════════════════════╗
║        NIMEGAMI - TAMBAH ANIME MANUAL           ║
╠══════════════════════════════════════════════════╣
║  Masukkan URL anime dari nimegami.id            ║
║  Contoh: https://nimegami.id/clannad-sub-indo-1/║
║  Kosongkan URL untuk selesai                    ║
╚══════════════════════════════════════════════════╝
    `);

    let addedCount = 0;
    let skipCount = 0;

    while (true) {
        const url = await askQuestion('\n🔗 Masukkan URL anime (atau langsung ENTER untuk selesai): ');
        if (!url.trim()) break;

        let targetUrl = url.trim();
        if (!targetUrl.startsWith('http')) {
            targetUrl = 'https://' + targetUrl;
        }

        const slug = extractSlug(targetUrl);
        if (!slug) {
            console.log('❌ URL tidak valid. Pastikan formatnya seperti: nimegami.id/judul-anime/');
            continue;
        }

        // Cek apakah sudah ada di database
        const existing = getAnimeById(slug);
        if (existing) {
            console.log(`⚠️ Anime "${existing.title}" sudah ada di database. Lewati.`);
            skipCount++;
            continue;
        }

        console.log(`\n📡 Mengambil data dari ${targetUrl}...`);
        const anime = await scrapeAnimeDetail(targetUrl);

        if (!anime) {
            console.log('❌ Gagal mengambil data. Periksa URL atau koneksi.');
            continue;
        }

        // Simpan ke database
        upsertAnime(anime);
        if (anime.episodes.length > 0) {
            saveEpisodes(anime.id, anime.episodes);
        }

        addedCount++;
        console.log(`\n✅ BERHASIL DITAMBAHKAN!`);
        console.log(`   Judul: ${anime.title}`);
        console.log(`   Episode: ${anime.episodes.length}`);
        console.log(`   Status: ${anime.status}`);
        console.log(`   Genre: ${anime.info.genres.join(', ')}`);
    }

    console.log(`
╔══════════════════════════════════════════════════╗
║                    RINGKASAN                     ║
╠══════════════════════════════════════════════════╣
║  ✅ Berhasil ditambahkan: ${addedCount} anime
║  ⏭️  Dilewati (sudah ada): ${skipCount} anime
╚══════════════════════════════════════════════════╝
    `);

    rl.close();
}

// Jalankan
addAnime().catch(err => {
    console.error('Error:', err);
    rl.close();
    process.exit(1);
});