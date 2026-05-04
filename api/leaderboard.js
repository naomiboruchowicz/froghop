import { supabase } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const username = typeof req.query.username === "string" ? req.query.username.trim().slice(0, 12) : null;

  const [topRes, rankRes] = await Promise.all([
    supabase.rpc("get_top_leaderboard", { limit_count: 10 }),
    username ? supabase.rpc("get_user_rank", { uname: username }) : Promise.resolve({ data: null, error: null }),
  ]);

  if (topRes.error) {
    return res.status(500).json({ error: "leaderboard_fetch_failed" });
  }

  // Rank can be null (no submissions for that user) or an int
  let userRank = null;
  if (!rankRes.error && rankRes.data !== null && rankRes.data !== undefined) {
    userRank = typeof rankRes.data === "number" ? rankRes.data : null;
  }

  res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=30");
  return res.status(200).json({ entries: topRes.data ?? [], userRank });
}
