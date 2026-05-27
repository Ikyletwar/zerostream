// backend/websocket.js
// WebSocket server for realtime events

import { WebSocketServer } from 'ws';
import { addFeedEvent, getFeedEvents } from './database.js';

let wss = null;
let clients = new Set();

/**
 * Initialize WebSocket server on existing HTTP server
 */
export function initWebSocketServer(server) {
    wss = new WebSocketServer({ server });
    
    wss.on('connection', (ws, req) => {
        const clientId = Date.now() + '-' + Math.random().toString(36).substr(2, 6);
        console.log(`🔌 WebSocket client connected: ${clientId}`);
        clients.add(ws);
        
        // Send initial connection confirmation
        ws.send(JSON.stringify({ type: 'CONNECTED', message: 'Connected to Nimegami realtime feed' }));
        
        ws.on('close', () => {
            console.log(`🔌 WebSocket client disconnected: ${clientId}`);
            clients.delete(ws);
        });
        
        ws.on('error', (err) => {
            console.error(`WebSocket error for ${clientId}:`, err.message);
            clients.delete(ws);
        });
    });
    
    console.log(`🔌 WebSocket server initialized`);
    return wss;
}

/**
 * Broadcast an event to all connected clients
 */
export function broadcast(event) {
    if (!wss) {
        console.warn('WebSocket server not initialized');
        return;
    }
    
    const message = JSON.stringify(event);
    let sentCount = 0;
    
    clients.forEach(client => {
        if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
            sentCount++;
        }
    });
    
    if (sentCount > 0) {
        console.log(`📡 Broadcasted ${event.type} to ${sentCount} client(s)`);
    }
}

/**
 * Emit a new episode event and store in feed_events
 */
export function emitNewEpisode(animeId, animeTitle, episodeNumber, episodeTitle) {
    const message = `${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} - ${animeTitle} Episode ${episodeNumber} added`;
    
    // Store in database
    addFeedEvent('NEW_EPISODE', animeId, episodeNumber, message);
    
    // Broadcast to all connected clients
    broadcast({
        type: 'NEW_EPISODE',
        timestamp: Date.now(),
        data: {
            animeId,
            animeTitle,
            episodeNumber,
            episodeTitle: episodeTitle || `Episode ${episodeNumber}`,
            message
        }
    });
}

/**
 * Emit an anime update event (when an anime's details change)
 */
export function emitAnimeUpdated(animeId, animeTitle) {
    const message = `${new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })} - ${animeTitle} updated`;
    addFeedEvent('ANIME_UPDATED', animeId, null, message);
    broadcast({
        type: 'ANIME_UPDATED',
        timestamp: Date.now(),
        data: { animeId, animeTitle, message }
    });
}

/**
 * Get number of connected clients
 */
export function getConnectedClientsCount() {
    return clients.size;
}