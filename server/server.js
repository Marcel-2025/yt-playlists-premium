import express from "express";
import cors from "cors";
import "dotenv/config";

const app = express();
app.use(cors());

app.get("/", (req, res) => {
  res.status(200).send("yt-playlists-premium proxy is running ✅");
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  console.warn("⚠️  Missing YOUTUBE_API_KEY in .env");
}

function extractPlaylistId(url) {
  try {
    const u = new URL(url.trim());
    // standard: https://www.youtube.com/playlist?list=PL...
    const list = u.searchParams.get("list");
    if (list) return list;

    // youtu.be / other variants occasionally include list param too
    const list2 = u.searchParams.get("list");
    if (list2) return list2;

    return null;
  } catch {
    return null;
  }
}

function unique(arr) {
  return [...new Set(arr)];
}

app.get("/api/playlists", async (req, res) => {
  try {
    const raw = (req.query.ids || "").toString();
    const ids = unique(
      raw
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
    );

    if (ids.length === 0) return res.json({ items: [] });

    // YouTube Data API: playlists.list
    // Max 50 IDs per request
    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

    const allItems = [];
    for (const chunk of chunks) {
      const url =
        "https://www.googleapis.com/youtube/v3/playlists" +
        `?part=snippet,contentDetails&id=${encodeURIComponent(chunk.join(","))}` +
        `&key=${encodeURIComponent(API_KEY || "")}`;

      const r = await fetch(url);
      const data = await r.json();

      if (!r.ok) {
        return res.status(r.status).json({
          error: "YouTube API error",
          details: data
        });
      }

      allItems.push(...(data.items || []));
    }

    // Normalize response
    const items = allItems.map((p) => ({
      id: p.id,
      title: p.snippet?.title || "Untitled playlist",
      description: p.snippet?.description || "",
      channelTitle: p.snippet?.channelTitle || "",
      publishedAt: p.snippet?.publishedAt || "",
      itemCount: p.contentDetails?.itemCount ?? null,
      thumbnails: p.snippet?.thumbnails || {}
    }));

    // Deduplicate by playlist id (just in case)
    const seen = new Set();
    const deduped = [];
    for (const it of items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      deduped.push(it);
    }

    res.json({ items: deduped });
  } catch (e) {
    res.status(500).json({ error: "Server error", details: String(e) });
  }
});

app.get("/api/extract", (req, res) => {
  // helper: pass URLs and get deduped playlist IDs
  const urls = (req.query.urls || "").toString().split("\n");
  const ids = unique(urls.map(extractPlaylistId).filter(Boolean));
  res.json({ ids });
});

const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`✅ Proxy running on http://localhost:${port}`));
