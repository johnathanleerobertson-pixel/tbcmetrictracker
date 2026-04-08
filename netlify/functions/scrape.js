const fetch = require("node-fetch");

var YOUTUBE_CHANNEL_HANDLE = "twobecontinuedhq";
var IG_ACCOUNT = "twobecontinuedhq";
var IG_HOSTS_ACCOUNT = "itsdelaneyandhadley";
var TIKTOK_ACCOUNT = "twobecontinuedhq";
var TIKTOK_HOSTS_ACCOUNT = "itsdelaneyandhadley";
var STORE_NAME = "tbc-metrics-store";
var RECORD_KEY = "latest";

var SEED_HISTORY = [
  { date: "2026-03-23", youtube: 3, instagram: 44, tiktok: 25, instagram_hosts: 260, tiktok_hosts: 40 }
];

var SKIP_WORDS = ["episode","with","podcast","continued","from","that","this","they","their","about","what","when","where","have","been","were","will","would","could","should","just","like","your","more","some","than","them","then","these","those","being","into","very","also","each","other","best","friends","twin","twins","sisters","hosts","first","second","talk","talks","full","show","live","clip","clips","short","shorts","part","official","preview","sneak","peek","behind","scenes","available","streaming","watch","listen","subscribe","follow","new","next","last","every","story","stories","tell","told","pregnancy","pregnant","panty","line","problems","problem","business","company","shark","tank","started","start","season","premiere","debut","launch","launched","coming","soon","announcement","announced","trailer","introducing","intro","teaser","promo","bonus"];

function timeoutFetch(url, options, ms) {
  return Promise.race([
    fetch(url, options),
    new Promise(function(_, reject) { setTimeout(function() { reject(new Error("timeout")); }, ms); })
  ]);
}

function extractGuestNames(title) {
  if (!title) return null;
  var words = title.replace(/[^a-zA-Z\s&]/g, " ").split(/\s+/);
  var names = [];
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    if (w === "&" || w === "and") continue;
    if (w.length < 2) continue;
    if (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase()) {
      var lower = w.toLowerCase();
      if (!SKIP_WORDS.includes(lower) && lower !== "delaney" && lower !== "hadley" && lower !== "robertson" && lower !== "two" && lower !== "be") {
        names.push(w);
      }
    }
  }
  if (names.length >= 2) return names[0] + " & " + names[1];
  if (names.length === 1) return names[0];
  return null;
}

function categorizeByDate(postDate, episodes) {
  if (!postDate || !episodes.length) return "Promo";
  var pd = new Date(postDate + "T12:00:00");
  var sorted = episodes.slice().sort(function(a, b) { return new Date(a.date) - new Date(b.date); });
  var firstEpDate = new Date(sorted[0].date + "T00:00:00");
  if (pd < firstEpDate) return "Promo";
  for (var i = sorted.length - 1; i >= 0; i--) {
    var epDate = new Date(sorted[i].date + "T00:00:00");
    if (pd >= epDate) return sorted[i].name;
  }
  return "Promo";
}

function detectEpisode(title, postDate, episodes) {
  if (!title) return categorizeByDate(postDate, episodes);
  var tl = title.toLowerCase();
  if (tl.includes("trailer") || tl.includes("introducing")) return "Trailer";
  for (var i = 0; i < episodes.length; i++) {
    for (var j = 0; j < episodes[i].keywords.length; j++) {
      if (tl.includes(episodes[i].keywords[j])) return episodes[i].name;
    }
  }
  return categorizeByDate(postDate, episodes);
}

async function getOrCreateStore(token) {
  try {
    var listRes = await timeoutFetch("https://api.apify.com/v2/key-value-stores?token=" + token + "&unnamed=false", {}, 5000);
    var listData = await listRes.json();
    var stores = (listData.data && listData.data.items) || [];
    for (var i = 0; i < stores.length; i++) {
      if (stores[i].name === STORE_NAME) return stores[i].id;
    }
    var createRes = await timeoutFetch("https://api.apify.com/v2/key-value-stores?token=" + token + "&name=" + STORE_NAME, { method: "POST" }, 5000);
    var createData = await createRes.json();
    return createData.data && createData.data.id;
  } catch (e) { return null; }
}

async function loadStored(token) {
  if (!token) return null;
  try {
    var storeId = await getOrCreateStore(token);
    if (!storeId) return null;
    var res = await timeoutFetch("https://api.apify.com/v2/key-value-stores/" + storeId + "/records/" + RECORD_KEY + "?token=" + token, {}, 5000);
    if (!res.ok) return null;
    return await res.json();
  } catch (e) { return null; }
}

