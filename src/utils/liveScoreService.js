import { db } from '../db/db.js';
import { matches, commentary } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export const startLivePolling = (broadcastMatchUpdate, broadcastCommentary) => {
    const API_KEY = process.env.API_SPORTS_KEY;
    const HOST = 'https://v3.football.api-sports.io';

    if (!API_KEY) {
        console.error("API_SPORTS_KEY is missing in .env.");
        return;
    }

    const fetchLiveGames = async () => {
        try {
            // 1 API CALL: Gets the overarching status of all live games at once
            const response = await fetch(`${HOST}/fixtures?live=all`, {
                headers: { 'x-apisports-key': API_KEY }
            });
            const data = await response.json();

            if (data.errors && Object.keys(data.errors).length > 0) {
                console.error("API Error:", data.errors);
                return;
            }

            const liveMatches = data.response || [];

            for (const game of liveMatches) {
                const fixtureId = game.fixture.id;
                const homeTeam = game.teams.home.name;
                const awayTeam = game.teams.away.name;
                const homeLogo = game.teams.home.logo;
                const awayLogo = game.teams.away.logo;
                const homeScore = game.goals.home ?? 0;
                const awayScore = game.goals.away ?? 0;
                const elapsed = game.fixture.status.elapsed ?? 0;
                const statusDetail = game.fixture.status.short ?? 'LIVE';

                const existingMatchResult = await db.select()
                    .from(matches)
                    .where(and(eq(matches.homeTeam, homeTeam), eq(matches.awayTeam, awayTeam)))
                    .limit(1);

                let currentMatch = existingMatchResult[0];

                if (currentMatch) {
                    // The Rate-Limit Protector: Mathematically verify if a goal was actually scored
                    const scoreChanged = currentMatch.homeScore !== homeScore || currentMatch.awayScore !== awayScore;

                    if (scoreChanged || currentMatch.elapsed !== elapsed) {
                        const [updatedMatch] = await db.update(matches)
                            .set({ homeScore, awayScore, elapsed, statusDetail, homeLogo, awayLogo })
                            .where(eq(matches.id, currentMatch.id))
                            .returning();

                        broadcastMatchUpdate(updatedMatch);

                        // ONLY fetch the heavy events/commentary payload IF the score changed
                        if (scoreChanged) {
                            fetchMatchEvents(fixtureId, currentMatch.id, broadcastCommentary, API_KEY, HOST);
                        }
                    }
                } else {
                    // Insert new match if it was just discovered
                    const [newMatch] = await db.insert(matches).values({
                        sport: 'Football',
                        homeTeam,
                        awayTeam,
                        homeLogo,
                        awayLogo,
                        status: 'live',
                        statusDetail,
                        elapsed,
                        homeScore,
                        awayScore,
                    }).returning();

                    broadcastMatchUpdate(newMatch);

                    // Fetch initial events once to populate the fresh match
                    fetchMatchEvents(fixtureId, newMatch.id, broadcastCommentary, API_KEY, HOST);
                }
            }
        } catch (error) {
            console.error("Error fetching live sports data:", error);
        }
    };

    fetchLiveGames();

    // Safely back to 60 seconds! This will burn exactly 60 requests per hour.
    setInterval(fetchLiveGames, 60000);
};

// Helper function to fetch live commentary/events
async function fetchMatchEvents(externalFixtureId, internalMatchId, broadcastCommentary, apiKey, host) {
    try {
        const res = await fetch(`${host}/fixtures/events?fixture=${externalFixtureId}`, {
            headers: { 'x-apisports-key': apiKey }
        });
        const data = await res.json();
        const events = data.response || [];

        for (let index = 0; index < events.length; index++) {
            const ev = events[index];
            const minute = ev.time.elapsed;
            const teamName = ev.team.name;
            const player = ev.player.name || 'Player';
            const eventType = ev.type;
            const detail = ev.detail || '';

            const message = `${eventType.toUpperCase()}: ${player} (${teamName}) - ${detail}`;

            const [newComm] = await db.insert(commentary).values({
                matchId: internalMatchId,
                minute,
                sequence: index + 1,
                period: ev.time.extra ? 'Extra Time' : 'Regular',
                eventType,
                actor: player,
                team: teamName,
                message,
            }).returning();

            if (broadcastCommentary) {
                broadcastCommentary(newComm);
            }
        }
    } catch (err) {
        console.error(`Failed fetching events for fixture ${externalFixtureId}:`, err);
    }
}