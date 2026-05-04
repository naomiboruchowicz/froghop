import { supabase } from "./_supabase.js";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const { data, error } = await supabase
    .from("froghop_sessions")
    .insert({})
    .select("id")
    .single();

  if (error) {
    return res.status(500).json({ error: "session_create_failed" });
  }

  return res.status(200).json({ sessionId: data.id });
}
