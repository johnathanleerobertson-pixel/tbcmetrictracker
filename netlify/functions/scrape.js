const fetch = require("node-fetch");
const { getStore } = require("@netlify/blobs");

var YOUTUBE_CHANNEL_HANDLE = "twobecontinuedhq";
var IG_ACCOUNT = "twobecontinuedhq";
var IG_HOSTS_ACCOUNT = "itsdelaneyandhadley";
var TIKTOK_ACCOUNT = "twobecontinuedhq";

function timeoutFetch(url, options, ms) {
  return Promise.race([
    fetch(url, options),
    new Promise(function(_, reject) { setTimeout(function() { reject(new Error("timeout")); }, ms); })
  ]);
}

function detectEpisode(title, episodes) {
  if (!title) return "Promo";
  var tl = title.toLowerCase();
  if (tl.includes("trailer") || tl.includes("introducing")) return "Trailer";
  for (var i = 0; i < episodes.length; i++) {
    var ep = episodes[i];
    for (var j = 0; j < ep.keywords.length; j++) {
      if (tl.includes(ep.keywords[j])) return ep.name;
    }
  }
  return "Promo";
}

async function scrapeYouTube(ytKey) {
  if (!ytKey) return { posts: [], comments: [], subscribers: 0, episodes: [] };
  try {
    var handleRes = await timeoutFetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=" + YOUTUBE_CHANNEL_HANDLE + "&key=" + ytKey, {}, 8000);
    var handleData = await handleRes.json();
    if (!handleData.items || !handleData.items.length) return { posts: [], comments: [], subscribers: 0, episodes: [] };
    var channelId = handleData.items[0].id;
    var subscriberCount = parseInt(handleData.items[0].statistics.subscriberCount || "0", 10);

    var videosRes = await timeoutFetch("https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=" + channelId + "&type=video&order=date&maxResults=50&key=" + ytKey, {}, 8000);
    var videosData = await videosRes.json();
    var videoItems = videosData.items || [];
    if (!videoItems.length) return { posts: [], comments: [], subscribers: subscriberCount, episodes: [] };

    var videoIds = videoItems.map(function(v) { return v.id.videoId; }).join(",");
    var statsRes = await timeoutFetch("https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=" + videoIds + "&key=" + ytKey, {}, 8000);
    var statsData = await statsRes.json();
    var videoDetails = statsData.items || [];

    // Detect episodes: YouTube videos longer than 20 minutes
    var episodes = [];
    var episodeNum = 0;
    // Sort by date ascending to number episodes correctly
    var sorted = videoDetails.slice().sort(function(a, b) {
      return new Date(a.snippet.publishedAt) - new Date(b.snippet.publishedAt);
    });
    for (var v = 0; v < sorted.length; v++) {
      var duration = sorted[v].contentDetails.duration; // ISO 8601 e.g. PT25M30S
      var minutes = 0;
      var hMatch = duration.match(/(\d+)H/);
      var mMatch = duration.match(/(\d+)M/);
      if (hMatch) minutes += parseInt(hMatch[1]) * 60;
      if (mMatch) minutes += parseInt(mMatch[1]);
      if (minutes >= 20) {
        episodeNum++;
        // Extract keywords from the title for cross-platform matching
        var title = sorted[v].snippet.title.toLowerCase();
        var words = title.replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(function(w) {
          return w.length > 3 && !["episode", "with", "podcast", "continued", "from", "that", "this", "they", "their", "about", "what", "when", "where", "have", "been", "were", "will", "would", "could", "should", "just", "like", "your", "more", "some", "than", "them", "then", "these", "those", "being", "into", "very", "also", "each", "other"].includes(w);
        });
        episodes.push({ name: "Episode " + episodeNum, keywords: words, title: sorted[v].snippet.title });
      }
    }

    // Build posts with correct episode tags
    var allComments = [];
    for (var i = 0; i < Math.min(videoDetails.length, 3); i++) {
      try {
        var cr = await timeoutFetch("https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=" + videoDetails[i].id + "&maxResults=10&order=relevance&key=" + ytKey, {}, 5000);
        var cd = await cr.json();
        var threads = cd.items || [];
        for (var j = 0; j < threads.length; j++) {
          var c = threads[j].snippet.topLevelComment.snippet;
          allComments.push({ id: threads[j].id, text: c.textDisplay, author: c.authorDisplayName, date: c.publishedAt.split("T")[0], postTitle: videoDetails[i].snippet.title, platform: "youtube", sentiment: "neutral", score: 0.5 });
        }
      } catch (e) {}
    }

    var posts = videoDetails.map(function(v) {
      var dur = v.contentDetails.duration;
      var mins = 0;
      var hM = dur.match(/(\d+)H/);
      var mM = dur.match(/(\d+)M/);
      if (hM) mins += parseInt(hM[1]) * 60;
      if (mM) mins += parseInt(mM[1]);

      var ep = "Promo";
      var tl = v.snippet.title.toLowerCase();
      if (tl.includes("trailer") || tl.includes("introducing")) {
        ep = "Trailer";
      } else if (mins >= 20) {
        // This IS an episode - find which one
        for (var e = 0; e < episodes.length; e++) {
          if (episodes[e].title === v.snippet.title) { ep = episodes[e].name; break; }
        }
      } else {
        // Short video - match to an episode by keywords
        ep = detectEpisode(v.snippet.title, episodes);
      }

      return { id: "yt_" + v.id, title: v.snippet.title, platform: "youtube", episode: ep, date: v.snippet.publishedAt.split("T")[0], likes: parseInt(v.statistics.likeCount || "0", 10), commentCount: parseInt(v.statistics.commentCount || "0", 10), views: parseInt(v.statistics.viewCount || "0", 10), followerGain: 0, url: "https://www.youtube.com/watch?v=" + v.id };
    });

    return { posts: posts, comments: allComments, subscribers: subscriberCount, episodes: episodes };
  } catch (e) { return { posts: [], comments: [], subscribers: 0, episodes: [] }; }
}