async function saveStored(token, data) {
  if (!token) return "no token";
  try {
    var storeId = await getOrCreateStore(token);
    if (!storeId) return "no store";
    var res = await timeoutFetch("https://api.apify.com/v2/key-value-stores/" + storeId + "/records/" + RECORD_KEY + "?token=" + token, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
    }, 5000);
    return res.ok ? null : "save failed: " + res.status;
  } catch (e) { return e.message; }
}

async function scrapeYouTube(ytKey) {
  if (!ytKey) return { posts: [], comments: [], subscribers: 0, episodes: [] };
  try {
    var handleRes = await timeoutFetch("https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=" + YOUTUBE_CHANNEL_HANDLE + "&key=" + ytKey, {}, 8000);
    var handleData = await handleRes.json();
    if (!handleData.items || !handleData.items.length) return { posts: [], comments: [], subscribers: 0, episodes: [] };
    var channelId = handleData.items[0].id;
    var subscriberCount = parseInt(handleData.items[0].statistics.subscriberCount || "0", 10);

    var channelDetailRes = await timeoutFetch("https://www.googleapis.com/youtube/v3/channels?part=contentDetails&id=" + channelId + "&key=" + ytKey, {}, 8000);
    var channelDetail = await channelDetailRes.json();
    var uploadsPlaylistId = channelDetail.items && channelDetail.items[0] && channelDetail.items[0].contentDetails.relatedPlaylists.uploads;

    var allVideoIds = [];
    if (uploadsPlaylistId) {
      var nextPage = "";
      for (var page = 0; page < 5; page++) {
        var plUrl = "https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=" + uploadsPlaylistId + "&maxResults=50&key=" + ytKey;
        if (nextPage) plUrl += "&pageToken=" + nextPage;
        var plRes = await timeoutFetch(plUrl, {}, 8000);
        var plData = await plRes.json();
        var plItems = plData.items || [];
        for (var pi = 0; pi < plItems.length; pi++) allVideoIds.push(plItems[pi].contentDetails.videoId);
        nextPage = plData.nextPageToken;
        if (!nextPage) break;
      }
    }

    if (!allVideoIds.length) return { posts: [], comments: [], subscribers: subscriberCount, episodes: [] };

    var videoDetails = [];
    for (var batch = 0; batch < allVideoIds.length; batch += 50) {
      var batchIds = allVideoIds.slice(batch, batch + 50).join(",");
      var statsRes = await timeoutFetch("https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=" + batchIds + "&key=" + ytKey, {}, 8000);
      var statsData = await statsRes.json();
      videoDetails = videoDetails.concat(statsData.items || []);
    }

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
        var guestName = extractGuestNames(sorted[v].snippet.title) || ("Episode " + episodeNum);
        var words = sorted[v].snippet.title.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(function(w) { return w.length > 3 && !SKIP_WORDS.includes(w); });
        episodes.push({ name: guestName, num: episodeNum, keywords: words, title: sorted[v].snippet.title, date: sorted[v].snippet.publishedAt.split("T")[0] });
      }
    }

    // Comments: 5 videos max, 2 pages each to stay within time budget
    var allComments = [];
    for (var i = 0; i < Math.min(videoDetails.length, 5); i++) {
      try {
        var nextPageToken = "";
        for (var cp = 0; cp < 2; cp++) {
          var commUrl = "https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=" + videoDetails[i].id + "&maxResults=100&order=time&key=" + ytKey;
          if (nextPageToken) commUrl += "&pageToken=" + nextPageToken;
          var cr = await timeoutFetch(commUrl, {}, 5000);
          var cd = await cr.json();
          if (cd.error) break;
          var threads = cd.items || [];
          for (var j = 0; j < threads.length; j++) {
            var c = threads[j].snippet.topLevelComment.snippet;
            allComments.push({ id: threads[j].id, text: c.textDisplay, author: c.authorDisplayName, date: c.publishedAt.split("T")[0], postTitle: videoDetails[i].snippet.title, platform: "youtube", sentiment: "neutral", score: 0.5 });
          }
          nextPageToken = cd.nextPageToken;
          if (!nextPageToken) break;
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
      var postDate = v.snippet.publishedAt.split("T")[0];
      if (tl.includes("trailer") || tl.includes("introducing")) { ep = "Trailer"; }
      else if (mins >= 20) { for (var e = 0; e < episodes.length; e++) { if (episodes[e].title === v.snippet.title) { ep = episodes[e].name; break; } } }
      else { ep = detectEpisode(v.snippet.title, postDate, episodes); }
      return { id: "yt_" + v.id, title: v.snippet.title, platform: "youtube", episode: ep, date: postDate, likes: parseInt(v.statistics.likeCount || "0", 10), commentCount: parseInt(v.statistics.commentCount || "0", 10), views: parseInt(v.statistics.viewCount || "0", 10), followerGain: 0, url: "https://www.youtube.com/watch?v=" + v.id };
    });

    return { posts: posts, comments: allComments, subscribers: subscriberCount, episodes: episodes };
  } catch (e) { return { posts: [], comments: [], subscribers: 0, episodes: [] }; }
}

