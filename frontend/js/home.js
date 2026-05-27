// ============================================
// NIMEGAMI - HOME PAGE MODULE (Fase 4)
// Anime listing, filtering, sorting, realtime search,
// Carousel sections (New Release, Latest Episode, Recently Updated)
// Live Feed dengan WebSocket updates
// Optimasi: lazy loading, error handling, cache partial
// ============================================

// State
let currentFilteredList = [];
let currentPage = 1;
const ITEMS_PER_PAGE = 24;
let isLoadingMore = false;
let hasMore = true;
let currentSort = 'default';
let currentGenre = 'all';
let currentStatus = 'all';
let searchQuery = '';

// DOM Elements
let animeContainer, loadMoreBtn, paginationContainer, filterGenre, filterStatus, sortSelect, searchInput;
let searchSuggestionsContainer;

// Carousel containers
let newReleaseContainer, latestEpisodeContainer, recentlyUpdatedContainer, liveFeedContainer;

// Lazy loading observer
let imageObserver = null;

// ---------- INITIALIZATION ----------
document.addEventListener('DOMContentLoaded', async () => {
    animeContainer = document.getElementById('anime-container');
    loadMoreBtn = document.getElementById('load-more');
    paginationContainer = document.getElementById('pagination');
    filterGenre = document.getElementById('filter-genre');
    filterStatus = document.getElementById('filter-status');
    sortSelect = document.getElementById('sort-by');
    searchInput = document.getElementById('search-input');
    searchSuggestionsContainer = document.getElementById('search-suggestions');
    
    // Carousel containers
    newReleaseContainer = document.getElementById('new-release-container');
    latestEpisodeContainer = document.getElementById('latest-episode-container');
    recentlyUpdatedContainer = document.getElementById('recently-updated-container');
    liveFeedContainer = document.getElementById('live-feed-list');
    
    // Setup lazy loading observer
    initLazyLoading();
    
    // Setup layout toggle
    const gridBtn = document.getElementById('grid-view-btn');
    const listBtn = document.getElementById('list-view-btn');
    if (gridBtn && listBtn) {
        gridBtn.addEventListener('click', () => setLayoutPreference('grid'));
        listBtn.addEventListener('click', () => setLayoutPreference('list'));
        const layout = getLayoutPreference();
        if (layout === 'grid') gridBtn.classList.add('active');
        else listBtn.classList.add('active');
    }
    
    // Load data utama
    await loadAnimeData();
    if (!allAnimeList.length) {
        animeContainer.innerHTML = '<div class="error"><i class="fas fa-exclamation-triangle"></i> Failed to load anime data. Please check your connection.</div>';
        return;
    }
    
    // Populate genre filter
    const genres = getAllGenres();
    filterGenre.innerHTML = '<option value="all">All Genres</option>' + genres.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    
    // Preset status dari localStorage
    const presetStatus = localStorage.getItem('preset_status');
    if (presetStatus && (presetStatus === 'ongoing' || presetStatus === 'complete')) {
        filterStatus.value = presetStatus;
        currentStatus = presetStatus;
        localStorage.removeItem('preset_status');
    }
    
    // Event listeners
    filterGenre.addEventListener('change', () => {
        currentGenre = filterGenre.value;
        resetAndApplyFilters();
    });
    filterStatus.addEventListener('change', () => {
        currentStatus = filterStatus.value;
        resetAndApplyFilters();
    });
    sortSelect.addEventListener('change', () => {
        currentSort = sortSelect.value;
        resetAndApplyFilters();
    });
    
    // Search dengan debounce
    if (searchInput) {
        const debouncedSearch = debounce(() => {
            searchQuery = searchInput.value.trim();
            resetAndApplyFilters();
        }, 300);
        
        searchInput.addEventListener('input', () => {
            const query = searchInput.value.trim();
            const clearBtn = document.getElementById('search-clear-btn');
            if (clearBtn) {
                clearBtn.style.display = query.length > 0 ? 'flex' : 'none';
            }
            if (query.length > 0) showAutocompleteSuggestions(query);
            else hideSuggestions();
            debouncedSearch();
        });
        
        searchInput.addEventListener('focus', () => {
            const query = searchInput.value.trim();
            if (query.length > 0) {
                showAutocompleteSuggestions(query);
            }
        });
        
        searchInput.addEventListener('blur', () => setTimeout(() => hideSuggestions(), 200));
        
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                hideSuggestions();
                searchInput.blur();
            }
        });
        
        const clearBtn = document.getElementById('search-clear-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                searchInput.value = '';
                clearBtn.style.display = 'none';
                searchQuery = '';
                resetAndApplyFilters();
                hideSuggestions();
                searchInput.focus();
            });
        }
    }
    
    // Layout & pagination mode listeners
    window.addEventListener('layoutChanged', () => renderCurrentPage());
    window.addEventListener('paginationModeChanged', () => resetPaginationAndRender());
    
    // Mobile filter
    document.querySelectorAll('.mobile-filter, .nav-filter').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const status = btn.dataset.status;
            if (status && filterStatus) {
                filterStatus.value = status;
                currentStatus = status;
                resetAndApplyFilters();
                const mobileNav = document.getElementById('mobile-nav');
                if (mobileNav && mobileNav.classList.contains('open')) {
                    mobileNav.classList.remove('open');
                    const hamburger = document.getElementById('hamburger-menu');
                    if (hamburger) hamburger.classList.remove('active');
                }
            }
        });
    });
    
    // Load more button
    if (loadMoreBtn) {
        const btn = loadMoreBtn.querySelector('button');
        if (btn) btn.addEventListener('click', () => {
            if (!isLoadingMore && hasMore) loadMoreBatch();
        });
    }
    
    // Load carousel & live feed
    await loadCarouselSections();
    await loadLiveFeed();
    await loadSchedule();
    
    // WebSocket events
    onRealtimeEvent('NEW_EPISODE', handleNewEpisodeEvent);
    onRealtimeEvent('ANIME_UPDATED', handleAnimeUpdatedEvent);
    
    // Initial render
    applyFiltersAndRender();
});

