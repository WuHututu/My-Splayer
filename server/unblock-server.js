/**
 * SPlayer Unblock API Server
 * 独立的音源解锁服务 - 从 Electron 主进程 Fastify 后端移植到 Web 部署
 *
 * 提供 /netease, /kuwo, /bodian 三个解锁接口
 * 端口: 3001 (内部, 由 Nginx 反向代理)
 */
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { URL } = require("url");

// ==================== 工具函数 ====================

/** 发起 HTTP GET 请求并返回 JSON / text */
function httpGet(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const req = mod.get(
      u,
      { headers: opts.headers || {}, timeout: 10000 },
      (res) => {
        // 跟随重定向
        if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location) {
          return resolve(httpGet(res.headers.location, opts));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const ct = res.headers["content-type"] || "";
          resolve(ct.includes("json") ? JSON.parse(body.toString()) : body.toString());
        });
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
  });
}

function httpPost(url, data, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    const body = typeof data === "string" ? data : JSON.stringify(data);
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    const req = mod.request(
      u,
      { method: "POST", headers, timeout: 10000 },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(JSON.parse(Buffer.concat(chunks).toString())));
      }
    );
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
    req.write(body);
    req.end();
  });
}

// ==================== 歌曲匹配逻辑 (来自 match.ts) ====================

function normalizeName(name) {
  return name.toLowerCase().replace(/[（(][^）)]*[）)]/g, "").trim();
}

function normalizeArtist(artist) {
  return artist.toLowerCase().replace(/[&/、，,;；]/g, " ").replace(/\s+/g, " ").trim();
}

function isSongMatch(resultName, resultArtist, match) {
  const nResult = normalizeName(resultName);
  const nOriginal = normalizeName(match.songName);
  if (!nResult) return false;
  if (nOriginal) {
    if (!nResult.includes(nOriginal) && !nOriginal.includes(nResult)) return false;
  }
  if (resultArtist && match.artist) {
    const nResultArtist = normalizeArtist(resultArtist);
    const nOriginalArtist = normalizeArtist(match.artist);
    if (nResultArtist && nOriginalArtist) {
      if (!nResultArtist.includes(nOriginalArtist) && !nOriginalArtist.includes(nResultArtist))
        return false;
    }
  }
  return true;
}

// ==================== Kuwo DES 加密 (来自 kwDES.js) ====================

const Long = (n) => {
  const bN = BigInt(n);
  return {
    low: Number(bN),
    valueOf: () => bN.valueOf(),
    toString: () => bN.toString(),
    not: () => Long(~bN),
    isNegative: () => bN < 0,
    or: (x) => Long(bN | BigInt(x)),
    and: (x) => Long(bN & BigInt(x)),
    xor: (x) => Long(bN ^ BigInt(x)),
    equals: (x) => bN === BigInt(x),
    multiply: (x) => Long(bN * BigInt(x)),
    shiftLeft: (x) => Long(bN << BigInt(x)),
    shiftRight: (x) => Long(bN >> BigInt(x)),
  };
};

const range = (n) => Array.from(new Array(n).keys());
const power = (base, index) =>
  Array(index).fill(null).reduce((result) => result.multiply(base), Long(1));
const LongArray = (...array) => array.map((n) => (n === -1 ? Long(-1, -1) : Long(n)));

