// repair-json.js
const fs = require('fs');
const readline = require('readline');

const INPUT_FILE = 'anime_nimegami.json';
const OUTPUT_FILE = 'anime_nimegami_repaired.json';

async function repairJson() {
    console.log('🔧 Memperbaiki file JSON...');

    const rl = readline.createInterface({
        input: fs.createReadStream(INPUT_FILE),
        crlfDelay: Infinity
    });

    let buffer = '';
    let isValid = false;
    let lineCount = 0;

    // Baca semua line, gabungkan, lalu coba parse
    for await (const line of rl) {
        buffer += line + '\n';
        lineCount++;
        if (lineCount % 10000 === 0) {
            console.log(`   Membaca baris ${lineCount}...`);
        }
    }

    console.log(`📄 Total baris: ${lineCount}`);

    // Coba hapus karakter non-printable (termasuk null, control chars)
    let cleaned = buffer.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

    // Coba perbaiki trailing comma sebelum closing bracket/brace
    cleaned = cleaned.replace(/,\s*\}/g, '}');
    cleaned = cleaned.replace(/,\s*\]/g, ']');

    // Coba parse
    try {
        const parsed = JSON.parse(cleaned);
        console.log('✅ JSON valid!');
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(parsed, null, 2));
        console.log(`📁 Disimpan ke ${OUTPUT_FILE}`);
        return;
    } catch (err) {
        console.error('❌ Gagal parse setelah pembersihan:', err.message);
        // Lanjutkan dengan pendekatan manual
    }

    // Pendekatan manual: cari token "{" dan "}" untuk ekstrak objek utama
    console.log('🔍 Mencoba ekstraksi manual...');
    let depth = 0;
    let inString = false;
    let escape = false;
    let startObj = -1;
    let endObj = -1;

    for (let i = 0; i < cleaned.length; i++) {
        const ch = cleaned[i];
        if (escape) {
            escape = false;
            continue;
        }
        if (ch === '\\' && inString) {
            escape = true;
            continue;
        }
        if (ch === '"' && !escape) {
            inString = !inString;
        }
        if (!inString) {
            if (ch === '{') {
                if (depth === 0) startObj = i;
                depth++;
            } else if (ch === '}') {
                depth--;
                if (depth === 0) {
                    endObj = i;
                    break;
                }
            }
        }
    }

    if (startObj !== -1 && endObj !== -1) {
        const jsonText = cleaned.substring(startObj, endObj + 1);
        try {
            const parsed = JSON.parse(jsonText);
            console.log('✅ Berhasil ekstrak JSON manual!');
            fs.writeFileSync(OUTPUT_FILE, JSON.stringify(parsed, null, 2));
            console.log(`📁 Disimpan ke ${OUTPUT_FILE}`);
        } catch (err) {
            console.error('❌ Gagal parse hasil ekstraksi manual:', err.message);
            console.log('💡 Saran: cek baris terakhir file dengan editor teks (mungkin terpotong).');
        }
    } else {
        console.log('❌ Tidak menemukan objek JSON yang valid.');
    }
}

repairJson().catch(console.error);