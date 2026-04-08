 const fetch = require("node-fetch");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  if (event.httpMethod === "GET") {
    return { statusCode: 200, headers, body: JSON.stringify({ posts: [], comments: [], lastUpdated: null }) };
  }

  if (event.httpMethod === "POST") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: "NO KEY" }) };
    }

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 8000,
          tools: [{ type: "web_search_20250305", name: "web_search" }],
          messages: [{
            role: "user",
            content: "Search the web for: \"two be continued\" podcast Delaney Hadley Robertson 2026\n\nThen search for: twobecontinuedhq.com\n\nThen search for: itsdelaneyandhadley instagram\n\nThese are real, public, recently created social media accounts for a new podcast by twin sisters Delaney and Hadley Robertson. Episode 1 features Stringys co-founders Olivia Karina and Elvira Novek Troger.\n\nReport any social media posts, videos, follower counts, likes, views, and comments you find for their YouTube, Instagram, TikTok, and the hosts personal Instagram.\n\nReturn ONLY valid JSON (no markdown, no explanation before or after):\n{\"posts\":[{\"title\":\"...\",\"platform\":\"youtube|instagram|tiktok|instagram_hosts\",\"episode\":\"Episode 1|Trailer|Promo\",\"date\":\"YYYY-MM-DD\",\"likes\":0,\"commentCount\":0,\"views\":0,\"followerGain\":0}],\"comments\":[],\"accountFollowers\":{\"instagram\":0,\"youtube\":0,\"tiktok\":0,\"instagram_hosts\":0}}"
          }]
        })
      });

      const apiData = await response.json();

      if (apiData.error) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: apiData.error.message || "API error" }) };
      }

      const allContent = apiData.content || [];
      const texts = allContent.filter(b => b.type === "text").map(b => b.text).join("\n");

      if (!texts || texts.trim().length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: "No text response" }) };
      }

      const jsonMatch = texts.match(/\{[\s\S]*"posts"[\s\S]*\}/);

      if (!jsonMatch) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: "No JSON found", rawText: texts.substring(0, 2000) }) };
      }

      let scr