// ---------- LAZY LOADING (Intersection Observer) ----------
function initLazyLoading() {
    if ('IntersectionObserver' in window) {
        imageObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const img = entry.target;
                    const dataSrc = img.getAttribute('data-src');
                    if (dataSrc) {
                        img.src = dataSrc;
                        img.removeAttribute('data-src');
                        img.classList.add('loaded');
                    }
                    observer.unobserve(img);
                }
            });
        }, { rootMargin: '100px', threshold: 0.01 });
    }
}

function observeImages(container) {
    if (!imageObserver) return;
    const images = container.querySelectorAll('img[data-src]');
    images.forEach(img => imageObserver.observe(img));
}

// ---------- AUTOCOMPLETE ----------
function showAutocompleteSuggestions(query) {
    if (!searchSuggestionsContainer) return;
    const lowerQuery = query.toLowerCase();
    const matches = allAnimeList.filter(anime => anime.title.toLowerCase().includes(lowerQuery)).slice(0, 7);
    if (matches.length === 0) {
        hideSuggestions();
        return;
    }
    searchSuggestionsContainer.innerHTML = matches.map(anime => `
        <div class="suggestion-item" data-id="${anime.id}">
            <i class="fas fa-search"></i>
            <span>${escapeHtml(anime.title)}</span>
            <small>${anime.info.total_episodes || 0} eps</small>
        </div>
    `).join('');
    searchSuggestionsContainer.style.display = 'block';
    document.querySelectorAll('.suggestion-item').forEach(item => {
        item.addEventListener('click', () => {
            const animeId = item.dataset.id;
            if (animeId) window.location.href = `anime.html?id=${animeId}`;
        });
    });
}

function hideSuggestions() {
    if (searchSuggestionsContainer) {
        searchSuggestionsContainer.style.display = 'none';
        searchSuggestionsContainer.innerHTML = '';
    }
}

