// ============================================
// NIMEGAMI - COMMON MODULE (Fase 3)
// Global utilities, storage manager, API layer, WebSocket
// Production-ready | FontAwesome Icons
// ============================================

// ---------- STORAGE KEYS ----------
const STORAGE_KEYS = {
    THEME: 'nimegami_theme',
    LAYOUT: 'nimegami_layout',
    PAGINATION_MODE: 'nimegami_pagination_mode',
    WATCH_HISTORY: 'nimegami_history',
    BOOKMARKS: 'nimegami_bookmarks',
    DEFAULT_QUALITY: 'nimegami_quality'
};

// ---------- GLOBAL STATE ----------
let animeData = null;
let allAnimeList = [];
let isOnline = navigator.onLine;
let socket = null;
let eventHandlers = new Map(); // Untuk callback event dari home.js

// ---------- API SERVICE ----------
const API = {
    base: '/api',
    
    async fetchAllAnime() {
        const response = await fetch(`${this.base}/anime/all`);
        if (!response.ok) throw new Error('Failed to fetch anime list');
        const result = await response.json();
        return result.data;
    },
    
    async fetchAnimeById(id) {
        const response = await fetch(`${this.base}/anime/${id}`);
        if (!response.ok) throw new Error('Anime not found');
        const result = await response.json();
        return result.data;
    },
    
    async fetchGenres() {
        const response = await fetch(`${this.base}/genres`);
        if (!response.ok) throw new Error('Failed to fetch genres');
        const result = await response.json();
        return result.data;
    },
    
    async search(query) {
        const response = await fetch(`${this.base}/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) throw new Error('Search failed');
        const result = await response.json();
        return result.data;
    },

    // Fase 3: Endpoints baru
    async fetchLatestEpisodes(limit = 10) {
        const response = await fetch(`${this.base}/latest/episodes?limit=${limit}`);
        if (!response.ok) throw new Error('Failed to fetch latest episodes');
        const result = await response.json();
        return result.data;
    },

    async fetchNewReleases(limit = 10) {
        const response = await fetch(`${this.base}/latest/anime?type=new_release&limit=${limit}`);
        if (!response.ok) throw new Error('Failed to fetch new releases');
        const result = await response.json();
        return result.data;
    },

    async fetchRecentlyUpdated(limit = 10) {
        const response = await fetch(`${this.base}/latest/anime?type=recently_updated&limit=${limit}`);
        if (!response.ok) throw new Error('Failed to fetch recently updated');
        const result = await response.json();
        return result.data;
    },

    async fetchLiveFeed(limit = 30) {
        const response = await fetch(`${this.base}/live-feed?limit=${limit}`);
        if (!response.ok) throw new Error('Failed to fetch live feed');
        const result = await response.json();
        return result.data;
    },

    async fetchSchedule() {
        const response = await fetch(`${this.base}/schedule`);
        if (!response.ok) throw new Error('Failed to fetch schedule');
        const result = await response.json();
        return result;
    }
};

// ---------- LOAD ANIME DATA ----------
async function loadAnimeData(forceRefresh = false) {
    if (animeData && !forceRefresh) return animeData;
    try {
        const data = await API.fetchAllAnime();
        allAnimeList = data;
        animeData = { anime_list: data, metadata: {} };
        console.log(`✅ Loaded ${allAnimeList.length} anime`);
        return animeData;
    } catch (error) {
        console.error('Failed to load anime data:', error);
        showToast('Gagal memuat data anime', 'error');
        return null;
    }
}

function getAnimeById(id) {
    return allAnimeList.find(anime => anime.id === id);
}

function getAllGenres() {
    const genresSet = new Set();
    allAnimeList.forEach(anime => {
        if (anime.info.genres && Array.isArray(anime.info.genres)) {
            anime.info.genres.forEach(g => genresSet.add(g));
        }
    });
    return Array.from(genresSet).sort();
}

// ---------- THEME MANAGEMENT ----------
function initTheme() {
    const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const theme = savedTheme || (prefersDark ? 'dark' : 'light');
    setTheme(theme);
}

function setTheme(theme) {
    const isDark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
    localStorage.setItem(STORAGE_KEYS.THEME, isDark ? 'dark' : 'light');
    document.querySelectorAll('.theme-btn').forEach(btn => {
        if (btn.dataset.theme === theme) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
}

// ---------- LAYOUT MANAGEMENT ----------
function getLayoutPreference() {
    return localStorage.getItem(STORAGE_KEYS.LAYOUT) || 'grid';
}

function setLayoutPreference(layout) {
    localStorage.setItem(STORAGE_KEYS.LAYOUT, layout);
    window.dispatchEvent(new CustomEvent('layoutChanged', { detail: layout }));
    document.querySelectorAll('.layout-mode-btn, .layout-btn').forEach(btn => {
        if (btn.dataset.layout === layout || btn.id === `${layout}-view-btn`) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    const container = document.getElementById('anime-container');
    if (container) {
        if (layout === 'grid') {
            container.classList.remove('list-view');
            container.classList.add('grid-view');
        } else {
            container.classList.remove('grid-view');
            container.classList.add('list-view');
        }
    }
}

// ---------- PAGINATION MODE ----------
function getPaginationMode() {
    return localStorage.getItem(STORAGE_KEYS.PAGINATION_MODE) || 'pagination';
}

function setPaginationMode(mode) {
    localStorage.setItem(STORAGE_KEYS.PAGINATION_MODE, mode);
    window.dispatchEvent(new CustomEvent('paginationModeChanged', { detail: mode }));
    document.querySelectorAll('.pagination-mode-btn').forEach(btn => {
        if (btn.dataset.mode === mode) btn.classList.add('active');
        else btn.classList.remove('active');
    });
}

// ---------- DEFAULT QUALITY ----------
function getDefaultQuality() {
    return localStorage.getItem(STORAGE_KEYS.DEFAULT_QUALITY) || '720p';
}

function setDefaultQuality(quality) {
    localStorage.setItem(STORAGE_KEYS.DEFAULT_QUALITY, quality);
    showToast(`Default quality set to ${quality}`, 'info');
    window.dispatchEvent(new CustomEvent('qualityChanged', { detail: quality }));
}

// ---------- WATCH HISTORY ----------
function addToHistory(animeId, episodeNumber, animeTitle, episodeTitle) {
    let history = JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCH_HISTORY) || '[]');
    history = history.filter(item => item.animeId !== animeId);
    history.unshift({
        animeId,
        episodeNumber,
        animeTitle: animeTitle || 'Unknown',
        episodeTitle: episodeTitle || `Episode ${episodeNumber}`,
        timestamp: Date.now()
    });
    if (history.length > 50) history.pop();
    localStorage.setItem(STORAGE_KEYS.WATCH_HISTORY, JSON.stringify(history));
    window.dispatchEvent(new CustomEvent('historyUpdated'));
}

function getWatchHistory() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.WATCH_HISTORY) || '[]');
}

function getLastWatchedEpisode(animeId) {
    const history = getWatchHistory();
    const entry = history.find(item => item.animeId === animeId);
    return entry ? entry.episodeNumber : null;
}

// ---------- BOOKMARKS ----------
function toggleBookmark(animeId, animeTitle) {
    let bookmarks = JSON.parse(localStorage.getItem(STORAGE_KEYS.BOOKMARKS) || '[]');
    const exists = bookmarks.some(b => b.id === animeId);
    if (exists) {
        bookmarks = bookmarks.filter(b => b.id !== animeId);
        showToast('Removed from bookmarks', 'info');
    } else {
        bookmarks.push({ id: animeId, title: animeTitle || 'Unknown', timestamp: Date.now() });
        showToast('Added to bookmarks', 'success');
    }
    localStorage.setItem(STORAGE_KEYS.BOOKMARKS, JSON.stringify(bookmarks));
    window.dispatchEvent(new CustomEvent('bookmarksUpdated'));
    return !exists;
}

function isBookmarked(animeId) {
    const bookmarks = JSON.parse(localStorage.getItem(STORAGE_KEYS.BOOKMARKS) || '[]');
    return bookmarks.some(b => b.id === animeId);
}

function getBookmarks() {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.BOOKMARKS) || '[]');
}

// ---------- TOAST NOTIFICATION ----------
let toastContainer = null;

function showToast(message, type = 'info', duration = 3000) {
    if (!toastContainer) {
        toastContainer = document.getElementById('toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.id = 'toast-container';
            toastContainer.className = 'toast-container';
            document.body.appendChild(toastContainer);
        }
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<i class="fas ${type === 'success' ? 'fa-check-circle' : type === 'error' ? 'fa-exclamation-circle' : 'fa-info-circle'}"></i> ${escapeHtml(message)}`;
    toastContainer.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// ---------- SKELETON LOADER ----------
function showSkeleton(container, count = 12, isGrid = true) {
    if (!container) return;
    container.innerHTML = '';
    for (let i = 0; i < count; i++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'skeleton-card';
        skeleton.innerHTML = `
            <div class="skeleton-poster"></div>
            <div class="skeleton-title"></div>
            <div class="skeleton-text"></div>
            <div class="skeleton-text" style="width: 60%"></div>
        `;
        container.appendChild(skeleton);
    }
}

function hideSkeleton(container) {
    if (!container) return;
    const skeletons = container.querySelectorAll('.skeleton-card');
    skeletons.forEach(s => s.remove());
}

// ---------- WEBSOCKET (FASE 3) ----------
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    socket = new WebSocket(wsUrl);
    
    socket.onopen = () => {
        console.log('🔌 WebSocket connected');
        showToast('Real-time feed aktif', 'success', 2000);
    };
    
    socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            console.log('📡 WebSocket event:', data);
            handleRealtimeEvent(data);
        } catch (e) {
            console.error('Failed to parse WebSocket message:', e);
        }
    };
    
    socket.onerror = (error) => {
        console.error('WebSocket error:', error);
    };
    
    socket.onclose = () => {
        console.log('🔌 WebSocket disconnected, reconnecting in 5s...');
        setTimeout(connectWebSocket, 5000);
    };
}

