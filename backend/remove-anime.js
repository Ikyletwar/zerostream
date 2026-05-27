// backend/remove-anime.js
// Hapus anime dari database berdasarkan slug atau URL
// Jalankan: node backend/remove-anime.js

import { getDatabase, getAnimeById, closeDatabase } from './database.js';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

function askQuestion(query) {
    return new Promise(resolve => rl.question(query, resolve));
}

function extractSlugFromUrl(url) {
    const match = url.match(/\.id\/([^\/?#]+)/);
    return match ? match[1] : null;
}

async function findAnime(input) {
    // Coba langsung sebagai slug
    let anime = getAnimeById(input);
    if (anime) return anime;

    // Coba sebagai URL
    const slugFromUrl = extractSlugFromUrl(input);
    if (slugFromUrl) {
        anime = getAnimeById(slugFromUrl);
        if (anime) return anime;
    }

    return null;
}

async function removeAnime(slug) {
    const db = getDatabase();
    // Hapus anime (cascade akan hapus info, genres, episodes, feed events? feed_events tidak punya foreign key ke anime, jadi perlu manual)
    // Hapus feed events yang terkait
    db.prepare("DELETE FROM feed_events WHERE anime_id = ?").run(slug);
    // Hapus anime (cascade ke anime_info, anime_genres, episodes)
    const result = db.prepare("DELETE FROM anime WHERE id = ?").run(slug);
    return result.changes > 0;
}

async function main() {
    console.log(`
╔══════════════════════════════════════════════════╗
║           NIMEGAMI - HAPUS ANIME                ║
╠══════════════════════════════════════════════════╣
║  Masukkan slug atau URL anime yang akan dihapus ║
║  Contoh slug: clannad-sub-indo-1                ║
║  Contoh URL: https://nimegami.id/clannad-sub-indo-1/ ║
║  Kosongkan untuk selesai                        ║
╚══════════════════════════════════════════════════╝
    `);

    let removedCount = 0;
    let notFoundCount = 0;

    while (true) {
        const input = await askQuestion('\n🔍 Masukkan slug atau URL anime (ENTER untuk selesai): ');
        if (!input.trim()) break;

        const anime = await findAnime(input.trim());
        if (!anime) {
            console.log(`❌ Anime tidak ditemukan untuk: ${input}`);
            notFoundCount++;
            continue;
        }

        console.log(`\n📋 Anime yang akan dihapus:`);
        console.log(`   ID: ${anime.id}`);
        console.log(`   Judul: ${anime.title}`);
        console.log(`   Status: ${anime.status}`);
        console.log(`   Total episode: ${anime.episodes?.length || 0}`);
        console.log(`   Genre: ${anime.info.genres.join(', ')}`);

        const confirm = await askQuestion('\n⚠️  Yakin ingin menghapus anime ini? (y/n): ');
        if (confirm.toLowerCase() !== 'y') {
            console.log('Batal.');
            continue;
        }

        const success = await removeAnime(anime.id);
        if (success) {
            console.log(`✅ Anime "${anime.title}" berhasil dihapus.`);
            removedCount++;
        } else {
            console.log(`❌ Gagal menghapus anime "${anime.title}".`);
        }
    }

    console.log(`
╔══════════════════════════════════════════════════╗
║                    RINGKASAN                     ║
╠══════════════════════════════════════════════════╣
║  ✅ Berhasil dihapus: ${removedCount} anime
║  ❌ Tidak ditemukan: ${notFoundCount} anime
╚══════════════════════════════════════════════════╝
    `);

    rl.close();
    closeDatabase();
}

main().catch(err => {
    console.error('Error:', err);
    rl.close();
    process.exit(1);
});