async function scrapeInstagramFast(token, username, platformLabel, episodes) {
  if (!token) return { posts: [], followers: 0 };
  try {
    var res = await timeoutFetch("https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=" + token + "&timeout=10", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username] })
    }, 12000);
    if (!res.ok) return { posts: [], followers: 0 };
    var items = await res.json();
    if (!Array.isArray(items) || !items.length) return { posts: [], followers: 0 };
    var profile = items[0];
    var followers = profile.followersCount || 0;
    var posts = [];
    var recentPosts = profile.latestPosts || [];
    for (var i = 0; i < recentPosts.length; i++) {
      var p = recentPosts[i];
      var caption = (p.caption || p.alt || "").substring(0, 200);
      var title = caption || ("Post " + (i + 1));
      var postDate = p.timestamp ? p.timestamp.split("T")[0] : new Date().toISOString().split("T")[0];
      var ep = detectEpisode(title, postDate, episodes);
      posts.push({
        id: "ig_" + (p.shortCode || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        title: title.substring(0, 120), platform: platformLabel, episode: ep, date: postDate,
        likes: p.likesCount || 0, commentCount: p.commentsCount || 0, views: p.videoViewCount || 0,
        followerGain: 0, url: p.url || "https://www.instagram.com/p/" + (p.shortCode || "")
      });
    }
    return { posts: posts, followers: followers };
  } catch (e) { return { posts: [], followers: 0 }; }
}

async function scrapeTikTok(token, username, platformKey, episodes) {
  if (!token) return { posts: [], followers: 0 };
  try {
    var res = await timeoutFetch("https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items?token=" + token + "&timeout=10", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profiles: ["https://www.tiktok.com/@" + username], resultsPerPage: 20, shouldDownloadVideos: false })
    }, 12000);
    if (!res.ok) return { posts: [], followers: 0 };
    var items = await res.json();
    if (!Array.isArray(items)) return { posts: [], followers: 0 };
    var followers = 0;
    var posts = [];
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      if (item.authorMeta) followers = item.authorMeta.fans || item.authorMeta.followers || item.authorMeta.followerCount || followers;
      if (item.author && !followers) followers = item.author.fans || item.author.followers || item.author.followerCount || followers;
      var caption = (item.text || item.desc || "").substring(0, 200);
      var title = caption || ("TikTok " + (i + 1));
      var postDate = item.createTimeISO ? item.createTimeISO.split("T")[0] : new Date().toISOString().split("T")[0];
      var ep = detectEpisode(title, postDate, episodes);
      posts.push({ id: "tt_" + (item.id || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)), title: title.substring(0, 120), platform: platformKey, episode: ep, date: postDate, likes: item.diggCount || item.likesCount || 0, commentCount: item.commentCount || item.commentsCount || 0, views: item.playCount || item.videoViewCount || 0, followerGain: 0, url: item.webVideoUrl || "https://www.tiktok.com/@" + username });
    }
    return { posts: posts, followers: followers };
  } catch (e) { return { posts: [], followers: 0 }; }
}

