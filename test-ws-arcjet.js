import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { URL } from 'url';

// Mock wsArcjet
const wsArcjet = {
    protect: async (req) => {
        // We use a dummy host here just so the URL parser doesn't crash
        const url = new URL(req.url, 'http://localhost');

        if (url.searchParams.has('deny')) {
            return {
                isDenied: () => true,
                reason: {
                    isRateLimit: () => url.searchParams.get('deny') === 'rate',
                }
            };
        }
        return { isDenied: () => false };
    }
};

const server = http.createServer();
const wss = new WebSocketServer({ noServer: true, path: '/ws' });

server.on('upgrade', async (req, socket, head) => {
    // 1. Run the mock Arcjet check
    const decision = await wsArcjet.protect(req);

    // 2. If Arcjet denies it, block the connection
    if (decision.isDenied()) {
        if (decision.reason.isRateLimit()) {
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        } else {
            socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        }
        socket.destroy();
        return;
    }

    // 3. If allowed, complete the WebSocket handshake
    wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req);
    });
});

// Basic connection response for testing
wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'welcome', message: 'Passed Arcjet check!' }));
});

server.listen(8080, () => {
    console.log('Mock WebSocket Server running on port 8080');
});