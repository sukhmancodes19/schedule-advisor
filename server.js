import "dotenv/config";
import express from "express";

const app = express();
app.use(express.json());
app.use(express.static("public"));
app.use("/vendor/marked", express.static("node_modules/marked/lib"));
app.use("/vendor/dompurify", express.static("node_modules/dompurify/dist"));
app.use("/vendor/jspdf", express.static("node_modules/jspdf/dist"));
app.use("/vendor/supabase", express.static("node_modules/@supabase/supabase-js/dist/umd"));
app.use("/vendor/quicksand", express.static("node_modules/@fontsource/quicksand/files"));

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
- The fence must start with exactly \`\`\`schedule — never \`\`\`json, \`\`\`javascript, or a plain \`\`\` fence.
- Each item needs a short "title", a "time" string (use "" if there is no specific time), and an optional short "description" (use "" if there's nothing extra to add).
- It must be valid, complete JSON — the array must be fully closed with \`]\` before the closing fence. If the schedule covers multiple days (e.g. weekday + weekend), still output ONE single combined JSON array containing all items from every day.
- Keep the prose before the code block brief so the JSON block itself never gets cut off.
- It must be valid JSON. Do not add any text inside the code block other than the JSON array.`;

function buildSystemPrompt(preferences) {
  if (!preferences || typeof preferences !== "object") return SYSTEM_PROMPT;

  const lines = [];
  if (preferences.sleep) lines.push(`- Wake/sleep schedule: ${preferences.sleep}`);
  if (preferences.work) lines.push(`- Work/study routine: ${preferences.work}`);
  if (preferences.commitments) lines.push(`- Recurring commitments: ${preferences.commitments}`);
  if (preferences.notes) lines.push(`- Planning preferences: ${preferences.notes}`);

  if (lines.length === 0) return SYSTEM_PROMPT;

  return `${SYSTEM_PROMPT}

The user has shared this context about their routine — use it when planning or discussing their schedule, without needing to ask again:
${lines.join("\n")}`;
}

const TOOLS = [
  {
    name: "generate_schedule_pdf",
    description:
      "Generate and download a PDF of the user's current schedule. Call this when the user explicitly asks to see, generate, export, or download their schedule as a PDF.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "show_kanban_board",
    description:
      "Show the Kanban/Trello-style board view of the user's schedule. Call this when the user asks to see, switch to, or open the Kanban or board view.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "show_calendar",
    description:
      "Show the Calendar view of the user's schedule. Call this when the user asks to see, switch to, or open the Calendar view.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
];

const TOOL_NAME_TO_ACTION = {
  generate_schedule_pdf: "pdf",
  show_kanban_board: "board",
  show_calendar: "calendar",
};

app.post("/api/chat", async (req, res) => {
  const { messages, preferences } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  try {
    const system = buildSystemPrompt(preferences);

    const callAnthropic = (msgs) =>
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 4096,
          system,
          tools: TOOLS,
          messages: msgs,
        }),
      });

    const response = await callAnthropic(messages);
    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({ error: data });
    }

    const textParts = (data.content || [])
      .filter((block) => block.type === "text")
      .map((block) => block.text);
    const actions = new Set();

    if (data.stop_reason === "tool_use") {
      const toolUseBlocks = data.content.filter((block) => block.type === "tool_use");
      toolUseBlocks.forEach((block) => {
        const action = TOOL_NAME_TO_ACTION[block.name];
        if (action) actions.add(action);
      });

      const followUpMessages = [
        ...messages,
        { role: "assistant", content: data.content },
        {
          role: "user",
          content: toolUseBlocks.map((block) => ({
            type: "tool_result",
            tool_use_id: block.id,
            content: "Done.",
          })),
        },
      ];

      const followUpResponse = await callAnthropic(followUpMessages);
      const followUpData = await followUpResponse.json();

      if (!followUpResponse.ok) {
        return res.status(followUpResponse.status).json({ error: followUpData });
      }

      textParts.push(
        ...(followUpData.content || [])
          .filter((block) => block.type === "text")
          .map((block) => block.text)
      );
    }

    res.json({ reply: textParts.join("\n\n").trim(), actions: [...actions] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
