const fetch = require("node-fetch");

var STORE_NAME = "tbc-metrics-store";
var RECORD_KEY = "latest";

function timeoutFetch(url, options, ms) {
  return Promise.race([
    fetch(url, options),
    new Promise(function(_, reject) { setTimeout(function() { reject(new Error("timeout")); }, ms); })
  ]);
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

exports.handler = async (event) => {
  var headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Content-Type": "application/json" };
  if (event.httpMethod === "OPTIONS") return { statusCode: 200, headers: headers, body: "" };

  var apifyToken = process.env.APIFY_API_TOKEN;
  var stored = await loadStored(apifyToken);
  return { statusCode: 200, headers: headers, body: JSON.stringify(stored || { posts: [], comments: [], lastUpdated: null }) };
};
