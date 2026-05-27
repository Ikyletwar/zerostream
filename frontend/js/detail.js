// ============================================
// NIMEGAMI - DETAIL PAGE MODULE (Fase 3)
// Anime info, episode list, video player
// Menggunakan API fetchAnimeById langsung (bukan dari allAnimeList)
// ============================================

let currentAnime = null;
let currentEpisode = null;
let currentResolution = null;
let episodeListContainer = null;
let playerContainer = null;
let resolutionContainer = null;

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const animeId = urlParams.get('id');
    if (!animeId) {
        showError('No anime ID specified');
        return;
    }
    
    episodeListContainer = document.getElementById('episode-list');
    playerContainer = document.getElementById('player-container');
    resolutionContainer = document.getElementById('resolution-buttons');
    
    // 🔥 Langsung fetch detail dari API, jangan gunakan loadAnimeData()
    try {
        showLoadingState();
        currentAnime = await API.fetchAnimeById(animeId);
        if (!currentAnime) throw new Error('No data');
    } catch (error) {
        console.error('Failed to fetch anime detail:', error);
        showError('Anime not found or failed to load');
        return;
    }
    
    document.title = `${currentAnime.title} - ZeroStream`;
    currentResolution = getDefaultQuality();
    
    renderAnimeInfo();
    renderEpisodeList();
    
    // Tentukan episode yang akan dimuat
    const episodeParam = urlParams.get('ep');
    let targetEpisode = 1;
    if (episodeParam && !isNaN(parseInt(episodeParam))) {
        targetEpisode = parseInt(episodeParam);
    } else {
        const lastWatched = getLastWatchedEpisode(animeId);
        if (lastWatched) targetEpisode = lastWatched;
    }
    
    if (currentAnime.episodes && currentAnime.episodes.length >= targetEpisode) {
        loadEpisode(targetEpisode);
    } else if (currentAnime.episodes && currentAnime.episodes.length > 0) {
        loadEpisode(1);
    }
    
    // Episode search
    const episodeSearch = document.getElementById('episode-search');
    if (episodeSearch) {
        episodeSearch.addEventListener('input', (e) => {
            filterEpisodeList(e.target.value);
        });
    }
    
    createSettingsPanel();
    
    // Quality change listener
    window.addEventListener('qualityChanged', (e) => {
        currentResolution = e.detail;
        if (currentEpisode) playCurrentEpisode();
        document.querySelectorAll('.res-btn').forEach(btn => {
            if (btn.textContent === currentResolution) btn.classList.add('active');
            else btn.classList.remove('active');
        });
    });
});

function showLoadingState() {
    const infoContainer = document.getElementById('anime-info');
    if (infoContainer) {
        infoContainer.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-pulse"></i> Loading anime...</div>';
    }
}

function showError(message) {
    const main = document.querySelector('.main-content');
    if (main) {
        main.innerHTML = `<div class="error-state" style="text-align: center; padding: 4rem;">
            <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--error);"></i>
            <p>${escapeHtml(message)}</p>
            <a href="index.html" class="btn-primary" style="margin-top: 1rem;">Back to Home</a>
        </div>`;
    } else {
        document.body.innerHTML = `<div class="error" style="text-align: center; padding: 4rem;">${escapeHtml(message)}</div>`;
    }
}

function renderAnimeInfo() {
    const infoContainer = document.getElementById('anime-info');
    if (!infoContainer) return;
    
    const poster = currentAnime.poster_url || 'https://via.placeholder.com/300x450?text=No+Image';
    const rating = currentAnime.rating ? `<i class="fas fa-star"></i> ${currentAnime.rating}` : 'N/A';
    const status = currentAnime.status === 'ongoing' ? 'Ongoing' : 'Complete';
    const genres = (currentAnime.info?.genres || []).map(g => `<span>${escapeHtml(g)}</span>`).join('');
    const totalEps = currentAnime.info?.total_episodes || currentAnime.episodes?.length || 0;
    
    infoContainer.innerHTML = `
        <div class="detail-poster">
            <img src="${poster}" alt="${escapeHtml(currentAnime.title)}">
        </div>
        <div class="detail-info">
            <h1>${escapeHtml(currentAnime.title)}</h1>
            <div class="detail-meta">
                <span class="status ${currentAnime.status}">${status}</span>
                <span class="rating">${rating}</span>
                <span class="episodes"><i class="fas fa-list"></i> ${totalEps} Episodes</span>
            </div>
            <div class="detail-genres">${genres}</div>
            <p class="synopsis">${escapeHtml(currentAnime.synopsis || 'No synopsis available.')}</p>
            <div class="detail-extra">
                <p><strong>Studio:</strong> ${escapeHtml(currentAnime.info?.studio || '-')}</p>
                <p><strong>Duration:</strong> ${escapeHtml(currentAnime.info?.duration || '-')}</p>
                <p><strong>Season:</strong> ${escapeHtml(currentAnime.info?.season || '-')}</p>
                <p><strong>Type:</strong> ${escapeHtml(currentAnime.info?.type || '-')}</p>
                <p><strong>Credit:</strong> ${escapeHtml(currentAnime.info?.credit || '-')}</p>
            </div>
            <button id="bookmark-btn" class="btn-primary" style="margin-top: 1rem;">
                <i class="fas ${isBookmarked(currentAnime.id) ? 'fa-bookmark' : 'fa-bookmark'}"></i> 
                ${isBookmarked(currentAnime.id) ? ' Bookmarked' : ' Bookmark'}
            </button>
        </div>
    `;
    
    const bookmarkBtn = document.getElementById('bookmark-btn');
    if (bookmarkBtn) {
        bookmarkBtn.addEventListener('click', () => {
            const isNowBookmarked = toggleBookmark(currentAnime.id, currentAnime.title);
            bookmarkBtn.innerHTML = `<i class="fas ${isNowBookmarked ? 'fa-bookmark' : 'fa-bookmark'}"></i> ${isNowBookmarked ? ' Bookmarked' : ' Bookmark'}`;
        });
    }
}

