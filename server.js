import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use("/vendor/marked", express.static("node_modules/marked/lib"));
app.use("/vendor/dompurify", express.static("node_modules/dompurify/dist"));
app.use("/vendor/jspdf", express.static("node_modules/jspdf/dist"));
app.use("/vendor/supabase", express.static("node_modules/@supabase/supabase-js/dist/umd"));

app.get("/api/config", (req, res) => {
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || "",
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || "",
  });
});

const SYSTEM_PROMPT = `You are a friendly, practical scheduling advisor. The user will describe their day, tasks, deadlines, or goals in a free-form way.

Your job:
- Ask short clarifying questions when key details are missing (durations, deadlines, priorities, fixed-time commitments, energy levels/preferences).
- Don't ask everything at once — ask only what you need to build a realistic schedule.
- Once you have enough information, propose a clear, organized schedule (e.g. a time-blocked list with start/end times).
- Call out conflicts, unrealistic time estimates, or overloaded days, and suggest trade-offs.
- Keep responses concise and scannable — use short lines or a simple time-block list rather than long paragraphs.
- If the user gives a vague goal instead of a schedule (e.g. "I want to get fit"), help them break it into concrete scheduled tasks.

When you present a FINALIZED schedule (the actual final time-blocked plan, not a clarifying question or a draft you're still negotiating), end your reply with a fenced code block labeled "schedule" containing a JSON array of the tasks, like this:

\`\`\`schedule
[{"title": "Study for exam", "time": "9:00 AM - 11:00 AM", "description": "Review chapters 4-6"}, {"title": "Grocery shopping", "time": "2:00 PM - 3:00 PM", "description": ""}]
\`\`\`

Rules for this block:
- Only include it when the schedule is actually finalized and ready to use.
- Do not include it while still asking clarifying questions or proposing a draft.
- Each item needs a short "title", a "time" string (use "" if there is no specific time), and an optional short "description" (use "" if there's nothing extra to add).
- It must be valid JSON. Do not add any text inside the code block other than the JSON array.`;

app.post("/api/chat", async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    res.json({ reply: data.content[0].text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
