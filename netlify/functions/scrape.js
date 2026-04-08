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
      return { statusCode: 500, headers, body: JSON.stringify({ error: "ANTHROPIC_API_KEY not set" }) };
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
            content: "You are a social media data researcher. Search thoroughly for REAL, ACTUAL engagement data for these social media accounts. Do NOT estimate or guess - only report numbers you actually find. If you cannot find exact numbers, use 0.\n\nSearch for EACH account separately:\n1. Instagram: @twobecontinuedhq - search \"twobecontinuedhq instagram\" and \"two be continued podcast instagram\"\n2. YouTube: @twobecontinuedhq - search \"twobecontinuedhq youtube\" and \"two be continued podcast youtube Delaney Hadley\"\n3. TikTok: @twobecontinuedhq - search \"twobecontinuedhq tiktok\"\n4. Instagram: @itsdelaneyandhadley - search \"itsdelaneyandhadley instagram\" and \"Delaney Hadley Robertson instagram\"\n\nFor each account find:\n- Recent posts with titles/descriptions\n- Exact like counts, comment counts, view counts per post\n- Date each post was published\n- Follower counts\n- Notable comments\n\nTag posts with episodes: \"Episode 1\" for the Olivia & Elvira / Stringys episode, \"Trailer\" for intro/trailer, \"Promo\" for promotional.\n\nCRITICAL: Only report numbers you actually find. Do NOT fabricate.\n\nReturn ONLY valid JSON (no markdown, no explanation):\n{\"posts\":[{\"title\":\"...\",\"platform\":\"youtube|instagram|tiktok|instagram_hosts\",\"episode\":\"Episode 1|Trailer|Promo\",\"date\":\"YYYY-MM-DD\",\"likes\":0,\"commentCount\":0,\"views\":0,\"followerGain\":0}],\"comments\":[{\"text\":\"...\",\"postTitle\":\"...\",\"author\":\"...\",\"date\":\"YYYY-MM-DD\"}],\"accountFollowers\":{\"instagram\":0,\"youtube\":0,\"tiktok\":0,\"instagram_hosts\":0}}"
          }]
        })
      });

      const apiData = await response.json();

      if (apiData.error) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: apiData.error.message || "API error", debug: "api_error" }) };
      }

      const allContent = apiData.content || [];
      const texts = allContent.filter(b => b.type === "text").map(b => b.text).join("\n");

      if (!texts || texts.trim().length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ 
          error: "No text in API response", 
          debug: "no_text",
          contentTypes: allContent.map(b => b.type),
          contentCount: allContent.length
        }) };
      }

      const jsonMatch = texts.match(/\{[\s\S]*"posts"[\s\S]*\}/);

      if (!jsonMatch) {
        return { statusCode: 200, headers, body: JSON.stringify({ 
          error: "No JSON found in response", 
          debug: "no_json",
          rawText: texts.substring(0, 1000)
        }) };
      }

      let scraped;
      try {
        scraped = JSON.parse(jsonMatch[0].replace(/```json|```/g, "").trim());
      } catch (e) {
        return { statusCode: 200, headers, body: JSON.stringify({ 
          error: "JSON parse failed", 
          debug: "parse_fail",
          rawText: jsonMatch[0].substring(0, 1000)
        }) };
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
        lastScraped: new Date().toISOString()
      };

      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: e.message, debug: "catch" }) };
    }
  }

  return { statusCode: 405, headers, body: "Method not allowed" };
};
