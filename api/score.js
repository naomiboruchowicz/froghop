import { supabase } from "./_supabase.js";

const SCORE_PER_SECOND = 20;
const MAX_USERNAME_LEN = 12;
const MAX_SCORE = 1_000_000;

function sanitizeUsername(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().slice(0, MAX_USERNAME_LEN);
  if (trimmed.length === 0) return null;
  return trimmed;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { sessionId, score, username } = req.body ?? {};

  const cleanName = sanitizeUsername(username);
  if (!cleanName) return res.status(400).json({ error: "invalid_username" });

  const numScore = Math.floor(Number(score));
  if (!Number.isFinite(numScore) || numScore < 0 || numScore > MAX_SCORE) {
    return res.status(400).json({ error: "invalid_score" });
  }

  if (typeof sessionId !== "string" || sessionId.length < 16) {
    return res.status(400).json({ error: "invalid_session" });
  }

  const { data: session, error: sessionErr } = await supabase
    .from("froghop_sessions")
    .select("id, started_at, submitted")
    .eq("id", sessionId)
    .maybeSingle();

  if (sessionErr) return res.status(500).json({ error: "session_lookup_failed" });
  if (!session) return res.status(404).json({ error: "session_not_found" });
  if (session.submitted) return res.status(409).json({ error: "session_already_used" });

  const elapsedMs = Date.now() - new Date(session.started_at).getTime();
  const minElapsedMs = (numScore / SCORE_PER_SECOND) * 1000;
  if (elapsedMs < minElapsedMs) {
    return res.status(400).json({ error: "score_too_high_for_elapsed_time" });
  }

  const { error: insertErr } = await supabase
    .from("froghop_scores")
    .insert({ username: cleanName, score: numScore });
  if (insertErr) return res.status(500).json({ error: "score_insert_failed" });

  await supabase
    .from("froghop_sessions")
    .update({ submitted: true })
    .eq("id", sessionId);

  return res.status(200).json({ ok: true, username: cleanName, score: numScore });
}
