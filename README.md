# 🎬 ZeroStream

ZeroStream is a production-ready, high-performance real-time anime streaming platform. It features automated scraping from dual sources, database sync tracking using hash comparisons, WebSockets for real-time activity feeds, and a highly responsive, modern frontend UI with optimized UX paths.

---

## 🚀 Key Features

### 📡 Real-Time & Backend Architecture
- **Dual-Source Intelligent Scraper**: Scrapes scheduling data and new releases from primary source (`/anime-terbaru-sub-indo/`) and fallback homepage.
- **Hash-Comparison Updates**: Database entries (anime description, genres, synopsis) are only updated when actual data changes, preventing redundant writes.
- **Reliable Fallback**: Uses local JSON caching when remote targets are inaccessible, maintaining complete functionality.
- **WebSockets Feed**: Pushes newly scraped anime and episodes directly to connected clients in real-time.
- **API Cache & Rate Limiting**: Ensures performance efficiency via Express rate limiters and memory cache.

### 🎨 Premium Frontend UI/UX
- **Intelligent Search Bar**: Persistence during input, automated suggestions dropdown, clear ("X") button, and `Esc` key navigation.
- **Contrast-Adjusted Resolution Selection**: Clean circular buttons (`360p`, `480p`, `720p`, `1080p`) with theme-adaptive text color, borders, and hover states.
- **Direct-Click Episode Row Player**: Remodelled episode lists. Removed the redundant "Play" button; clicking anywhere on the episode item triggers playback instantly.
- **Weekly Schedule Panel**: Structured Monday-to-Sunday interactive cards indicating "Update Hari Ini" badges.

---

## 🛠️ Tech Stack

- **Backend**: Node.js (ES Modules), Express.js, SQLite (`node:sqlite`)
- **Scraper**: Axios, Cheerio
- **Real-Time Feed**: WebSockets (`ws` library)
- **Frontend**: HTML5, Vanilla JavaScript, CSS3 Variables (Dark/Light mode support), FontAwesome Icons

---

## 📂 Project Directory Structure

```
├── backend/
│   ├── config.js              # Environment settings and configuration values
│   ├── database.js            # SQLite database queries & connection manager
│   ├── logger.js              # Winston logger setup
│   ├── middleware.js          # Caching, rate limiting, and security headers
│   ├── migrate.js             # SQLite tables migration script
│   ├── scheduler.js           # Cron-scheduler for automated scraping tasks
│   ├── server.js              # Main Express API and WebSocket server
│   ├── websocket.js           # WebSocket connection registry & broadcast logic
│   └── scraper/
│       └── incremental.js     # Main scraper engine (dual-source, hash checks)
├── frontend/
│   ├── css/
│   │   └── style.css          # Design system styling & custom themes
│   ├── js/
│   │   ├── common.js          # Shared state, settings, & WebSocket handlers
│   │   ├── detail.js          # Streaming player & episode controls
│   │   └── home.js            # Homepage schedule, filters, & autocomplete
│   ├── anime.html             # Video player detail layout
│   └── index.html             # Web app homepage
├── data/                      # Database storage path
├── ecosystem.config.cjs       # PM2 production process configuration
├── package.json               # Package dependencies and run scripts
└── .env                       # Environment configuration file
```

---

## 🗄️ Database Schema

ZeroStream runs on a fast, embedded SQLite database.

| Table Name | Primary Purpose | Key Fields |
| :--- | :--- | :--- |
| `anime` | Core metadata for anime shows | `id`, `title`, `slug`, `synopsis`, `image_url` |
| `anime_info` | Detailed information (genres, studio, status) | `anime_id`, `type`, `status`, `hash_info` |
| `episodes` | List of streamable episodes | `id`, `anime_id`, `episode_number`, `stream_urls` |
| `feed_events` | Logs for real-time WebSocket activities | `id`, `event_type`, `anime_id`, `message` |

---

## ⚙️ Installation & Setup

### 1. Prerequisites
- **Node.js** (v22.13.0 or higher recommended)
- **NPM**

### 2. Configure Environment
Create a `.env` file in the root directory:
```ini
PORT=3000
NODE_ENV=development
SCRAPE_INTERVAL_MINUTES=10
CACHE_TTL_SECONDS=60
```

### 3. Install Dependencies
```bash
npm install
```

### 4. Run Migrations
Generate database tables:
```bash
npm run migrate
```

### 5. Running the Application
To run in development mode with local live-reload/logs:
```bash
npm run dev
```

To run in production mode (requires PM2):
```bash
npm run pm2:start
```

---

## 📈 Verification & Testing

1. **Verify API Endpoints**:
   - Access `http://localhost:3000/api` to check system health.
   - Access `http://localhost:3000/api/schedule` to see the parsed ongoing weekly schedule JSON cache.
2. **Verify Autocomplete**:
   - Type in the search input on the homepage; suggestions should pop up and follow typing changes without disappearing. Press `Escape` or click the clear button (`X`) to reset.
3. **Verify Playback**:
   - Navigate to any anime detail page, choose your preferred quality (buttons automatically adjust text/border contrast), and click on any row in the episode list to start streaming instantly.
