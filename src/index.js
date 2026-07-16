import AgentAPI from "apminsight";
AgentAPI.config();

import express from 'express';
import cors from "cors";
import {matchRouter} from "./routes/matches.js";
import * as http from "node:http";
import {attachWebSocketServer} from "./ws/server.js";
import {securityMiddleware} from "./arcjet.js";

const PORT = Number(process.env.PORT || 8000);
const HOST = process.env.HOST || '0.0.0.0';


const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
}));

app.use(express.json());

app.get('/', (req, res) => {
  res.send('Hello from Sportify-Live!');
});

app.use(securityMiddleware());

app.use('/matches',matchRouter);

const{broadcastMatchCreated} = attachWebSocketServer(server);
app.locals.broadcastMatchCreated = broadcastMatchCreated;

server.listen(PORT, HOST, () => {
  const baseUrl = HOST === '0.0.0.0' ? `http://localhost:${PORT}` : `http://${HOST}:${PORT}`;
  console.log(`Server is running at ${baseUrl}`);
  console.log(`WebsSocket Server is running on ${baseUrl.replace('http', 'ws')}/ws`);
});
