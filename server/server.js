import express from "express";
import cors from "cors";
import "dotenv/config";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
app.use(cors());

/* --------------------------------------------------
   Helpers für __dirname (weil ES Modules)
-------------------------------------------------- */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* --------------------------------------------------
   Health + Root (für Railway & Debug)
-------------------------------------------------- */
app.get("/health", (req, res) => {
  res.status(200).json({ ok: true });
});

/* --------------------------------------------------
   YouTube API Proxy
-------------------------------------------------- */
const API_KEY = process.env.YOUTUBE_API_KEY;

if (!API_KEY) {
  console.warn("⚠️  YOUTUBE_API_KEY is not set");
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

    if (!ids.length) {
      return res.json({ items: [] });
    }

    // max 50 IDs pro Request
    const chunks = [];
    for (let i = 0; i < ids.length; i += 50) {
      chunks.push(ids.slice(i, i + 50));
    }

    const allItems = [];

    for (const chunk of chunks) {
      const url =
        "https://www.googleapis.com/youtube/v3/playlists" +
        `?part=snippet,contentDetails&id=${encodeURIComponent(chunk.join(","))}` +
        `&key=${encodeURIComponent(API_KEY)}`;

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

    // Normalisieren + deduplizieren
    const seen = new Set();
    const items = [];

    for (const p of allItems) {
      if (seen.has(p.id)) continue;
      seen.add(p.id);

      items.push({
        id: p.id,
        title: p.snippet?.title || "Untitled playlist",
        description: p.snippet?.description || "",
        channelTitle: p.snippet?.channelTitle || "",
        publishedAt: p.snippet?.publishedAt || "",
        itemCount: p.contentDetails?.itemCount ?? null,
        thumbnails: p.snippet?.thumbnails || {}
      });
    }

    res.json({ items });
  } catch (err) {
    res.status(500).json({
      error: "Server error",
      details: String(err)
    });
  }
});

/* --------------------------------------------------
   STATIC FRONTEND (web/)
-------------------------------------------------- */
const webDir = path.resolve(__dirname, "../web");
app.use(express.static(webDir));

// Fallback → immer index.html (SPA)
app.get("*", (req, res) => {
  res.sendFile(path.join(webDir, "index.html"));
});

/* --------------------------------------------------
   Start Server (Railway compatible)
-------------------------------------------------- */
const port = Number(process.env.PORT || 8080);
app.listen(port, () => {
  console.log(`✅ yt-playlists-premium running on port ${port}`);
});