async function scrapeApifyProfile(token, url, ms) {
  try {
    var res = await timeoutFetch("https://api.apify.com/v2/acts/apify~instagram-scraper/run-sync-get-dataset-items?token=" + token + "&timeout=15", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directUrls: [url], resultsType: "posts", resultsLimit: 20, searchLimit: 1 })
    }, ms);
    if (!res.ok) return [];
    return await res.json();
  } catch (e) { return []; }
}

function parseIgPosts(items, platformLabel, username, episodes) {
  var followers = 0;
  var posts = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.followersCount) followers = item.followersCount;
    if (item.likesCount !== undefined || item.caption) {
      var caption = (item.caption || item.alt || "").substring(0, 200);
      var title = caption || ("Post " + (i + 1));
      var ep = detectEpisode(title, episodes);
      posts.push({ id: "ig_" + (item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), title: title.substring(0, 120), platform: platformLabel, episode: ep, date: item.timestamp ? item.timestamp.split("T")[0] : new Date().toISOString().split("T")[0], likes: item.likesCount || 0, commentCount: item.commentsCount || 0, views: item.videoViewCount || item.videoPlayCount || 0, followerGain: 0, url: item.url || "https://www.instagram.com/" + username + "/" });
    }
  }
  return { posts: posts, followers: followers };
}

