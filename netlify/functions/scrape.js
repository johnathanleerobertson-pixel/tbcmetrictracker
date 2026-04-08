const fetch = require("node-fetch");

const YOUTUBE_CHANNEL_HANDLE = "twobecontinuedhq";
const IG_ACCOUNT = "twobecontinuedhq";
const IG_HOSTS_ACCOUNT = "itsdelaneyandhadley";
const TIKTOK_ACCOUNT = "twobecontinuedhq";

async function scrapeYouTube(ytKey) {
  if (!ytKey) return { posts: [], comments: [], subscribers: 0 };
  try {
    var handleRes = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=" + YOUTUBE_CHANNEL_HANDLE + "&key=" + ytKey);
    var handleData = await handleRes.json();
    if (handleData.error || !handleData.items || !handleData.items.length) return { posts: [], comments: [], subscribers: 0 };

    var channelId = handleData.items[0].id;
    var subscriberCount = parseInt(handleData.items[0].statistics.subscriberCount || "0", 10);

    var videosRes = await fetch("https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=" + channelId + "&type=video&order=date&maxResults=50&key=" + ytKey);
    var videosData = await videosRes.json();
    var videoItems = videosData.items || [];
    if (!videoItems.length) return { posts: [], comments: [], subscribers: subscriberCount };

    var videoIds = videoItems.map(function(v) { return v.id.videoId; }).join(",");
    var statsRes = await fetch("https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=" + videoIds + "&key=" + ytKey);
    var statsData = await statsRes.json();
    var videoDetails = statsData.items || [];

    var allComments = [];
    for (var i = 0; i < Math.min(videoDetails.length, 5); i++) {
      try {
        var commentsRes = await fetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=" + videoDetails[i].id + "&maxResults=20&order=relevance&key=" + ytKey);
        var commentsData = await commentsRes.json();
        var threads = commentsData.items || [];
        for (var j = 0; j < threads.length; j++) {
          var c = threads[j].snippet.topLevelComment.snippet;
          allComments.push({ id: threads[j].id, text: c.textDisplay, author: c.authorDisplayName, date: c.publishedAt.split("T")[0], postTitle: videoDetails[i].snippet.title, platform: "youtube", sentiment: "neutral", score: 0.5 });
        }
      } catch (e) {}
    }

    var posts = videoDetails.map(function(v) {
      var title = v.snippet.title.toLowerCase();
      var episode = "Promo";
      if (title.includes("episode 1") || title.includes("ep 1") || title.includes("olivia") || title.includes("elvira") || title.includes("stringy")) episode = "Episode 1";
      else if (title.includes("episode 2") || title.includes("ep 2")) episode = "Episode 2";
      else if (title.includes("trailer") || title.includes("introducing")) episode = "Trailer";
      return { id: "yt_" + v.id, title: v.snippet.title, platform: "youtube", episode: episode, date: v.snippet.publishedAt.split("T")[0], likes: parseInt(v.statistics.likeCount || "0", 10), commentCount: parseInt(v.statistics.commentCount || "0", 10), views: parseInt(v.statistics.viewCount || "0", 10), followerGain: 0, url: "https://www.youtube.com/watch?v=" + v.id };
    });

    return { posts: posts, comments: allComments, subscribers: subscriberCount };
  } catch (e) { return { posts: [], comments: [], subscribers: 0 }; }
}

async function runApifyActor(token, actorId, input) {
  try {
    var runRes = await fetch("https://api.apify.com/v2/acts/" + actorId + "/run-sync-get-dataset-items?token=" + token, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      timeout: 50000
    });
    if (!runRes.ok) return [];
    var data = await runRes.json();
    return Array.isArray(data) ? data : [];
  } catch (e) { return []; }
}

async function scrapeInstagram(token, username, platformLabel) {
  if (!token) return { posts: [], followers: 0 };
  try {
    var items = await runApifyActor(token, "apify~instagram-scraper", {
      directUrls: ["https://www.instagram.com/" + username + "/"],
      resultsType: "posts",
      resultsLimit: 30,
      searchType: "hashtag",
      searchLimit: 1
    });

    var followers = 0;
    var posts = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.followersCount) followers = item.followersCount;
      if (item.likesCount !== undefined || item.caption) {
        var caption = (item.caption || item.alt || "").substring(0, 120);
        var title = caption || ("Post " + (i + 1));
        var titleLower = title.toLowerCase();
        var episode = "Promo";
        if (titleLower.includes("episode 1") || titleLower.includes("ep 1") || titleLower.includes("olivia") || titleLower.includes("elvira") || titleLower.includes("stringy")) episode = "Episode 1";
        else if (titleLower.includes("episode 2") || titleLower.includes("ep 2")) episode = "Episode 2";
        else if (titleLower.includes("trailer") || titleLower.includes("introducing")) episode = "Trailer";

        posts.push({
          id: "ig_" + (item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
          title: title,
          platform: platformLabel,
          episode: episode,
          date: item.timestamp ? item.timestamp.split("T")[0] : new Date().toISOString().split("T")[0],
          likes: item.likesCount || 0,
          commentCount: item.commentsCount || 0,
          views: item.videoViewCount || item.videoPlayCount || 0,
          followerGain: 0,
          url: item.url || "https://www.instagram.com/" + username + "/"
        });
      }
    }
    return { posts: posts, followers: followers };
  } catch (e) { return { posts: [], followers: 0 }; }
}

