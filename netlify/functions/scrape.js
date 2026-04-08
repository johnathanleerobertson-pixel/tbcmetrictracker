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
            content: "Search the web for the YouTube channel @twobecontinuedhq and find any videos. Also search for the Instagram account @twobecontinuedhq. Report what you find including video titles, view counts, like counts, and follower counts. Return your findings as JSON in this format: {\"posts\":[{\"title\":\"...\",\"platform\":\"youtube\",\"episode\":\"Episode 1\",\"date\":\"2026-04-05\",\"likes\":0,\"commentCount\":0,\"views\":0,\"followerGain\":0}],\"comments\":[],\"accountFollowers\":{\"instagram\":0,\"youtube\":0,\"tiktok\":0,\"instagram_hosts\":0}}"
          }]
        })
      });

      const apiData = await response.json();

      if (apiData.error) {
        return { statusCode: 200, headers, body: JSON.stringify({ debug: "api_error", error: apiData.error }) };
      }

      const allContent = apiData.content || [];
      const texts = allContent.filter(b => b.type === "text").map(b => b.text).join("\n");
      const types = allContent.map(b => b.type);

      // Return raw debug info so we can see everything
      return { statusCode: 200, headers, body: JSON.stringify({ 
        debug: "raw_response",
        contentTypes: types,
        contentCount: allContent.length,
        textLength: texts.length,
        rawText: texts.substring(0, 2000),
        stopReason: apiData.stop_reason
      }) };

    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ debug: "catch", error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: "Method not allowed" };
};
