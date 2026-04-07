const fetch = require("node-fetch");
const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers, body: "" };
  }

  // GET = return stored data
  if (event.httpMethod === "GET") {
    try {
      const store = getStore("tbc-data");
      const data = await store.get("metrics", { type: "json" });
      return { statusCode: 200, headers, body: JSON.stringify(data || { posts: [], comments: [], lastUpdated: null }) };
    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ posts: [], comments: [], lastUpdated: null }) };
    }
  }

  // POST = scrape and save
  if (event.httpMethod === "POST") {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set in environment" }) };
    }

    try {
      // Call Anthropic API with web search
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
            content: `You are a social media data researcher. Search thoroughly for REAL, ACTUAL engagement data for these social media accounts. Do NOT estimate or guess — only report numbers you actually find. If you cannot find exact numbers, use 0.

Search for EACH account separately:
1. Instagram: @twobecontinuedhq — search "twobecontinuedhq instagram" and "two be continued podcast instagram"
2. YouTube: @twobecontinuedhq — search "twobecontinuedhq youtube" and "two be continued podcast youtube Delaney Hadley"
3. TikTok: @twobecontinuedhq — search "twobecontinuedhq tiktok" and "two be continued podcast tiktok"
4. Instagram: @itsdelaneyandhadley — search "itsdelaneyandhadley instagram" and "Delaney Hadley Robertson instagram"

For each account find:
- Recent posts with titles/descriptions
- Exact like counts, comment counts, view counts per post
- Date each post was published
- Follower counts
- Notable comments (positive or negative)

Tag posts with episodes: "Episode 1" for the Olivia & Elvira / Stringys episode, "Trailer" for intro/trailer, "Promo" for promotional.

CRITICAL: Only report numbers you actually find. Do NOT fabricate.

Return ONLY valid JSON (no markdown, no explanation):
{
  "posts": [{"title":"...","platform":"youtube|instagram|tiktok|instagram_hosts","episode":"Episode 1|Trailer|Promo","date":"YYYY-MM-DD","likes":0,"commentCount":0,"views":0,"followerGain":0}],
  "comments": [{"text":"...","postTitle":"...","author":"...","date":"YYYY-MM-DD"}],
  "accountFollowers": {"instagram":0,"youtube":0,"tiktok":0,"instagram_hosts":0}
}`
          }]
        })
      });

      const apiData = await response.json();
      const texts = (apiData.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
      const jsonMatch = texts.match(/\{[\s\S]*"posts"[\s\S]*\}/);

      let scraped = { posts: [], comments: [] };
      if (jsonMatch) {
        try {
          scraped = JSON.parse(jsonMatch[0].replace(/```json|```/g, "").trim());
        } catch (e) {
          console.error("JSON parse error:", e);
        }
      }

      // Sentiment analysis on comments
      if (scraped.comments && scraped.comments.length > 0) {
        try {
          const sentResponse = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": apiKey,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 1000,
              messages: [{
                role: "user",
                content: `Analyze sentiment. Return ONLY JSON array of {text, sentiment, score}. sentiment: positive|neutral|negative. score: 0-1.\n${JSON.stringify(scraped.comments.map(c => c.text))}`
              }]
            })
          });
          const sentData = await sentResponse.json();
          const sentText = (sentData.content || []).map(i => i.text || "").join("");
          const sentResults = JSON.parse(sentText.replace(/```json|```/g, "").trim());
          scraped.comments = scraped.comments.map((c, i) => ({
            ...c,
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            sentiment: sentResults[i]?.sentiment || "neutral",
            score: sentResults[i]?.score || 0.5
          }));
        } catch (e) {
          scraped.comments = scraped.comments.map(c => ({
            ...c,
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            sentiment: "neutral",
            score: 0.5
          }));
        }
      }

      // Add IDs to posts
      scraped.posts = (scraped.posts || []).map(p => ({
        ...p,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
      }));

      // Load existing data and merge
      const store = getStore("tbc-data");
      let existing = { posts: [], comments: [] };
      try {
        const stored = await store.get("metrics", { type: "json" });
        if (stored) existing = stored;
      } catch {}

      const merged = {
        posts: [...existing.posts, ...scraped.posts],
        comments: [...existing.comments, ...(scraped.comments || [])],
        accountFollowers: scraped.accountFollowers || existing.accountFollowers || {},
        lastUpdated: new Date().toISOString(),
        lastScraped: new Date().toISOString()
      };

      await store.setJSON("metrics", merged);

      return { statusCode: 200, headers, body: JSON.stringify(merged) };
    } catch (e) {
      console.error("Scrape error:", e);
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: "Method not allowed" };
};