const arrayE = LongArray(31,0,1,2,3,4,-1,-1,3,4,5,6,7,8,-1,-1,7,8,9,10,11,12,-1,-1,11,12,13,14,15,16,-1,-1,15,16,17,18,19,20,-1,-1,19,20,21,22,23,24,-1,-1,23,24,25,26,27,28,-1,-1,27,28,29,30,31,30,-1,-1);
const arrayIP = LongArray(57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7,56,48,40,32,24,16,8,0,58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6);
const arrayIP_1 = LongArray(39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25,32,0,40,8,48,16,56,24);
const arrayLs = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const arrayLsMask = LongArray(0, 0x100001, 0x300003);
const arrayMask = range(64).map((n) => power(2, n));
arrayMask[arrayMask.length - 1] = arrayMask[arrayMask.length - 1].multiply(-1);
const arrayP = LongArray(15,6,19,20,28,11,27,16,0,14,22,25,4,17,30,9,1,7,23,13,31,26,2,8,18,12,29,5,21,10,3,24);
const arrayPC_1 = LongArray(56,48,40,32,24,16,8,0,57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,60,52,44,36,28,20,12,4,27,19,11,3);
const arrayPC_2 = LongArray(13,16,10,23,0,4,-1,-1,2,27,14,5,20,9,-1,-1,22,18,11,3,25,7,-1,-1,15,6,26,19,12,1,-1,-1,40,51,30,36,46,54,-1,-1,29,39,50,44,32,47,-1,-1,43,48,38,55,33,52,-1,-1,45,41,49,35,28,31,-1,-1);
const matrixNSBox = [[14,4,3,15,2,13,5,3,13,14,6,9,11,2,0,5,4,1,10,12,15,6,9,10,1,8,12,7,8,11,7,0,0,15,10,5,14,4,9,10,7,8,12,3,13,1,3,6,15,12,6,11,2,9,5,0,4,2,11,14,1,7,8,13],[15,0,9,5,6,10,12,9,8,7,2,12,3,13,5,2,1,14,7,8,11,4,0,3,14,11,13,6,4,1,10,15,3,13,12,11,15,3,6,0,4,10,1,7,8,4,11,14,13,8,0,6,2,15,9,5,7,1,10,12,14,2,5,9],[10,13,1,11,6,8,11,5,9,4,12,2,15,3,2,14,0,6,13,1,3,15,4,10,14,9,7,12,5,0,8,7,13,1,2,4,3,6,12,11,0,13,5,14,6,8,15,2,7,10,8,15,4,9,11,5,9,0,14,3,10,7,1,12],[7,10,1,15,0,12,11,5,14,9,8,3,9,7,4,8,13,6,2,1,6,11,12,2,3,0,5,14,10,13,15,4,13,3,4,9,6,10,1,12,11,0,2,5,0,13,14,2,8,15,7,4,15,1,10,7,5,6,12,11,3,8,9,14],[2,4,8,15,7,10,13,6,4,1,3,12,11,7,14,0,12,2,5,9,10,13,0,3,1,11,15,5,6,8,9,14,14,11,5,6,4,1,3,10,2,12,15,0,13,2,8,5,11,8,0,15,7,14,9,4,12,7,10,9,1,13,6,3],[12,9,0,7,9,2,14,1,10,15,3,4,6,12,5,11,1,14,13,0,2,8,7,13,15,5,4,10,8,3,11,6,10,4,6,11,7,9,0,6,4,2,13,1,9,15,3,8,15,3,1,14,12,5,11,0,2,12,14,7,5,10,8,13],[4,1,3,10,15,12,5,0,2,11,9,6,8,7,6,9,11,4,12,15,0,3,10,5,14,13,7,8,13,14,1,2,13,6,14,9,4,1,2,14,11,13,5,0,1,10,8,3,0,11,3,5,9,4,15,2,7,8,12,15,10,7,6,12],[13,7,10,0,6,9,5,15,8,4,3,10,11,14,12,5,2,11,9,6,15,12,0,3,4,1,14,13,1,2,7,8,1,2,12,15,10,4,0,3,13,14,6,9,7,8,9,6,15,1,5,12,3,10,14,5,8,7,11,0,4,13,2,11]];

const bitTransform = (arrInt, n, l) => {
  let l2 = Long(0);
  range(n).forEach((i) => {
    if (arrInt[i].isNegative() || l.and(arrayMask[arrInt[i].low]).equals(0)) return;
    l2 = l2.or(arrayMask[i]);
  });
  return l2;
};

const DES64 = (longs, l) => {
  const pR = range(8).map(() => Long(0));
  const pSource = [Long(0), Long(0)];
  let L, R;
  let out = bitTransform(arrayIP, 64, l);
  pSource[0] = out.and(0xffffffff);
  pSource[1] = out.and(-4294967296).shiftRight(32);
  range(16).forEach((i) => {
    let SOut = Long(0);
    R = Long(pSource[1]);
    R = bitTransform(arrayE, 64, R);
    R = R.xor(longs[i]);
    range(8).forEach((j) => { pR[j] = R.shiftRight(j * 8).and(255); });
    range(8).reverse().forEach((sbi) => { SOut = SOut.shiftLeft(4).or(matrixNSBox[sbi][pR[sbi]]); });
    R = bitTransform(arrayP, 32, SOut);
    L = Long(pSource[0]);
    pSource[0] = Long(pSource[1]);
    pSource[1] = L.xor(R);
  });
  pSource.reverse();
  out = pSource[1].shiftLeft(32).and(-4294967296).or(pSource[0].and(0xffffffff));
  out = bitTransform(arrayIP_1, 64, out);
  return out;
};