async function scrapeTikTok(token, username, episodes) {
  if (!token) return { posts: [], followers: 0 };
  try {
    var res = await timeoutFetch("https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=" + token + "&timeout=15", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profiles: ["https://www.tiktok.com/@" + username], resultsPerPage: 20, shouldDownloadVideos: false })
    }, 20000);
    if (!res.ok) return { posts: [], followers: 0 };
    var items = await res.json();
    if (!Array.isArray(items)) return { posts: [], followers: 0 };
    var followers = 0;
    var posts = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.authorMeta && item.authorMeta.fans) followers = item.authorMeta.fans;
      var caption = (item.text || item.desc || "").substring(0, 200);
      var title = caption || ("TikTok " + (i + 1));
      var ep = detectEpisode(title, episodes);
      posts.push({ id: "tt_" + (item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), title: title.substring(0, 120), platform: "tiktok", episode: ep, date: item.createTimeISO ? item.createTimeISO.split("T")[0] : new Date().toISOString().split("T")[0], likes: item.diggCount || item.likesCount || 0, commentCount: item.commentCount || item.commentsCount || 0, views: item.playCount || item.videoViewCount || 0, followerGain: 0, url: item.webVideoUrl || "https://www.tiktok.com/@" + username });
    }
    return { posts: posts, followers: followers };
  } catch (e) { return { posts: [], followers: 0 }; }
}

async function loadStored() {
  try {
    var store = getStore("tbc-data");
    var data = await store.get("metrics", { type: "json" });
    return data || null;
  } catch (e) { return null; }
}

async function saveData(data) {
  try {
    var store = getStore("tbc-data");
    await store.setJSON("metrics", data);
  } catch (e) { console.log("Save error:", e.message); }
}

exports.handler = async (event) => {
  var headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: headers, body: "" };

  // GET returns stored data so all devices see same thing
  if (event.httpMethod === "GET") {
    var stored = await loadStored();
    return { statusCode: 200, headers: headers, body: JSON.stringify(stored || { posts: [], comments: [], lastUpdated: null }) };
  }

  if (event.httpMethod === "POST") {
    var ytKey = process.env.YOUTUBE_API_KEY;
    var apifyToken = process.env.APIFY_API_TOKEN;

    try {
      // Step 1: Scrape YouTube first to get episode definitions
      var ytResult = await scrapeYouTube(ytKey);
      var episodes = ytResult.episodes || [];

      // Step 2: Scrape IG and TikTok in parallel, using episode keywords for tagging
      var settled = await Promise.allSettled([
        apifyToken ? scrapeApifyProfile(apifyToken, "https://www.instagram.com/" + IG_ACCOUNT + "/", 20000).then(function(items) { return parseIgPosts(items, "instagram", IG_ACCOUNT, episodes); }) : Promise.resolve({ posts: [], followers: 0 }),
        apifyToken ? scrapeApifyProfile(apifyToken, "https://www.instagram.com/" + IG_HOSTS_ACCOUNT + "/", 20000).then(function(items) { return parseIgPosts(items, "instagram_hosts", IG_HOSTS_ACCOUNT, episodes); }) : Promise.resolve({ posts: [], followers: 0 }),
        apifyToken ? scrapeTikTok(apifyToken, TIKTOK_ACCOUNT, episodes) : Promise.resolve({ posts: [], followers: 0 })
      ]);

      var igResult = settled[0].status === "fulfilled" ? settled[0].value : { posts: [], followers: 0 };
      var igHostsResult = settled[1].status === "fulfilled" ? settled[1].value : { posts: [], followers: 0 };
      var ttResult = settled[2].status === "fulfilled" ? settled[2].value : { posts: [], followers: 0 };

      var allPosts = [].concat(ytResult.posts, igResult.posts, igHostsResult.posts, ttResult.posts);
      var allComments = ytResult.comments || [];

      var result = {
        posts: allPosts,
        comments: allComments,
        accountFollowers: { youtube: ytResult.subscribers, instagram: igResult.followers, tiktok: ttResult.followers, instagram_hosts: igHostsResult.followers },
        lastUpdated: new Date().toISOString(),
        lastScraped: new Date().toISOString(),
        episodes: episodes.map(function(e) { return { name: e.name, title: e.title }; }),
        debug: { yt: ytResult.posts.length, ig: igResult.posts.length, igH: igHostsResult.posts.length, tt: ttResult.posts.length }
      };

      // Save to Netlify Blobs so all devices see the same data
      await saveData(result);

      return { statusCode: 200, headers: headers, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 200, headers: headers, body: JSON.stringify({ error: e.message }) };
    }
  }
  return { statusCode: 405, headers: headers, body: "Method not allowed" };
};