function renderEpisodeList() {
    if (!episodeListContainer) return;
    episodeListContainer.innerHTML = '';
    
    if (!currentAnime.episodes || currentAnime.episodes.length === 0) {
        episodeListContainer.innerHTML = '<div class="no-episodes"><i class="fas fa-info-circle"></i> No episodes available.</div>';
        return;
    }
    
    currentAnime.episodes.forEach((ep, idx) => {
        const epNum = ep.episode_number || idx + 1;
        const epTitle = ep.title || `Episode ${epNum}`;
        const epItem = document.createElement('div');
        epItem.className = 'episode-item';
        epItem.dataset.epNum = epNum;
        epItem.innerHTML = `
            <span class="ep-num"><i class="fas fa-play-circle"></i> Episode ${epNum}</span>
            <span class="ep-title">${escapeHtml(epTitle)}</span>
        `;
        epItem.addEventListener('click', () => loadEpisode(epNum));
        episodeListContainer.appendChild(epItem);
    });
}

function filterEpisodeList(query) {
    const items = document.querySelectorAll('.episode-item');
    const lowerQuery = query.toLowerCase();
    items.forEach(item => {
        const title = item.querySelector('.ep-title')?.textContent.toLowerCase() || '';
        const epNum = item.dataset.epNum;
        if (title.includes(lowerQuery) || epNum.includes(lowerQuery)) {
            item.style.display = '';
        } else {
            item.style.display = 'none';
        }
    });
}

function loadEpisode(episodeNumber) {
    const episode = currentAnime.episodes.find(ep => (ep.episode_number || 0) === episodeNumber);
    if (!episode) {
        showToast('Episode not found', 'error');
        return;
    }
    
    currentEpisode = episode;
    
    // Highlight active episode
    document.querySelectorAll('.episode-item').forEach(item => {
        item.classList.remove('active');
        if (item.dataset.epNum == episodeNumber) {
            item.classList.add('active');
        }
    });
    
    const streamUrls = episode.stream_urls || {};
    const availableResolutions = ['360p', '480p', '720p', '1080p'].filter(res => streamUrls[res]);
    
    if (availableResolutions.length === 0) {
        playerContainer.innerHTML = '<div class="error"><i class="fas fa-exclamation-triangle"></i> No streaming URL available for this episode.</div>';
        return;
    }
    
    if (resolutionContainer) {
        resolutionContainer.innerHTML = '';
        availableResolutions.forEach(res => {
            const btn = document.createElement('button');
            btn.textContent = res;
            btn.className = `res-btn ${currentResolution === res ? 'active' : ''}`;
            btn.addEventListener('click', () => {
                currentResolution = res;
                playCurrentEpisode();
                document.querySelectorAll('.res-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
            resolutionContainer.appendChild(btn);
        });
    }
    
    if (!availableResolutions.includes(currentResolution)) {
        currentResolution = availableResolutions[0];
    }
    
    playCurrentEpisode();
    addToHistory(currentAnime.id, episodeNumber, currentAnime.title, episode.title);
}

function playCurrentEpisode() {
    if (!currentEpisode) return;
    const streamUrl = currentEpisode.stream_urls?.[currentResolution];
    if (!streamUrl) {
        playerContainer.innerHTML = `<div class="error"><i class="fas fa-exclamation-triangle"></i> No stream available for ${currentResolution}.</div>`;
        return;
    }
    
    let playerHtml = '';
    if (streamUrl.includes('streaming.php') || streamUrl.includes('halahgan.com') || streamUrl.includes('stordl.halahgan.com') || streamUrl.includes('embed')) {
        playerHtml = `<iframe src="${streamUrl}" 
            frameborder="0" 
            allowfullscreen 
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin"
            sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-popups-to-escape-sandbox"
            class="video-iframe"></iframe>`;
    } else if (streamUrl.endsWith('.mp4') || streamUrl.includes('.m3u8')) {
        playerHtml = `<video controls autoplay class="video-player" src="${streamUrl}">Your browser does not support video.</video>`;
    } else {
        playerHtml = `<iframe src="${streamUrl}" frameborder="0" allowfullscreen class="video-iframe"></iframe>`;
    }
    
    playerContainer.innerHTML = playerHtml;
}