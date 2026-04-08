 const fetch = require("node-fetch");

const YOUTUBE_CHANNEL_HANDLE = "twobecontinuedhq";

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
    const ytKey = process.env.YOUTUBE_API_KEY;
    if (!ytKey) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: "YOUTUBE_API_KEY not set" }) };
    }

    try {
      const handleRes = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=" + YOUTUBE_CHANNEL_HANDLE + "&key=" + ytKey
      );
      const handleData = await handleRes.json();

      if (handleData.error) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: handleData.error.message }) };
      }

      let channelId = null;
      let subscriberCount = 0;

      if (handleData.items && handleData.items.length > 0) {
        channelId = handleData.items[0].id;
        subscriberCount = parseInt(handleData.items[0].statistics.subscriberCount || "0", 10);
      }

      if (!channelId) {
        const searchRes = await fetch(
          "https://www.googleapis.com/youtube/v3/search?part=snippet&q=" + YOUTUBE_CHANNEL_HANDLE + "&type=channel&key=" + ytKey
        );
        const searchData = await searchRes.json();
        if (searchData.items && searchData.items.length > 0) {
          channelId = searchData.items[0].snippet.channelId;
        }
      }

      if (!channelId) {
        return { statusCode: 200, headers, body: JSON.stringify({ error: "Channel not found" }) };
      }

      const videosRes = await fetch(
        "https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=" + channelId + "&type=video&order=date&maxResults=50&key=" + ytKey
      );
      const videosData = await videosRes.json();
      const videoItems = videosData.items || [];

      if (videoItems.length === 0) {
        return { statusCode: 200, headers, body: JSON.stringify({
          posts: [],
          comments: [],
          accountFollowers: { youtube: subscriberCount, instagram: 0, tiktok: 0, instagram_hosts: 0 },
          lastUpdated: new Date().toISOString(),
          lastScraped: new Date().toISOString()
        }) };
      }

      const videoIds = videoItems.map(function(v) { return v.id.videoId; }).join(",");
      const statsRes = await fetch(
        "https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=" + videoIds + "&key=" + ytKey
      );
      const statsData = await statsRes.json();
      const videoDetails = statsData.items || [];

      var allComments = [];
      for (var i = 0; i < Math.min(videoDetails.length, 5); i++) {
        var video = videoDetails[i];
        try {
          var commentsRes = await fetch(
            "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=" + video.id + "&maxResults=20&order=relevance&key=" + ytKey
          );
          var commentsData = await commentsRes.json();
          var threads = commentsData.items || [];
          for (var j = 0; j < threads.length; j++) {
            var c = threads[j].snippet.topLevelComment.snippet;
            allComments.push({
              id: threads[j].id,
              text: c.textDisplay,
              author: c.authorDisplayName,
              date: c.publishedAt.split("T")[0],
              postTitle: video.snippet.title,
              sentiment: "neutral",
              score: 0.5
            });
          }
        } catch (e) {}
      }

      var posts = videoDetails.map(function(v) {
        var title = v.snippet.title.toLowerCase();
        var episode = "Promo";
        if (title.includes("episode 1") || title.includes("ep 1") || title.includes("ep1") || title.includes("olivia") || title.includes("elvira") || title.includes("stringy")) {
          episode = "Episode 1";
        } else if (title.includes("episode 2") || title.includes("ep 2") || title.includes("ep2")) {
          episode = "Episode 2";
        } else if (title.includes("trailer") || title.includes("introducing")) {
          episode = "Trailer";
        }
        return {
          id: v.id,
          title: v.snippet.title,
          platform: "youtube",
          episode: episode,
          date: v.snippet.publishedAt.split("T")[0],
          likes: parseInt(v.statistics.likeCount || "0", 10),
          commentCount: parseInt(v.statistics.commentCount || "0", 10),
          views: parseInt(v.statistics.viewCount || "0", 10),
          followerGain: 0,
          url: "https://www.youtube.com/watch?v=" + v.id
        };
      });

      var anthropicKey = process.env.ANTHROPIC_API_KEY;
      if (anthropicKey && allComments.length > 0) {
        try {
          var sentRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": anthropicKey,
              "anthropic-version": "2023-06-01"
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 2000,
              messages: [{
                role: "user",
                content: "Analyze sentiment of these comments. Return ONLY a JSON array of {index, sentiment, score}. sentiment: positive|neutral|negative. score: 0.0-1.0.\n\n" + JSON.stringify(allComments.map(function(c, i) { return { index: i, text: c.text }; }))
              }]
            })
          });
          var sentData = await sentRes.json();
          var sentText = (sentData.content || []).map(function(i) { return i.text || ""; }).join("");
          var sentResults = JSON.parse(sentText.replace(/```json|```/g, "").trim());
          for (var k = 0; k < sentResults.length; k++) {
            if (allComments[sentResults[k].index]) {
              allComments[sentResults[k].index].sentiment = sentResults[k].sentiment;
              allComments[sentResults[k].index].score = sentResults[k].score;
            }
          }
        } catch (e) {}
      }

      var result = {
        posts: posts,
        comments: allComments,
        accountFollowers: {
          youtube: subscriberCount,
          instagram: 0,
          tiktok: 0,
          instagram_hosts: 0
        },
        lastUpdated: new Date().toISOString(),
        lastScraped: new Date().toISOString()
      };

      return { statusCode: 200, headers, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 200, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: "Method not allowed" };
};