// ---------- FILTER & SORT ----------
function applyFiltersAndRender() {
    let filtered = [...allAnimeList];
    if (currentGenre !== 'all') {
        filtered = filtered.filter(anime => anime.info.genres && anime.info.genres.includes(currentGenre));
    }
    if (currentStatus !== 'all') {
        filtered = filtered.filter(anime => anime.status === currentStatus);
    }
    if (searchQuery) {
        const lowerQuery = searchQuery.toLowerCase();
        filtered = filtered.filter(anime => 
            anime.title.toLowerCase().includes(lowerQuery) ||
            (anime.info.alternative_title && anime.info.alternative_title.toLowerCase().includes(lowerQuery))
        );
    }
    switch (currentSort) {
        case 'rating':
            filtered.sort((a, b) => (b.rating || 0) - (a.rating || 0));
            break;
        case 'title-asc':
            filtered.sort((a, b) => a.title.localeCompare(b.title));
            break;
        case 'title-desc':
            filtered.sort((a, b) => b.title.localeCompare(a.title));
            break;
        default:
            filtered.sort((a, b) => a.title.localeCompare(b.title));
    }
    currentFilteredList = filtered;
    currentPage = 1;
    renderPaginationOrInfinite();
}

function resetAndApplyFilters() {
    currentPage = 1;
    hasMore = true;
    applyFiltersAndRender();
}

// ---------- RENDERING MODE ----------
function renderPaginationOrInfinite() {
    const mode = getPaginationMode();
    if (mode === 'infinite') {
        animeContainer.innerHTML = '';
        if (paginationContainer) paginationContainer.style.display = 'none';
        if (loadMoreBtn) loadMoreBtn.style.display = 'block';
        currentPage = 1;
        hasMore = true;
        isLoadingMore = false;
        loadMoreBatch();
        setupInfiniteScroll();
    } else {
        if (paginationContainer) paginationContainer.style.display = 'flex';
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        window.removeEventListener('scroll', infiniteScrollHandler);
        renderCurrentPage();
        setupPaginationButtons();
    }
}

// ---------- INFINITE SCROLL ----------
let infiniteScrollHandler = null;
function setupInfiniteScroll() {
    if (infiniteScrollHandler) window.removeEventListener('scroll', infiniteScrollHandler);
    infiniteScrollHandler = () => {
        if (isLoadingMore || !hasMore) return;
        const scrollTop = window.scrollY;
        const windowHeight = window.innerHeight;
        const docHeight = document.documentElement.scrollHeight;
        if (scrollTop + windowHeight >= docHeight - 400) {
            loadMoreBatch();
        }
    };
    window.addEventListener('scroll', infiniteScrollHandler);
}

async function loadMoreBatch() {
    if (isLoadingMore || !hasMore) return;
    isLoadingMore = true;
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const batch = currentFilteredList.slice(start, end);
    if (batch.length === 0) {
        hasMore = false;
        isLoadingMore = false;
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        const endMsg = document.getElementById('end-message');
        if (endMsg) endMsg.style.display = 'block';
        return;
    }
    renderAnimeCards(batch, true);
    currentPage++;
    if (end >= currentFilteredList.length) {
        hasMore = false;
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        const endMsg = document.getElementById('end-message');
        if (endMsg) endMsg.style.display = 'block';
    }
    isLoadingMore = false;
}

// ---------- CLASSIC PAGINATION ----------
function renderCurrentPage() {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    const pageItems = currentFilteredList.slice(start, end);
    renderAnimeCards(pageItems, false);
    const totalPages = Math.ceil(currentFilteredList.length / ITEMS_PER_PAGE);
    updatePaginationButtons(currentPage, totalPages);
}

function setupPaginationButtons() {
    const totalPages = Math.ceil(currentFilteredList.length / ITEMS_PER_PAGE);
    updatePaginationButtons(currentPage, totalPages);
}