function handleRealtimeEvent(event) {
    // Trigger semua callback yang terdaftar untuk event type
    if (eventHandlers.has(event.type)) {
        const callbacks = eventHandlers.get(event.type);
        callbacks.forEach(cb => cb(event));
    }
    
    // Tampilkan toast untuk new episode
    if (event.type === 'NEW_EPISODE') {
        showToast(`${event.data.animeTitle} Episode ${event.data.episodeNumber} added!`, 'info', 4000);
    } else if (event.type === 'ANIME_UPDATED') {
        showToast(`${event.data.animeTitle} updated`, 'info', 3000);
    }
}

// Register event handler dari modul lain (home.js)
function onRealtimeEvent(eventType, callback) {
    if (!eventHandlers.has(eventType)) {
        eventHandlers.set(eventType, []);
    }
    eventHandlers.get(eventType).push(callback);
}

// ---------- NETWORK ----------
function initNetworkListener() {
    window.addEventListener('online', () => {
        isOnline = true;
        showToast('Back online', 'success');
        window.dispatchEvent(new CustomEvent('networkOnline'));
    });
    window.addEventListener('offline', () => {
        isOnline = false;
        showToast('No internet connection', 'error');
        window.dispatchEvent(new CustomEvent('networkOffline'));
    });
}

