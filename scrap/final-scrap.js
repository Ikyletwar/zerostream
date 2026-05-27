// adaptive-scraper.js
const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs/promises');

const INPUT_FILE = 'anime_nimegami_updated.json';
const OUTPUT_FILE = 'anime_nimegami_adaptive.json';
const CHECKPOINT_FILE = 'adaptive_checkpoint.json';

// Konfigurasi adaptif
let CONCURRENCY = 30;
let successCount = 0;
let failCount = 0;
let consecutiveFails = 0;
let lastError = null;

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept': 'text/html,application/xhtml+xml'
};

// Adaptive delay (semakin banyak error, delay bertambah)
async function adaptiveDelay() {
    if (consecutiveFails > 5) {
        const delay = Math.min(5000, 500 * consecutiveFails);
        console.log(`⚠️ High error rate, delaying ${delay}ms`);
        await new Promise(r => setTimeout(r, delay));
    }
}

// Fetch dengan adaptive retry
async function fetchHtml(url, retries = 2) {
    for (let i = 0; i < retries; i++) {
        try {
            const res = await axios.get(url, { timeout: 15000, headers: HEADERS });
            consecutiveFails = 0;
            return res.data;
        } catch (e) {
            consecutiveFails++;
            if (i === retries - 1) {
                lastError = e.message;
                return null;
            }
            await adaptiveDelay();
        }
    }
}

// ========== MULTI-PARSER ==========
// Strategy 1: Tabel dengan label mapping dinamis
function parseTableStrategy($) {
    const info = {};
    const labelAliases = {
        'durasi per episode': 'duration',
        'durasi': 'duration',
        'studio': 'studio',
        'musim / rilis': 'season',
        'musim': 'season',
        'rilis': 'season',
        'type': 'type',
        'tipe': 'type',
        'credit': 'credit',
        'kredit': 'credit',
        'judul alternatif': 'alternative_title',
        'judul lain': 'alternative_title',
        'series': 'series_name',
        'rating': 'rating',
        'subtitle': 'subtitle'
    };

    $('tr').each((i, row) => {
        const labelCell = $(row).find('td:first-child, th:first-child');
        let rawLabel = labelCell.text().trim().toLowerCase().replace(/[：:]/g, '');

        for (const [alias, field] of Object.entries(labelAliases)) {
            if (rawLabel.includes(alias)) {
                let value = $(row).find('td:last-child').text().trim();
                value = value.replace(/\[[^\]]*\]/g, '').replace(/https?:\/\/[^\s]+/g, '').trim();
                if (field === 'rating') {
                    const match = value.match(/(\d+\.?\d*)/);
                    if (match) info.rating = parseFloat(match[0]);
                } else {
                    info[field] = value || null;
                }
                break;
            }
        }
    });
    return info;
}

// Strategy 2: Div .info2 dengan regex cerdas
function parseInfo2Strategy($) {
    const info = {};
    const info2Text = $('.info2, .single .info, .post-info').text();
    if (!info2Text) return info;

    const patterns = {
        duration: /Durasi Per Episode\s*:\s*([^,\n]+)/i,
        studio: /Studio\s*:\s*([^,\n]+)/i,
        season: /Musim\s*\/\s*Rilis\s*:\s*([^,\n]+)/i,
        type: /Type\s*:\s*([^,\n]+)/i,
        credit: /Credit\s*:\s*([^,\n]+)/i,
        alternative_title: /Judul Alternatif\s*:\s*([^,\n]+)/i,
        series_name: /Series\s*:\s*([^,\n]+)/i,
        rating: /Rating\s*:\s*(\d+\.?\d*)/i,
        subtitle: /Subtitle\s*:\s*([^,\n]+)/i
    };

    for (const [field, regex] of Object.entries(patterns)) {
        const match = info2Text.match(regex);
        if (match && match[1]) {
            info[field] = match[1].trim();
            if (field === 'rating') info[field] = parseFloat(info[field]);
        }
    }
    return info;
}

// Strategy 3: Metadata from meta tags
function parseMetaStrategy($) {
    const info = {};
    const widthMeta = $('meta[itemprop="width"]').attr('content');
    const heightMeta = $('meta[itemprop="height"]').attr('content');
    if (widthMeta) info.poster_width = parseInt(widthMeta);
    if (heightMeta) info.poster_height = parseInt(heightMeta);

    const ratingMeta = $('meta[itemprop="ratingValue"]').attr('content');
    if (ratingMeta) info.rating = parseFloat(ratingMeta);

    return info;
}

// Strategy 4: Fallback - cari di seluruh body teks
function parseBodyFallback($) {
    const info = {};
    const bodyText = $('body').text();

    // Cari pola umum seperti "23 min per ep", "Studio: X", dll
    const durationMatch = bodyText.match(/(\d+)\s*(?:min|menit)/i);
    if (durationMatch) info.duration = durationMatch[0];

    const studioMatch = bodyText.match(/Studio\s*:\s*([^\n]+)/i);
    if (studioMatch) info.studio = studioMatch[1].trim();

    return info;
}