const subKeys = (l, longs, n) => {
  let l2 = bitTransform(arrayPC_1, 56, l);
  range(16).forEach((i) => {
    l2 = l2.and(arrayLsMask[arrayLs[i]]).shiftLeft(28 - arrayLs[i]).or(l2.and(arrayLsMask[arrayLs[i]].not()).shiftRight(arrayLs[i]));
    longs[i] = bitTransform(arrayPC_2, 64, l2);
  });
  if (n === 1) range(8).forEach((j) => { [longs[j], longs[15 - j]] = [longs[15 - j], longs[j]]; });
};

const crypt = (msg, key, mode) => {
  let l = Long(0);
  range(8).forEach((i) => { l = Long(key[i]).shiftLeft(i * 8).or(l); });
  const j = Math.floor(msg.length / 8);
  const arrLong1 = range(16).map(() => Long(0));
  subKeys(l, arrLong1, mode);
  const arrLong2 = range(j).map(() => Long(0));
  range(j).forEach((m) => { range(8).forEach((n) => { arrLong2[m] = Long(msg[n + m * 8]).shiftLeft(n * 8).or(arrLong2[m]); }); });
  const arrLong3 = range(Math.floor((1 + 8 * (j + 1)) / 8)).map(() => Long(0));
  range(j).forEach((i1) => { arrLong3[i1] = DES64(arrLong1, arrLong2[i1]); });
  const arrByte1 = msg.slice(j * 8);
  let l2 = Long(0);
  range(msg.length % 8).forEach((i1) => { l2 = Long(arrByte1[i1]).shiftLeft(i1 * 8).or(l2); });
  if (arrByte1.length || mode === 0) arrLong3[j] = DES64(arrLong1, l2);
  const arrByte2 = range(8 * arrLong3.length).map(() => 0);
  let i4 = 0;
  arrLong3.forEach((l3) => { range(8).forEach((i6) => { arrByte2[i4] = l3.shiftRight(i6 * 8).and(255).low; i4 += 1; }); });
  return Buffer.from(arrByte2);
};

const SECRET_KEY = Buffer.from("ylzsxkwm");
const encryptQuery = (query) => crypt(Buffer.from(query), SECRET_KEY, 0).toString("base64");

// ==================== 解灰音源实现 ====================

/** 获取 网易云云盘 链接 (来自 GD Studio API) */
async function getNeteaseSongUrl(id) {
  try {
    if (!id) return { code: 404, url: null };
    const result = await httpGet(`https://music-api.gdstudio.xyz/api.php?types=url&id=${id}`);
    const url = typeof result === "object" ? result.url : null;
    console.log("[unblock] NeteaseSong URL:", url);
    return { code: url ? 200 : 404, url: url || null };
  } catch (error) {
    console.error("[unblock] Get NeteaseSongUrl Error:", error.message);
    return { code: 404, url: null };
  }
}

/** 搜索酷我音乐歌曲 ID */
async function getKuwoSongId(match) {
  try {
    const url = "http://search.kuwo.cn/r.s?&correct=1&stype=comprehensive&encoding=utf8&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" + encodeURIComponent(match.keyword);
    const result = await httpGet(url);
    if (!result || result.content.length < 2 || !result.content[1].musicpage || result.content[1].musicpage.abslist.length < 1) {
      return null;
    }
    for (const item of result.content[1].musicpage.abslist) {
      const songId = item?.MUSICRID;
      if (!songId) continue;
      if (isSongMatch(item?.SONGNAME || "", item?.ARTIST || "", match)) {
        return songId.slice("MUSIC_".length);
      }
    }
    console.warn(`[unblock] Kuwo: 搜索结果均不匹配 "${match.songName}"`);
    return null;
  } catch (error) {
    console.error("[unblock] Get KuwoSongId Error:", error.message);
    return null;
  }
}