// ---------- SETTINGS PANEL ----------
let settingsPanel = null;

function createSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return null;
    settingsPanel = panel;
    panel.querySelectorAll('.theme-btn').forEach(btn => {
        btn.addEventListener('click', () => setTheme(btn.dataset.theme));
        const currentTheme = document.documentElement.getAttribute('data-theme');
        if (btn.dataset.theme === currentTheme) btn.classList.add('active');
    });
    panel.querySelectorAll('.layout-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setLayoutPreference(btn.dataset.layout));
        if (btn.dataset.layout === getLayoutPreference()) btn.classList.add('active');
    });
    panel.querySelectorAll('.pagination-mode-btn').forEach(btn => {
        btn.addEventListener('click', () => setPaginationMode(btn.dataset.mode));
        if (btn.dataset.mode === getPaginationMode()) btn.classList.add('active');
    });
    panel.querySelectorAll('[data-quality]').forEach(btn => {
        btn.addEventListener('click', () => setDefaultQuality(btn.dataset.quality));
        if (btn.dataset.quality === getDefaultQuality()) btn.classList.add('active');
    });
    const closeBtn = panel.querySelector('#close-settings');
    if (closeBtn) closeBtn.addEventListener('click', () => closeSettings());
    return panel;
}

function openSettings() {
    if (!settingsPanel) createSettingsPanel();
    if (settingsPanel) settingsPanel.classList.add('open');
}