// Main parser yang menggabungkan semua strategi
function extractAllInfo(html, currentAnime = null) {
    const $ = cheerio.load(html);
    let info = {};

    // Jalankan semua strategi secara berurutan
    const strategies = [parseTableStrategy, parseInfo2Strategy, parseMetaStrategy, parseBodyFallback];

    for (const strategy of strategies) {
        const result = strategy($);
        info = { ...info, ...result };
    }

    // Bersihkan nilai: hapus "Menit" ganda, "per ep", dll
    if (info.duration) {
        info.duration = info.duration.replace(/menit\s+menit/i, 'menit').trim();
    }

    // Jika series_name masih kosong, gunakan judul tanpa season info
    if ((!info.series_name || info.series_name === '-') && currentAnime) {
        let seriesName = currentAnime.title.replace(/\s*Sub Indo.*$/i, '');
        seriesName = seriesName.replace(/\s*:.*?(?:Season|Part|\d+).*$/i, '');
        seriesName = seriesName.replace(/\s*[–\-].*$/, '');
        info.series_name = seriesName.trim();
    }

    return info;
}

// Adaptive concurrency adjustment
function adjustConcurrency() {
    if (consecutiveFails > 10 && CONCURRENCY > 5) {
        CONCURRENCY = Math.max(5, CONCURRENCY - 5);
        console.log(`📉 Reducing concurrency to ${CONCURRENCY} due to errors`);
    } else if (successCount > 50 && consecutiveFails === 0 && CONCURRENCY < 30) {
        CONCURRENCY = Math.min(30, CONCURRENCY + 5);
        console.log(`📈 Increasing concurrency to ${CONCURRENCY}`);
    }
}

async function main() {
    console.log('🚀 ADAPTIVE SCRAPER STARTED');
    console.log(`Initial concurrency: ${CONCURRENCY}`);

    // Load data
    let data;
    try {
        const raw = await fs.readFile(INPUT_FILE, 'utf8');
        data = JSON.parse(raw);
    } catch (e) {
        console.error('❌ Cannot read input file:', e.message);
        return;
    }

    const animeList = data.anime_list;
    console.log(`📊 Total anime: ${animeList.length}`);

    // Load checkpoint
    let checkpoint = { processed: [] };
    try {
        const cpRaw = await fs.readFile(CHECKPOINT_FILE, 'utf8');
        checkpoint = JSON.parse(cpRaw);
    } catch (e) { }

    const processedSet = new Set(checkpoint.processed);
    const toProcess = animeList.filter(a => !processedSet.has(a.id));
    console.log(`🔄 To process: ${toProcess.length}`);

    let success = 0, fail = 0, totalProcessed = 0;
    const total = toProcess.length;

    // Process with adaptive concurrency
    let index = 0;
    while (index < toProcess.length) {
        const batch = toProcess.slice(index, index + CONCURRENCY);
        const promises = batch.map(async (anime) => {
            console.log(`🔍 [${processedSet.size + success + fail + 1}/${animeList.length}] ${anime.title}`);
            const html = await fetchHtml(anime.url);
            if (html) {
                const extra = extractAllInfo(html, anime);

                // Update fields
                if (extra.duration && extra.duration !== '-') anime.info.duration = extra.duration;
                if (extra.studio && extra.studio !== '-') anime.info.studio = extra.studio;
                if (extra.season && extra.season !== '-') anime.info.season = extra.season;
                if (extra.type && extra.type !== '-') anime.info.type = extra.type;
                if (extra.credit && extra.credit !== '-') anime.info.credit = extra.credit;
                if (extra.alternative_title) anime.info.alternative_title = extra.alternative_title;
                if (extra.series_name) anime.info.series_name = extra.series_name;
                if (extra.rating) anime.rating = extra.rating;
                if (extra.subtitle) anime.info.subtitle = extra.subtitle;
                if (extra.poster_width) anime.poster_dimensions.width = extra.poster_width;
                if (extra.poster_height) anime.poster_dimensions.height = extra.poster_height;

                success++;
                console.log(`   ✅ Studio: ${extra.studio || '-'} | Durasi: ${extra.duration || '-'}`);
            } else {
                fail++;
                console.log(`   ❌ Failed: ${lastError || 'timeout'}`);
            }
            processedSet.add(anime.id);
            totalProcessed++;
            adjustConcurrency();
        });

        await Promise.all(promises);

        // Save checkpoint and data
        await fs.writeFile(CHECKPOINT_FILE, JSON.stringify({
            processed: Array.from(processedSet),
            last_index: index + batch.length,
            concurrency: CONCURRENCY
        }));

        data.metadata.last_updated = new Date().toISOString();
        await fs.writeFile(OUTPUT_FILE, JSON.stringify(data, null, 2));

        index += batch.length;
        console.log(`💾 Progress: ${index}/${total} | Success: ${success} | Fail: ${fail} | Concurrency: ${CONCURRENCY}`);

        // Adaptive delay between batches if error rate high
        if (fail > success && fail > 10) {
            console.log('⚠️ High failure rate, cooling down 3 seconds...');
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    console.log(`\n🎉 FINISHED!`);
    console.log(`✅ Success: ${success}`);
    console.log(`❌ Failed: ${fail}`);
    console.log(`📁 Output: ${OUTPUT_FILE}`);
}

main().catch(console.error);