/** 获取酷我音乐歌曲 URL */
async function getKuwoSongUrl(match) {
  try {
    if (!match.keyword) return { code: 404, url: null };
    const songId = await getKuwoSongId(match);
    if (!songId) return { code: 404, url: null };
    const PackageName = "kwplayer_ar_5.1.0.0_B_jiakong_vh.apk";
    const url = "http://mobi.kuwo.cn/mobi.s?f=kuwo&q=" + encryptQuery(`corp=kuwo&source=${PackageName}&p2p=1&type=convert_url2&sig=0&format=mp3&rid=${songId}`);
    const result = await httpGet(url, { headers: { "User-Agent": "okhttp/3.10.0" } });
    if (result && typeof result === "string") {
      const urlMatch = result.match(/http[^\s$"]+/)?.[0];
      console.log("[unblock] KuwoSong URL:", urlMatch);
      return { code: urlMatch ? 200 : 404, url: urlMatch || null };
    }
    return { code: 404, url: null };
  } catch (error) {
    console.error("[unblock] Get KuwoSong URL Error:", error.message);
    return { code: 404, url: null };
  }
}

// ==================== 波点音乐 (Bodian/Kuwo) ====================

function getRandomDeviceId() {
  const min = 0, max = 100000000000;
  return String(Math.floor(Math.random() * (max - min + 1)) + min);
}

const deviceId = getRandomDeviceId();

function formatBodianSong(song) {
  return {
    id: song.MUSICRID.split("_").pop(),
    name: song.SONGNAME,
    duration: song.DURATION * 1000,
    album: { id: song.ALBUMID, name: song.ALBUM },
    artists: song.ARTIST.split("&").map((name, index) => ({ id: index ? null : song.ARTISTID, name })),
  };
}

function generateBodianSign(str) {
  const u = new URL(str);
  const currentTime = Date.now();
  str += `&timestamp=${currentTime}`;
  const filteredChars = str.substring(str.indexOf("?") + 1).replace(/[^a-zA-Z0-9]/g, "").split("").sort();
  const dataToEncrypt = `kuwotest${filteredChars.join("")}${u.pathname}`;
  const md5 = crypto.createHash("md5").update(dataToEncrypt).digest("hex");
  return `${str}&sign=${md5}`;
}

async function searchBodian(match) {
  try {
    const keyword = encodeURIComponent(match.keyword.replace(" - ", " "));
    const url = "http://search.kuwo.cn/r.s?&correct=1&vipver=1&stype=comprehensive&encoding=utf8&rformat=json&mobi=1&show_copyright_off=1&searchapi=6&all=" + keyword;
    const result = await httpGet(url);
    if (!result || result.content.length < 2 || !result.content[1].musicpage || result.content[1].musicpage.abslist.length < 1) {
      return null;
    }
    const list = result.content[1].musicpage.abslist.map(formatBodianSong);
    for (const item of list) {
      if (!item?.id) continue;
      const artistStr = item.artists?.map((a) => a.name).join("&") || "";
      if (isSongMatch(item.name || "", artistStr, match)) return item.id;
    }
    console.warn(`[unblock] Bodian: 搜索结果均不匹配 "${match.songName}"`);
    return null;
  } catch (error) {
    console.error("[unblock] Get BodianSongId Error:", error.message);
    return null;
  }
}

async function sendAdFreeRequest() {
  try {
    const adurl = "http://bd-api.kuwo.cn/api/service/advert/watch?uid=-1&token=&timestamp=1724306124436&sign=15a676d66285117ad714e8c8371691da";
    const headers = {
      "user-agent": "Dart/2.19 (dart:io)",
      plat: "ar", channel: "aliopen", devid: deviceId, ver: "3.9.0",
      host: "bd-api.kuwo.cn", qimei36: "1e9970cbcdc20a031dee9f37100017e1840e",
      "content-type": "application/json; charset=utf-8",
    };
    await httpPost(adurl, JSON.stringify({ type: 5, subType: 5, musicId: 0, adToken: "" }), { headers });
  } catch (error) {
    console.error("[unblock] Get Bodian Ad Free Error:", error.message);
  }
}

async function getBodianSongUrl(match) {
  try {
    if (!match.keyword) return { code: 404, url: null };
    const songId = await searchBodian(match);
    if (!songId) return { code: 404, url: null };
    const headers = {
      "user-agent": "Dart/2.19 (dart:io)",
      plat: "ar", channel: "aliopen", devid: deviceId, ver: "3.9.0",
      host: "bd-api.kuwo.cn", "X-Forwarded-For": "1.0.1.114",
    };
    let audioUrl = `http://bd-api.kuwo.cn/api/play/music/v2/audioUrl?&br=320kmp3&musicId=${songId}`;
    audioUrl = generateBodianSign(audioUrl);
    await sendAdFreeRequest();
    const result = await httpGet(audioUrl, { headers });
    if (result && typeof result === "object" && result.data?.audioUrl) {
      console.log("[unblock] BodianSong URL:", result.data.audioUrl);
      return { code: 200, url: result.data.audioUrl };
    }
    return { code: 404, url: null };
  } catch (error) {
    console.error("[unblock] Get BodianSong URL Error:", error.message);
    return { code: 404, url: null };
  }
}

// ==================== HTTP 服务器 ====================

function parseQuery(url) {
  const idx = url.indexOf("?");
  if (idx === -1) return {};
  const qs = url.slice(idx + 1);
  const params = {};
  for (const part of qs.split("&")) {
    const [k, v] = part.split("=").map(decodeURIComponent);
    if (k) params[k] = v || "";
  }
  return params;
}

function buildMatchInfo(query) {
  let songName = query.songName || "";
  let artist = query.artist || "";
  if (!songName && query.keyword) {
    const lastIdx = query.keyword.lastIndexOf("-");
    if (lastIdx > 0) {
      songName = query.keyword.slice(0, lastIdx).trim();
      artist = artist || query.keyword.slice(lastIdx + 1).trim();
    } else {
      songName = query.keyword.trim();
    }
  }
  return { keyword: query.keyword || "", songName, artist };
}

function sendJSON(res, code, data) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(data));
}

