import "dotenv/config";

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
    messages: [{ role: "user", content: "Hello, Claude! Say hi back in one sentence." }],
  }),
});

const data = await response.json();

if (!response.ok) {
  throw new Error(`API error ${response.status}: ${JSON.stringify(data)}`);
}

console.log(data.content[0].text);