function closeSettings() {
    if (settingsPanel) settingsPanel.classList.remove('open');
}

// ---------- MOBILE NAV ----------
function initMobileNav() {
    const hamburger = document.getElementById('hamburger-menu');
    const mobileNav = document.getElementById('mobile-nav');
    const closeNavBtn = document.getElementById('close-nav-btn');
    if (!hamburger || !mobileNav) return;
    function openNav() {
        mobileNav.hidden = false;
        mobileNav.classList.add('open');
        hamburger.classList.add('active');
        hamburger.setAttribute('aria-expanded', 'true');
    }
    function closeNav() {
        mobileNav.classList.remove('open');
        hamburger.classList.remove('active');
        hamburger.setAttribute('aria-expanded', 'false');
        setTimeout(() => {
            if (!mobileNav.classList.contains('open')) mobileNav.hidden = true;
        }, 300);
    }
    hamburger.addEventListener('click', () => {
        if (mobileNav.classList.contains('open')) closeNav();
        else openNav();
    });
    if (closeNavBtn) closeNavBtn.addEventListener('click', closeNav);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileNav.classList.contains('open')) closeNav();
    });
}

function initSearchToggle() {
    const searchToggle = document.getElementById('search-toggle-btn');
    const searchDrawer = document.getElementById('mobile-search-drawer');
    if (!searchToggle || !searchDrawer) return;
    searchToggle.addEventListener('click', () => {
        const isHidden = searchDrawer.hidden;
        searchDrawer.hidden = !isHidden;
        if (isHidden) {
            const input = searchDrawer.querySelector('#search-input');
            if (input) input.focus();
        }
    });
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function debounce(func, delay) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), delay);
    };
}

// ---------- INITIALIZE ----------
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initNetworkListener();
    initMobileNav();
    initSearchToggle();
    createSettingsPanel();
    connectWebSocket(); // Fase 3
    
    const settingsIcon = document.getElementById('settings-icon');
    if (settingsIcon) settingsIcon.addEventListener('click', openSettings);
});

// Expose globals
window.API = API;
window.loadAnimeData = loadAnimeData;
window.getAnimeById = getAnimeById;
window.getAllGenres = getAllGenres;
window.showToast = showToast;
window.escapeHtml = escapeHtml;
window.showSkeleton = showSkeleton;
window.hideSkeleton = hideSkeleton;
window.toggleBookmark = toggleBookmark;
window.isBookmarked = isBookmarked;
window.getBookmarks = getBookmarks;
window.addToHistory = addToHistory;
window.getWatchHistory = getWatchHistory;
window.getLastWatchedEpisode = getLastWatchedEpisode;
window.getLayoutPreference = getLayoutPreference;
window.setLayoutPreference = setLayoutPreference;
window.getPaginationMode = getPaginationMode;
window.setPaginationMode = setPaginationMode;
window.getDefaultQuality = getDefaultQuality;
window.openSettings = openSettings;
window.closeSettings = closeSettings;
window.debounce = debounce;
window.onRealtimeEvent = onRealtimeEvent; // Fase 3