function updatePaginationButtons(current, total) {
    if (!paginationContainer) return;
    paginationContainer.innerHTML = '';
    if (total <= 1) return;
    const prev = document.createElement('button');
    prev.innerHTML = '<i class="fas fa-chevron-left"></i> Prev';
    prev.disabled = current === 1;
    prev.addEventListener('click', () => {
        if (current > 1) {
            currentPage = current - 1;
            renderCurrentPage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    paginationContainer.appendChild(prev);
    let startPage = Math.max(1, current - 2);
    let endPage = Math.min(total, current + 2);
    if (endPage - startPage < 4) {
        if (startPage === 1) endPage = Math.min(total, startPage + 4);
        else startPage = Math.max(1, endPage - 4);
    }
    if (startPage > 1) {
        const firstBtn = document.createElement('button');
        firstBtn.textContent = '1';
        firstBtn.addEventListener('click', () => goToPage(1));
        paginationContainer.appendChild(firstBtn);
        if (startPage > 2) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '0 0.5rem';
            paginationContainer.appendChild(ellipsis);
        }
    }
    for (let i = startPage; i <= endPage; i++) {
        const btn = document.createElement('button');
        btn.textContent = i;
        if (i === current) btn.classList.add('active');
        btn.addEventListener('click', () => goToPage(i));
        paginationContainer.appendChild(btn);
    }
    if (endPage < total) {
        if (endPage < total - 1) {
            const ellipsis = document.createElement('span');
            ellipsis.textContent = '...';
            ellipsis.style.padding = '0 0.5rem';
            paginationContainer.appendChild(ellipsis);
        }
        const lastBtn = document.createElement('button');
        lastBtn.textContent = total;
        lastBtn.addEventListener('click', () => goToPage(total));
        paginationContainer.appendChild(lastBtn);
    }
    const next = document.createElement('button');
    next.innerHTML = 'Next <i class="fas fa-chevron-right"></i>';
    next.disabled = current === total;
    next.addEventListener('click', () => {
        if (current < total) {
            currentPage = current + 1;
            renderCurrentPage();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    paginationContainer.appendChild(next);
    function goToPage(page) {
        currentPage = page;
        renderCurrentPage();
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ---------- CARD RENDERING (dengan lazy loading) ----------
function renderAnimeCards(items, append = false) {
    const layout = getLayoutPreference();
    const container = animeContainer;
    if (!append) container.innerHTML = '';
    if (items.length === 0 && !append) {
        container.innerHTML = '<div class="no-results"><i class="fas fa-frown"></i> No anime found. Try changing filters.</div>';
        return;
    }
    items.forEach(anime => {
        const card = document.createElement('div');
        card.className = `anime-card ${layout === 'list' ? 'list-view' : ''}`;
        const posterUrl = anime.poster_url || 'https://via.placeholder.com/300x450?text=No+Image';
        const rating = anime.rating ? `<i class="fas fa-star"></i> ${anime.rating}` : '';
        const statusClass = anime.status === 'ongoing' ? 'ongoing' : 'complete';
        const statusText = anime.status === 'ongoing' ? 'Ongoing' : 'Complete';
        // Gunakan data-src untuk lazy loading
        card.innerHTML = `
            <div class="card-poster">
                <img data-src="${posterUrl}" alt="${escapeHtml(anime.title)}" loading="lazy" class="lazy">
                <div class="card-status ${statusClass}">${statusText}</div>
            </div>
            <div class="card-info">
                <h3 class="card-title">${escapeHtml(anime.title)}</h3>
                ${layout === 'list' ? `<p class="card-synopsis">${escapeHtml((anime.synopsis || '').substring(0, 120))}${anime.synopsis?.length > 120 ? '...' : ''}</p>` : ''}
                <div class="card-meta">
                    <span class="card-rating">${rating}</span>
                    <span class="card-episodes"><i class="fas fa-play-circle"></i> ${anime.info.total_episodes || 0} eps</span>
                </div>
                <div class="card-genres">${(anime.info.genres || []).slice(0, 3).join(', ')}</div>
            </div>
        `;
        card.addEventListener('click', () => {
            window.location.href = `anime.html?id=${anime.id}`;
        });
        container.appendChild(card);
    });
    // Observe lazy images
    if (imageObserver) observeImages(container);
}

function resetPaginationAndRender() {
    currentPage = 1;
    hasMore = true;
    const mode = getPaginationMode();
    if (mode === 'infinite') {
        animeContainer.innerHTML = '';
        if (paginationContainer) paginationContainer.style.display = 'none';
        if (loadMoreBtn) loadMoreBtn.style.display = 'block';
        currentPage = 1;
        loadMoreBatch();
        setupInfiniteScroll();
    } else {
        window.removeEventListener('scroll', infiniteScrollHandler);
        if (paginationContainer) paginationContainer.style.display = 'flex';
        if (loadMoreBtn) loadMoreBtn.style.display = 'none';
        renderCurrentPage();
        setupPaginationButtons();
    }
}

// ========== CAROUSEL & LIVE FEED ==========
async function loadCarouselSections() {
    try {
        // New Releases
        showSkeletonCarousel(newReleaseContainer);
        const newReleases = await API.fetchNewReleases(12);
        renderCarousel(newReleaseContainer, newReleases, 'anime');
        
        // Latest Episodes
        showSkeletonCarousel(latestEpisodeContainer);
        const latestEpisodes = await API.fetchLatestEpisodes(12);
        renderCarousel(latestEpisodeContainer, latestEpisodes, 'episode');
        
        // Recently Updated
        showSkeletonCarousel(recentlyUpdatedContainer);
        const recentlyUpdated = await API.fetchRecentlyUpdated(12);
        renderCarousel(recentlyUpdatedContainer, recentlyUpdated, 'anime');
    } catch (error) {
        console.error('Failed to load carousel sections:', error);
        showToast('Failed to load carousel data', 'error');
    }
}

function showSkeletonCarousel(container) {
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < 6; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'carousel-card skeleton-carousel';
        skeleton.innerHTML = '<div class="skeleton-poster"></div><div class="skeleton-title"></div>';
        container.appendChild(skeleton);
    }
}

function renderCarousel(container, items, type) {
    if (!container) return;
    if (!items || items.length === 0) {
        container.innerHTML = '<div class="carousel-empty">No data available</div>';
        return;
    }
    container.innerHTML = '';
    items.forEach(item => {
        const card = document.createElement('div');
        card.className = 'carousel-card';
        if (type === 'episode') {
            const poster = item.poster_url || 'https://via.placeholder.com/300x450';
            card.innerHTML = `
                <div class="carousel-poster">
                    <img data-src="${poster}" alt="${escapeHtml(item.anime_title)}" loading="lazy" class="lazy">
                    <div class="carousel-ep-badge">EP ${item.episode_number}</div>
                </div>
                <div class="carousel-info">
                    <div class="carousel-title">${escapeHtml(item.anime_title)}</div>
                    <div class="carousel-sub">${escapeHtml(item.episode_title || `Episode ${item.episode_number}`)}</div>
                </div>
            `;
            card.addEventListener('click', () => {
                window.location.href = `anime.html?id=${item.anime_id}&ep=${item.episode_number}`;
            });
        } else {
            const poster = item.poster_url || 'https://via.placeholder.com/300x450';
            card.innerHTML = `
                <div class="carousel-poster">
                    <img data-src="${poster}" alt="${escapeHtml(item.title)}" loading="lazy" class="lazy">
                    <div class="carousel-status ${item.status}">${item.status === 'ongoing' ? 'Ongoing' : 'Complete'}</div>
                </div>
                <div class="carousel-info">
                    <div class="carousel-title">${escapeHtml(item.title)}</div>
                    <div class="carousel-sub">${item.total_episodes || 0} eps</div>
                </div>
            `;
            card.addEventListener('click', () => {
                window.location.href = `anime.html?id=${item.id}`;
            });
        }
        container.appendChild(card);
    });
    if (imageObserver) observeImages(container);
}

async function loadLiveFeed() {
    if (!liveFeedContainer) return;
    try {
        liveFeedContainer.innerHTML = '<div class="live-feed-loading"><i class="fas fa-spinner fa-pulse"></i> Loading feed...</div>';
        const events = await API.fetchLiveFeed(30);
        renderLiveFeed(events);
    } catch (error) {
        console.error('Failed to load live feed:', error);
        liveFeedContainer.innerHTML = '<div class="live-feed-empty">Unable to load feed</div>';
    }
}

function renderLiveFeed(events) {
    if (!liveFeedContainer) return;
    if (!events || events.length === 0) {
        liveFeedContainer.innerHTML = '<div class="live-feed-empty">No events yet</div>';
        return;
    }
    liveFeedContainer.innerHTML = '';
    events.forEach(event => {
        const item = document.createElement('div');
        item.className = 'live-feed-item';
        const time = new Date(event.created_at).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        item.innerHTML = `
            <span class="live-feed-time">${time}</span>
            <span class="live-feed-message">${escapeHtml(event.message)}</span>
        `;
        if (event.anime_id) {
            item.style.cursor = 'pointer';
            item.addEventListener('click', () => {
                window.location.href = `anime.html?id=${event.anime_id}`;
            });
        }
        liveFeedContainer.appendChild(item);
    });
}

function prependLiveFeedEvent(message, animeId = null, episodeNumber = null) {
    if (!liveFeedContainer) return;
    const item = document.createElement('div');
    item.className = 'live-feed-item';
    const now = new Date();
    const time = now.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    item.innerHTML = `
        <span class="live-feed-time">${time}</span>
        <span class="live-feed-message">${escapeHtml(message)}</span>
    `;
    if (animeId) {
        item.style.cursor = 'pointer';
        item.addEventListener('click', () => {
            window.location.href = `anime.html?id=${animeId}`;
        });
    }
    liveFeedContainer.prepend(item);
    while (liveFeedContainer.children.length > 50) {
        liveFeedContainer.removeChild(liveFeedContainer.lastChild);
    }
}

// WebSocket event handlers
function handleNewEpisodeEvent(event) {
    const { animeId, animeTitle, episodeNumber, message } = event.data;
    prependLiveFeedEvent(message, animeId, episodeNumber);
    refreshLatestEpisodesCarousel();
    refreshRecentlyUpdatedCarousel();
    showToast(`${animeTitle} Episode ${episodeNumber} added!`, 'info', 4000);
}

function handleAnimeUpdatedEvent(event) {
    const { animeId, animeTitle, message } = event.data;
    prependLiveFeedEvent(message, animeId);
    refreshRecentlyUpdatedCarousel();
}

async function refreshLatestEpisodesCarousel() {
    try {
        const latest = await API.fetchLatestEpisodes(12);
        renderCarousel(latestEpisodeContainer, latest, 'episode');
    } catch (e) { console.error(e); }
}

async function refreshRecentlyUpdatedCarousel() {
    try {
        const updated = await API.fetchRecentlyUpdated(12);
        renderCarousel(recentlyUpdatedContainer, updated, 'anime');
    } catch (e) { console.error(e); }
}

async function loadSchedule() {
    const scheduleContainer = document.querySelector('.schedule-container');
    if (!scheduleContainer) return;
    
    try {
        const res = await API.fetchSchedule();
        if (!res || !res.success || !res.data) {
            scheduleContainer.innerHTML = '<div class="error">Schedule not available</div>';
            return;
        }
        
        const data = res.data;
        
        // Kelompokkan berdasarkan day
        const byDay = {
            senin: [],
            selasa: [],
            rabu: [],
            kamis: [],
            jumat: [],
            sabtu: [],
            minggu: []
        };
        
        data.forEach(item => {
            const dayKey = item.day ? item.day.toLowerCase() : '';
            if (byDay[dayKey]) {
                byDay[dayKey].push(item);
            }
        });
        
        // Render ke HTML
        for (const [day, items] of Object.entries(byDay)) {
            const container = document.querySelector(`.schedule-day[data-day="${day}"] .schedule-items`);
            if (!container) continue;
            
            if (items.length === 0) {
                container.innerHTML = '<div class="empty-day-schedule">Tidak ada rilis</div>';
                continue;
            }
            
            container.innerHTML = items.map(anime => `
                <div class="schedule-card">
                    <a href="anime.html?id=${anime.slug}">
                        ${escapeHtml(anime.title)}
                    </a>
                    <span class="eps">EP ${anime.latestEpisode || '?'}</span>
                    ${anime.isUpdatedToday ? '<span class="badge-updated"><i class="fas fa-check-circle"></i> Update Hari Ini</span>' : ''}
                </div>
            `).join('');
        }
    } catch (error) {
        console.error('Failed to load schedule:', error);
        scheduleContainer.innerHTML = '<div class="error">Failed to load schedule data</div>';
    }
}