async function scrapeTikTok(token, username) {
  if (!token) return { posts: [], followers: 0 };
  try {
    var items = await runApifyActor(token, "clockworks~tiktok-scraper", {
      profiles: ["https://www.tiktok.com/@" + username],
      resultsPerPage: 30,
      shouldDownloadVideos: false
    });

    var followers = 0;
    var posts = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.authorMeta && item.authorMeta.fans) followers = item.authorMeta.fans;
      var caption = (item.text || item.desc || "").substring(0, 120);
      var title = caption || ("TikTok " + (i + 1));
      var titleLower = title.toLowerCase();
      var episode = "Promo";
      if (titleLower.includes("episode 1") || titleLower.includes("ep 1") || titleLower.includes("olivia") || titleLower.includes("elvira") || titleLower.includes("stringy")) episode = "Episode 1";
      else if (titleLower.includes("episode 2") || titleLower.includes("ep 2")) episode = "Episode 2";
      else if (titleLower.includes("trailer") || titleLower.includes("introducing")) episode = "Trailer";

      posts.push({
        id: "tt_" + (item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        title: title,
        platform: "tiktok",
        episode: episode,
        date: item.createTimeISO ? item.createTimeISO.split("T")[0] : new Date().toISOString().split("T")[0],
        likes: item.diggCount || item.likesCount || 0,
        commentCount: item.commentCount || item.commentsCount || 0,
        views: item.playCount || item.videoViewCount || 0,
        followerGain: 0,
        url: item.webVideoUrl || "https://www.tiktok.com/@" + username
      });
    }
    return { posts: posts, followers: followers };
  } catch (e) { return { posts: [], followers: 0 }; }
}

exports.handler = async (event) => {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: headers, body: "" };

  if (event.httpMethod === "GET") {
    return { statusCode: 200, headers: headers, body: JSON.stringify({ posts: [], comments: [], lastUpdated: null }) };
  }

  if (event.httpMethod === "POST") {
    var ytKey = process.env.YOUTUBE_API_KEY;
    var apifyToken = process.env.APIFY_API_TOKEN;
    var anthropicKey = process.env.ANTHROPIC_API_KEY;

    try {
      // Run all scrapers in parallel
      var results = await Promise.all([
        scrapeYouTube(ytKey),
        scrapeInstagram(apifyToken, IG_ACCOUNT, "instagram"),
        scrapeInstagram(apifyToken, IG_HOSTS_ACCOUNT, "instagram_hosts"),
        scrapeTikTok(apifyToken, TIKTOK_ACCOUNT)
      ]);

      var ytResult = results[0];
      var igResult = results[1];
      var igHostsResult = results[2];
      var ttResult = results[3];

      var allPosts = [].concat(ytResult.posts, igResult.posts, igHostsResult.posts, ttResult.posts);
      var allComments = ytResult.comments || [];

      // Sentiment analysis on YouTube comments
      if (anthropicKey && allComments.length > 0) {
        try {
          var sentRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514", max_tokens: 2000,
              messages: [{ role: "user", content: "Analyze sentiment. Return ONLY JSON array of {index, sentiment, score}. sentiment: positive|neutral|negative. score: 0-1.\n\n" + JSON.stringify(allComments.map(function(c, i) { return { index: i, text: c.text }; })) }]
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
        posts: allPosts,
        comments: allComments,
        accountFollowers: {
          youtube: ytResult.subscribers,
          instagram: igResult.followers,
          tiktok: ttResult.followers,
          instagram_hosts: igHostsResult.followers
        },
        lastUpdated: new Date().toISOString(),
        lastScraped: new Date().toISOString()
      };

      return { statusCode: 200, headers: headers, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 200, headers: headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers: headers, body: "Method not allowed" };
};
