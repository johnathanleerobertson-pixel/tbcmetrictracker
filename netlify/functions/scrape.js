async function scrapeInstagramFast(token, username, platformLabel, episodes) {
  if (!token) return { posts: [], followers: 0 };
  try {
    var res = await timeoutFetch("https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=" + token + "&timeout=30", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ usernames: [username] })
    }, 35000);
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
      var ep = detectEpisode(title, episodes);
      posts.push({
        id: "ig_" + (p.shortCode || Date.now().toString(36) + Math.random().toString(36).slice(2, 5)),
        title: title.substring(0, 120),
        platform: platformLabel,
        episode: ep,
        date: p.timestamp ? p.timestamp.split("T")[0] : new Date().toISOString().split("T")[0],
        likes: p.likesCount || 0,
        commentCount: p.commentsCount || 0,
        views: p.videoViewCount || 0,
        followerGain: 0,
        url: p.url || "https://www.instagram.com/p/" + (p.shortCode || "")
      });
    }
    return { posts: posts, followers: followers };
  } catch (e) { return { posts: [], followers: 0 }; }
}
