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
      // Step 1: Fetch actual pages directly
      const pages = {};
      const urls = [
        { key: "website", url: "https://twobecontinuedhq.com" },
        { key: "youtube", url: "https://www.youtube.com/@twobecontinuedhq" },
        { key: "tiktok", url: "https://www.tiktok.com/@twobecontinuedhq" }
      ];

      for (const u of urls) {
        try {
          const r = await fetch(u.url, { 
            headers: { "User-Agent": "Mozilla/5.0 (compatible; bot)" },
            timeout: 5000 
          });
          const text = await r.text();
          pages[u.key] = text.substring(0, 3000);
        } catch (e) {
          pages[u.key] = "Failed to fetch: " + e.message;
        }
      }

      // Step 2: Send page content to Claude for parsing (no web search = fast)
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 4000,
          messages: [{
            role: "user",
            content: "I fetched these pages for the \"Two Be Continued\" podcast by Delaney & Hadley Robertson. Extract any social media metrics you can find (video titles, view counts, likes, comments, follower counts, subscriber counts, dates). If a page failed to load or has no useful data, skip it.\n\nWEBSITE (twobecontinuedhq.com):\n" + pages.website + "\n\nYOUTUBE (@twobecontinuedhq):\n" + pages.youtube + "\n\nTIKTOK (@twobecontinuedhq):\n" + pages.tiktok + "\n\nReturn ONLY valid JSON (no markdown, no explanation):\n{\"posts\":[{\"title\":\"...\",\"platform\":\"youtube|instagram|tiktok|instagram_hosts\",\"episode\":\"Episode 1|Trailer|Promo\",\"date\":\"YYYY-MM-DD\",\"likes\":0,\"commentCount\":0,\"views\":0,\"followerGain\":0}],\"comments\":[],\"accountFollowers\":{\"instagram\":0,\"youtube\":0,\"tiktok\":0,\"instagram_hosts\":0}}"
          }]
        })
      });

      const apiData = await response.json();

      if (apiData.error) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: apiData.error.message, debug: "api_error" }) };
      }

      const allContent = apiData.content || [];
      const texts = allContent.filter(b => b.type === "text").map(b => b.text).join("\n");

      if (!texts) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: "No text", debug: "empty", fetchResults: Object.keys(pages).map(k => k + ": " + pages[k].substring(0, 100)) }) };
      }

      const jsonMatch = texts.match(/\{[\s\S]*"posts"[\s\S]*\}/);

      if (!jsonMatch) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: "No JSON", debugRaw: texts.substring(0, 2000) }) };
      }

      let scraped;
      try {
        scraped = JSON.parse(jsonMatch[0].replace(/```json|```/g, "").trim());
      } catch (e) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: "Parse failed", rawText: jsonMatch[0].substring(0, 1000) }) };
      }

      scraped.posts = (scraped.posts || []).map(p => ({
        ...p,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
      }));

      scraped.comments = (scraped.comments || []).map(c => ({
        ...c,
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
        sentiment: "neutral",
        score: 0.5
      }));

      const result = {
        posts: scraped.posts,
        comments: scraped.comments,
        accountFollowers: scraped.accountFollowers || {},
        lastUpdated: new Date().toISOString(),
        lastScraped: new Date().toISOString(),
        debugRaw: texts.substring(0, 1000)
      };

      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: e.message, debug: "catch" }) };
    }
  }

  return { statusCode: 405, headers, body: "Method not allowed" };
};
