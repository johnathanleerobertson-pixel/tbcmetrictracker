const fetch = require("node-fetch");

var YOUTUBE_CHANNEL_HANDLE = "twobecontinuedhq";
var IG_ACCOUNT = "twobecontinuedhq";
var IG_HOSTS_ACCOUNT = "itsdelaneyandhadley";
var TIKTOK_ACCOUNT = "twobecontinuedhq";
var STORAGE_KEY = "tbc-metrics-latest";

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
    for (var j = 0; j < episodes[i].keywords.length; j++) {
      if (tl.includes(episodes[i].keywords[j])) return episodes[i].name;
    }
  }
  return "Promo";
}

async function loadStored(apifyToken) {
  if (!apifyToken) return null;
  try {
    var res = await timeoutFetch("https://api.apify.com/v2/key-value-stores/default/records/" + STORAGE_KEY + "?token=" + apifyToken, {}, 5000);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function saveStored(apifyToken, data) {
  if (!apifyToken) return;
  try {
    await timeoutFetch("https://api.apify.com/v2/key-value-stores/default/records/" + STORAGE_KEY + "?token=" + apifyToken, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }, 5000);
  } catch (e) {}
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

    var episodes = [];
    var episodeNum = 0;
    var sorted = videoDetails.slice().sort(function(a, b) { return new Date(a.snippet.publishedAt) - new Date(b.snippet.publishedAt); });
    for (var v = 0; v < sorted.length; v++) {
      var duration = sorted[v].contentDetails.duration;
      var minutes = 0;
      var hMatch = duration.match(/(\d+)H/);
      var mMatch = duration.match(/(\d+)M/);
      if (hMatch) minutes += parseInt(hMatch[1]) * 60;
      if (mMatch) minutes += parseInt(mMatch[1]);
      if (minutes >= 20) {
        episodeNum++;
        var words = sorted[v].snippet.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(function(w) {
          return w.length > 3 && !["episode", "with", "podcast", "continued", "from", "that", "this", "they", "their", "about", "what", "when", "where", "have", "been", "were", "will", "would", "could", "should", "just", "like", "your", "more", "some", "than", "them", "then", "these", "those", "being", "into", "very", "also", "each", "other"].includes(w);
        });
        episodes.push({ name: "Episode " + episodeNum, keywords: words, title: sorted[v].snippet.title });
      }
    }

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
      if (tl.includes("trailer") || tl.includes("introducing")) { ep = "Trailer"; }
      else if (mins >= 20) { for (var e = 0; e < episodes.length; e++) { if (episodes[e].title === v.snippet.title) { ep = episodes[e].name; break; } } }
      else { ep = detectEpisode(v.snippet.title, episodes); }
      return { id: "yt_" + v.id, title: v.snippet.title, platform: "youtube", episode: ep, date: v.snippet.publishedAt.split("T")[0], likes: parseInt(v.statistics.likeCount || "0", 10), commentCount: parseInt(v.statistics.commentCount || "0", 10), views: parseInt(v.statistics.viewCount || "0", 10), followerGain: 0, url: "https://www.youtube.com/watch?v=" + v.id };
    });

    return { posts: posts, comments: allComments, subscribers: subscriberCount, episodes: episodes };
  } catch (e) { return { posts: [], comments: [], subscribers: 0, episodes: [] }; }
}

async function scrapeInstagramFast(token, username, platformLabel, episodes) {
  if (!token) return { posts: [], followers: 0 };
  try {
    var res = await timeoutFetch("https://api.apify.com/v2/acts/lanky_quantifier~instagram-profile-scraper/run-sync-get-dataset-items?token=" + token + "&timeout=30", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username] })
    }, 35000);
    if (!res.ok) return { posts: [], followers: 0 };
    var items = await res.json();
    if (!Array.isArray(items) || !items.length) return { posts: [], followers: 0 };
    var profile = items[0];
    var followers = profile.followersCount || profile.followers || 0;
    var posts = [];
    var recentPosts = profile.latestPosts || profile.posts || [];
    for (var i = 0; i < recentPosts.length; i++) {
      var p = recentPosts[i];
      var caption = (p.caption || p.text || "").substring(0, 200);
      var title = caption || ("Post " + (i + 1));
      var ep = detectEpisode(title, episodes);
      posts.push({
        id: "ig_" + (p.id || p.shortCode || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        title: title.substring(0, 120),
        platform: platformLabel,
        episode: ep,
        date: p.timestamp ? p.timestamp.split("T")[0] : new Date().toISOString().split("T")[0],
        likes: p.likesCount || p.likes || 0,
        commentCount: p.commentsCount || p.comments || 0,
        views: p.videoViewCount || p.videoPlayCount || p.views || 0,
        followerGain: 0,
        url: p.url || "https://www.instagram.com/p/" + (p.shortCode || "")
      });
    }
    return { posts: posts, followers: followers };
  } catch (e) { return { posts: [], followers: 0 }; }
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

exports.handler = async (event) => {
  var headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: headers, body: "" };

  var apifyToken = process.env.APIFY_API_TOKEN;

  if (event.httpMethod === "GET") {
    var stored = await loadStored(apifyToken);
    return { statusCode: 200, headers: headers, body: JSON.stringify(stored || { posts: [], comments: [], lastUpdated: null }) };
  }

  if (event.httpMethod === "POST") {
    var ytKey = process.env.YOUTUBE_API_KEY;
    try {
      var ytResult = await scrapeYouTube(ytKey);
      var episodes = ytResult.episodes || [];

      var settled = await Promise.allSettled([
        scrapeInstagramFast(apifyToken, IG_ACCOUNT, "instagram", episodes),
        scrapeInstagramFast(apifyToken, IG_HOSTS_ACCOUNT, "instagram_hosts", episodes),
        scrapeTikTok(apifyToken, TIKTOK_ACCOUNT, episodes)
      ]);

      var igResult = settled[0].status === "fulfilled" ? settled[0].value : { posts: [], followers: 0 };
      var igHostsResult = settled[1].status === "fulfilled" ? settled[1].value : { posts: [], followers: 0 };
      var ttResult = settled[2].status === "fulfilled" ? settled[2].value : { posts: [], followers: 0 };

      var result = {
        posts: [].concat(ytResult.posts, igResult.posts, igHostsResult.posts, ttResult.posts),
        comments: ytResult.comments || [],
        accountFollowers: { youtube: ytResult.subscribers, instagram: igResult.followers, tiktok: ttResult.followers, instagram_hosts: igHostsResult.followers },
        lastUpdated: new Date().toISOString(),
        lastScraped: new Date().toISOString(),
        episodes: episodes.map(function(e) { return { name: e.name, title: e.title }; }),
        debug: { yt: ytResult.posts.length, ig: igResult.posts.length, igH: igHostsResult.posts.length, tt: ttResult.posts.length }
      };

      await saveStored(apifyToken, result);
      return { statusCode: 200, headers: headers, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 200, headers: headers, body: JSON.stringify({ error: e.message }) };
    }
  }
  return { statusCode: 405, headers: headers, body: "Method not allowed" };
};
