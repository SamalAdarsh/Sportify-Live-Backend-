import { db } from '../db/db.js';
import { matches } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

export const startLivePolling = (broadcastMatchUpdate) => {
    const API_KEY = process.env.API_SPORTS_KEY;
    const HOST = 'https://v3.football.api-sports.io';

    if (!API_KEY) {
        console.error("API_SPORTS_KEY is missing in .env. Live polling aborted.");
        return;
    }

    // Extract the fetching logic into its own function
    const fetchLiveGames = async () => {
        try {
            console.log("Fetching real live fixtures from API-SPORTS...");

            const response = await fetch(`${HOST}/fixtures?live=all`, {
                method: 'GET',
                headers: {
                    'x-apisports-key': API_KEY
                }
            });

            const data = await response.json();

            if (data.errors && Object.keys(data.errors).length > 0) {
                console.error("API Error:", data.errors);
                return;
            }

            const liveMatches = data.response;
            console.log(`Found ${liveMatches.length} live matches!`); // Great for debugging

            for (const game of liveMatches) {
                const homeTeam = game.teams.home.name;
                const awayTeam = game.teams.away.name;
                const homeScore = game.goals.home ?? 0;
                const awayScore = game.goals.away ?? 0;

                const existingMatchResult = await db.select()
                    .from(matches)
                    .where(and(eq(matches.homeTeam, homeTeam), eq(matches.awayTeam, awayTeam)))
                    .limit(1);

                const existingMatch = existingMatchResult[0];

                if (existingMatch) {
                    if (existingMatch.homeScore !== homeScore || existingMatch.awayScore !== awayScore) {
                        const [updatedMatch] = await db.update(matches)
                            .set({ homeScore, awayScore, status: 'live' })
                            .where(eq(matches.id, existingMatch.id))
                            .returning();

                        broadcastMatchUpdate(updatedMatch);
                    }
                } else {
                    const [newMatch] = await db.insert(matches).values({
                        sport: 'Football',
                        homeTeam,
                        awayTeam,
                        status: 'live',
                        homeScore,
                        awayScore,
                    }).returning();

                    broadcastMatchUpdate(newMatch);
                }
            }
        } catch (error) {
            console.error("Error fetching live sports data:", error);
        }
    };

    // 1. Run immediately on server start
    fetchLiveGames();

    // 2. Then run every 60 seconds
    setInterval(fetchLiveGames, 60000);
};