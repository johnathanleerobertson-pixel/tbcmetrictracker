const fetch = require("node-fetch");

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

async function scrapeYouTube(ytKey) {
  if (!ytKey) return { posts: [], comments: [], subscribers: 0 };
  try {
    var handleRes = await timeoutFetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=" + YOUTUBE_CHANNEL_HANDLE + "&key=" + ytKey, {}, 8000);
    var handleData = await handleRes.json();
    if (!handleData.items || !handleData.items.length) return { posts: [], comments: [], subscribers: 0 };
    var channelId = handleData.items[0].id;
    var subscriberCount = parseInt(handleData.items[0].statistics.subscriberCount || "0", 10);
    var videosRes = await timeoutFetch("https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=" + channelId + "&type=video&order=date&maxResults=50&key=" + ytKey, {}, 8000);
    var videosData = await videosRes.json();
    var videoItems = videosData.items || [];
    if (!videoItems.length) return { posts: [], comments: [], subscribers: subscriberCount };
    var videoIds = videoItems.map(function(v) { return v.id.videoId; }).join(",");
    var statsRes = await timeoutFetch("https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet&id=" + videoIds + "&key=" + ytKey, {}, 8000);
    var statsData = await statsRes.json();
    var videoDetails = statsData.items || [];
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
      var t = v.snippet.title.toLowerCase();
      var ep = "Promo";
      if (t.includes("episode 1") || t.includes("ep 1") || t.includes("olivia") || t.includes("elvira") || t.includes("stringy")) ep = "Episode 1";
      else if (t.includes("episode 2") || t.includes("ep 2")) ep = "Episode 2";
      else if (t.includes("trailer") || t.includes("introducing")) ep = "Trailer";
      return { id: "yt_" + v.id, title: v.snippet.title, platform: "youtube", episode: ep, date: v.snippet.publishedAt.split("T")[0], likes: parseInt(v.statistics.likeCount || "0", 10), commentCount: parseInt(v.statistics.commentCount || "0", 10), views: parseInt(v.statistics.viewCount || "0", 10), followerGain: 0, url: "https://www.youtube.com/watch?v=" + v.id };
    });
    return { posts: posts, comments: allComments, subscribers: subscriberCount };
  } catch (e) { return { posts: [], comments: [], subscribers: 0 }; }
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

function parseIgPosts(items, platformLabel, username) {
  var followers = 0;
  var posts = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    if (item.followersCount) followers = item.followersCount;
    if (item.likesCount !== undefined || item.caption) {
      var caption = (item.caption || item.alt || "").substring(0, 120);
      var title = caption || ("Post " + (i + 1));
      var tl = title.toLowerCase();
      var ep = "Promo";
      if (tl.includes("episode 1") || tl.includes("ep 1") || tl.includes("olivia") || tl.includes("elvira") || tl.includes("stringy")) ep = "Episode 1";
      else if (tl.includes("episode 2") || tl.includes("ep 2")) ep = "Episode 2";
      else if (tl.includes("trailer") || tl.includes("introducing")) ep = "Trailer";
      posts.push({ id: "ig_" + (item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), title: title, platform: platformLabel, episode: ep, date: item.timestamp ? item.timestamp.split("T")[0] : new Date().toISOString().split("T")[0], likes: item.likesCount || 0, commentCount: item.commentsCount || 0, views: item.videoViewCount || item.videoPlayCount || 0, followerGain: 0, url: item.url || "https://www.instagram.com/" + username + "/" });
    }
  }
  return { posts: posts, followers: followers };
}

async function scrapeTikTok(token, username) {
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
      var caption = (item.text || item.desc || "").substring(0, 120);
      var title = caption || ("TikTok " + (i + 1));
      var tl = title.toLowerCase();
      var ep = "Promo";
      if (tl.includes("episode 1") || tl.includes("ep 1") || tl.includes("olivia") || tl.includes("elvira") || tl.includes("stringy")) ep = "Episode 1";
      else if (tl.includes("episode 2") || tl.includes("ep 2")) ep = "Episode 2";
      else if (tl.includes("trailer") || tl.includes("introducing")) ep = "Trailer";
      posts.push({ id: "tt_" + (item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), title: title, platform: "tiktok", episode: ep, date: item.createTimeISO ? item.createTimeISO.split("T")[0] : new Date().toISOString().split("T")[0], likes: item.diggCount || item.likesCount || 0, commentCount: item.commentCount || item.commentsCount || 0, views: item.playCount || item.videoViewCount || 0, followerGain: 0, url: item.webVideoUrl || "https://www.tiktok.com/@" + username });
    }
    return { posts: posts, followers: followers };
  } catch (e) { return { posts: [], followers: 0 }; }
}

exports.handler = async (event) => {
  var headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: headers, body: "" };
  if (event.httpMethod === "GET") return { statusCode: 200, headers: headers, body: JSON.stringify({ posts: [], comments: [], lastUpdated: null }) };

  if (event.httpMethod === "POST") {
    var ytKey = process.env.YOUTUBE_API_KEY;
    var apifyToken = process.env.APIFY_API_TOKEN;

    try {
      // Run all scrapers in parallel with timeouts
      var settled = await Promise.allSettled([
        scrapeYouTube(ytKey),
        apifyToken ? scrapeApifyProfile(apifyToken, "https://www.instagram.com/" + IG_ACCOUNT + "/", 20000).then(function(items) { return parseIgPosts(items, "instagram", IG_ACCOUNT); }) : Promise.resolve({ posts: [], followers: 0 }),
        apifyToken ? scrapeApifyProfile(apifyToken, "https://www.instagram.com/" + IG_HOSTS_ACCOUNT + "/", 20000).then(function(items) { return parseIgPosts(items, "instagram_hosts", IG_HOSTS_ACCOUNT); }) : Promise.resolve({ posts: [], followers: 0 }),
        apifyToken ? scrapeTikTok(apifyToken, TIKTOK_ACCOUNT) : Promise.resolve({ posts: [], followers: 0 })
      ]);

      var ytResult = settled[0].status === "fulfilled" ? settled[0].value : { posts: [], comments: [], subscribers: 0 };
      var igResult = settled[1].status === "fulfilled" ? settled[1].value : { posts: [], followers: 0 };
      var igHostsResult = settled[2].status === "fulfilled" ? settled[2].value : { posts: [], followers: 0 };
      var ttResult = settled[3].status === "fulfilled" ? settled[3].value : { posts: [], followers: 0 };

      var allPosts = [].concat(ytResult.posts, igResult.posts, igHostsResult.posts, ttResult.posts);
      var allComments = ytResult.comments || [];

      var result = {
        posts: allPosts,
        comments: allComments,
        accountFollowers: { youtube: ytResult.subscribers, instagram: igResult.followers, tiktok: ttResult.followers, instagram_hosts: igHostsResult.followers },
        lastUpdated: new Date().toISOString(),
        lastScraped: new Date().toISOString(),
        debug: { yt: ytResult.posts.length, ig: igResult.posts.length, igH: igHostsResult.posts.length, tt: ttResult.posts.length }
      };

      return { statusCode: 200, headers: headers, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 200, headers: headers, body: JSON.stringify({ error: e.message }) };
    }
  }
  return { statusCode: 405, headers: headers, body: "Method not allowed" };
};
