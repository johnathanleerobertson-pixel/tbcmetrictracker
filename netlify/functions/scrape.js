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

    var allComments = [];
    for (var i = 0; i < videoDetails.length; i++) {
      try {
        var nextPageToken = "";
        for (var cp = 0; cp < 3; cp++) {
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
    var res = await timeoutFetch("https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=" + token + "&timeout=15", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username] })
    }, 18000);
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
        id: "ig_" +
