import { supabase } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { data, error } = await supabase.rpc("get_top_leaderboard", { limit_count: 10 });

  if (error) {
    return res.status(500).json({ error: "leaderboard_fetch_failed" });
  }

  res.setHeader("Cache-Control", "public, max-age=10, stale-while-revalidate=30");
  return res.status(200).json({ entries: data ?? [] });
}