function sendError(res, code, msg) {
  sendJSON(res, code, { code, url: null, error: msg });
}

const PORT = process.env.UNBLOCK_PORT || 3001;

const server = http.createServer(async (req, res) => {
  const pathname = req.url.split("?")[0];

  // 健康检查
  if (req.method === "GET" && pathname === "/health") {
    return sendJSON(res, 200, { status: "ok", service: "SPlayer Unblock API" });
  }

  // 根路由 / 信息页
  if (req.method === "GET" && pathname === "/") {
    return sendJSON(res, 200, {
      name: "UnblockAPI",
      description: "SPlayer UnblockAPI service (Web)",
      endpoints: ["/netease", "/kuwo", "/bodian"],
      usage: {
        netease: "/netease?id=<songId>",
        kuwo: "/kuwo?keyword=<keyword>&songName=<name>&artist=<artist>",
        bodian: "/bodian?keyword=<keyword>&songName=<name>&artist=<artist>",
      },
    });
  }

  if (req.method !== "GET") {
    return sendError(res, 405, "Method Not Allowed");
  }

  const query = parseQuery(req.url);

  try {
    // /netease
    if (pathname === "/netease") {
      const { id } = query;
      if (!id) return sendError(res, 400, "Missing id parameter");
      const result = await getNeteaseSongUrl(id);
      return sendJSON(res, result.code, result);
    }

    // /kuwo
    if (pathname === "/kuwo") {
      const match = buildMatchInfo(query);
      if (!match.keyword) return sendError(res, 400, "Missing keyword parameter");
      const result = await getKuwoSongUrl(match);
      return sendJSON(res, result.code, result);
    }

    // /bodian
    if (pathname === "/bodian") {
      const match = buildMatchInfo(query);
      if (!match.keyword) return sendError(res, 400, "Missing keyword parameter");
      const result = await getBodianSongUrl(match);
      return sendJSON(res, result.code, result);
    }

    return sendError(res, 404, "Not Found");
  } catch (error) {
    console.error("[unblock] Server error:", error);
    return sendError(res, 500, "Internal Server Error");
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[unblock] SPlayer Unblock API Server running on http://127.0.0.1:${PORT}`);
  console.log(`[unblock] Endpoints: /netease, /kuwo, /bodian`);
});