async function analyzeSentiment(comments, apiKey) {
  if (!apiKey || !comments.length) return comments;
  try {
    var batch = comments.slice(0, 100).map(function(c, i) { return { index: i, text: (c.text || "").substring(0, 200) }; });
    var sentRes = await timeoutFetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514", max_tokens: 4000,
        messages: [{ role: "user", content: "Analyze sentiment of these comments. Return ONLY a JSON array of {index, sentiment, score}. sentiment must be: positive, neutral, or negative. score: 0.0-1.0 confidence.\n\n" + JSON.stringify(batch) }]
      })
    }, 15000);
    var sentData = await sentRes.json();
    var sentText = (sentData.content || []).map(function(i) { return i.text || ""; }).join("");
    var sentResults = JSON.parse(sentText.replace(/```json|```/g, "").trim());
    for (var k = 0; k < sentResults.length; k++) {
      var idx = sentResults[k].index;
      if (comments[idx]) {
        comments[idx].sentiment = sentResults[k].sentiment;
        comments[idx].score = sentResults[k].score;
      }
    }
  } catch (e) {}
  return comments;
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
    var anthropicKey = process.env.ANTHROPIC_API_KEY;
    try {
      // Run YouTube and Apify scrapers in parallel
      var allSettled = await Promise.allSettled([
        scrapeYouTube(ytKey),
        scrapeInstagramFast(apifyToken, IG_ACCOUNT, "instagram", []),
        scrapeInstagramFast(apifyToken, IG_HOSTS_ACCOUNT, "instagram_hosts", []),
        scrapeTikTok(apifyToken, TIKTOK_ACCOUNT, "tiktok", []),
        scrapeTikTok(apifyToken, TIKTOK_HOSTS_ACCOUNT, "tiktok_hosts", [])
      ]);

      var ytResult = allSettled[0].status === "fulfilled" ? allSettled[0].value : { posts: [], comments: [], subscribers: 0, episodes: [] };
      var igResult = allSettled[1].status === "fulfilled" ? allSettled[1].value : { posts: [], followers: 0 };
      var igHostsResult = allSettled[2].status === "fulfilled" ? allSettled[2].value : { posts: [], followers: 0 };
      var ttResult = allSettled[3].status === "fulfilled" ? allSettled[3].value : { posts: [], followers: 0 };
      var ttHostsResult = allSettled[4].status === "fulfilled" ? allSettled[4].value : { posts: [], followers: 0 };

      var episodes = ytResult.episodes || [];

      // Re-tag Apify posts with correct episodes now that we have episode data
      function retagPosts(posts) {
        return posts.map(function(p) {
          p.episode = detectEpisode(p.title, p.date, episodes);
          return p;
        });
      }
      igResult.posts = retagPosts(igResult.posts);
      igHostsResult.posts = retagPosts(igHostsResult.posts);
      ttResult.posts = retagPosts(ttResult.posts);
      ttHostsResult.posts = retagPosts(ttHostsResult.posts);

      var currentFollowers = {
        youtube: ytResult.subscribers,
        instagram: igResult.followers,
        tiktok: ttResult.followers,
        instagram_hosts: igHostsResult.followers,
        tiktok_hosts: ttHostsResult.followers
      };

      var existing = await loadStored(apifyToken);
      var followerHistory = (existing && existing.followerHistory) || [];
      var hasSeed = followerHistory.some(function(h) { return h.date === "2026-03-23"; });
      if (!hasSeed) followerHistory = SEED_HISTORY.concat(followerHistory);
      followerHistory = followerHistory.filter(function(h) { return !(h.date === "2026-04-01" && h.youtube === 3); });

      var today = new Date().toISOString().split("T")[0];
      var hasData = currentFollowers.youtube > 0 || currentFollowers.instagram > 0 || currentFollowers.tiktok > 0;
      if (hasData) {
        followerHistory = followerHistory.filter(function(h) { return h.date !== today; });
        followerHistory.push({ date: today, youtube: currentFollowers.youtube, instagram: currentFollowers.instagram, tiktok: currentFollowers.tiktok, instagram_hosts: currentFollowers.instagram_hosts, tiktok_hosts: currentFollowers.tiktok_hosts });
        followerHistory.sort(function(a, b) { return a.date.localeCompare(b.date); });
      }

      // Sentiment analysis
      var allComments = ytResult.comments || [];
      allComments = await analyzeSentiment(allComments, anthropicKey);

      var result = {
        posts: [].concat(ytResult.posts, igResult.posts, igHostsResult.posts, ttResult.posts, ttHostsResult.posts),
        comments: allComments,
        accountFollowers: currentFollowers,
        followerHistory: followerHistory,
        lastUpdated: new Date().toISOString(),
        lastScraped: new Date().toISOString(),
        episodes: episodes.map(function(e) { return { name: e.name, title: e.title, date: e.date, num: e.num }; }),
        debug: { yt: ytResult.posts.length, ig: igResult.posts.length, igH: igHostsResult.posts.length, tt: ttResult.posts.length, ttH: ttHostsResult.posts.length, comments: allComments.length }
      };

      await saveStored(apifyToken, result);
      return { statusCode: 200, headers: headers, body: JSON.stringify(result) };
    } catch (e) {
      return { statusCode: 200, headers: headers, body: JSON.stringify({ error: e.message }) };
    }
  }
  return { statusCode: 405, headers: headers, body: "Method not allowed" };
};
