// Wenn Frontend + API auf der gleichen Domain laufen (Express served web/),
// dann kann PROXY_BASE leer bleiben:
const PROXY_BASE = ""; // z.B. "" oder "https://dein-service.up.railway.app"

const STORAGE_KEY = "yt-playlists-links";

const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const qEl = document.getElementById("q");
const sortEl = document.getElementById("sort");

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalMeta = document.getElementById("modalMeta");
const player = document.getElementById("player");

const inputEl = document.getElementById("playlistInput");
const addBtn = document.getElementById("addPlaylists");
const clearBtn = document.getElementById("clearPlaylists");

document.getElementById("close").onclick = closeModal;
modal.addEventListener("click", (e) => {
  if (e.target === modal) closeModal();
});

function closeModal() {
  modal.classList.remove("open");
  player.src = "about:blank";
}

function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  }[c]));
}

function extractPlaylistId(url) {
  try {
    const u = new URL(url.trim());
    return u.searchParams.get("list");
  } catch {
    return null;
  }
}

function dedupePlaylistLinks(links) {
  // dedupe über Playlist-ID, nicht über String
  const seen = new Set();
  const out = [];

  for (const link of links) {
    const id = extractPlaylistId(link);
    if (!id) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(`https://www.youtube.com/playlist?list=${id}`); // normalisiert
  }
  return out;
}

function loadStoredLinks() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStoredLinks(links) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(links));
}

function clearStoredLinks() {
  localStorage.removeItem(STORAGE_KEY);
}

function bestThumb(thumbnails) {
  return (
    thumbnails?.maxres?.url ||
    thumbnails?.standard?.url ||
    thumbnails?.high?.url ||
    thumbnails?.medium?.url ||
    thumbnails?.default?.url ||
    ""
  );
}

function fmtDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("de-DE", {
      year: "numeric",
      month: "short",
      day: "2-digit"
    });
  } catch {
    return "";
  }
}

let playlists = [];

function applyFilters() {
  const q = (qEl.value || "").toLowerCase().trim();
  let list = playlists.slice();

  if (q) {
    list = list.filter(p =>
      (p.title || "").toLowerCase().includes(q) ||
      (p.channelTitle || "").toLowerCase().includes(q)
    );
  }

  const sort = sortEl.value;
  if (sort === "az") list.sort((a, b) => (a.title || "").localeCompare(b.title || ""));
  if (sort === "count") list.sort((a, b) => (b.itemCount ?? -1) - (a.itemCount ?? -1));
  if (sort === "recent") list.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));

  render(list);

  const stored = loadStoredLinks();
  statusEl.textContent =
    `${list.length} Playlists angezeigt • ${playlists.length} geladen • ${stored.length} Links gespeichert`;
}

function render(list) {
  grid.innerHTML = "";

  if (!list.length) {
    grid.innerHTML = `<div class="footerNote">Keine Playlists gefunden.</div>`;
    return;
  }

  for (const p of list) {
    const card = document.createElement("div");
    card.className = "card";
    card.onclick = () => openPlaylist(p);

    const thumbUrl = bestThumb(p.thumbnails);
    const date = fmtDate(p.publishedAt);
    const count = (p.itemCount ?? null) !== null ? `${p.itemCount} Videos` : "";

    card.innerHTML = `
      <div class="thumb">
        ${thumbUrl ? `<img loading="lazy" src="${thumbUrl}" alt="">` : ""}
        <div class="badge">${[count, date].filter(Boolean).join(" • ")}</div>
      </div>
      <div class="meta">
        <h3 class="title">${escapeHtml(p.title)}</h3>
        <div class="sub">
          <span>${escapeHtml(p.channelTitle || "")}</span>
          <span style="opacity:.75">ID: ${escapeHtml(p.id)}</span>
        </div>
      </div>
    `;

    grid.appendChild(card);
  }
}

function openPlaylist(p) {
  modal.classList.add("open");
  modalTitle.textContent = p.title || "Playlist";
  player.src = `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(p.id)}`;

  modalMeta.textContent =
    `${p.channelTitle ? `Kanal: ${p.channelTitle}\n` : ""}` +
    `${p.itemCount != null ? `Videos: ${p.itemCount}\n` : ""}` +
    `${p.publishedAt ? `Veröffentlicht: ${fmtDate(p.publishedAt)}\n\n` : "\n"}` +
    `${p.description || ""}`;
}

async function fetchPlaylistsByIds(ids) {
  const url = `${PROXY_BASE}/api/playlists?ids=${encodeURIComponent(ids.join(","))}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "API error");
  return data.items || [];
}

async function loadFromLinks(links) {
  const ids = [...new Set(links.map(extractPlaylistId).filter(Boolean))];

  if (!ids.length) {
    playlists = [];
    render([]);
    statusEl.textContent = "Noch keine gültigen Playlist-Links gespeichert.";
    return;
  }

  statusEl.textContent = "Lade Playlists…";
  playlists = await fetchPlaylistsByIds(ids);
  applyFilters();
}

// UI Events
qEl.addEventListener("input", applyFilters);
sortEl.addEventListener("change", applyFilters);

addBtn.addEventListener("click", async () => {
  const raw = (inputEl.value || "").trim();
  if (!raw) return;

  const newLinks = raw
    .split("\n")
    .map(x => x.trim())
    .filter(Boolean);

  const existing = loadStoredLinks();
  const combined = dedupePlaylistLinks([...existing, ...newLinks]);

  saveStoredLinks(combined);
  inputEl.value = "";

  try {
    await loadFromLinks(combined);
  } catch (e) {
    statusEl.textContent = `Fehler: ${String(e.message || e)}`;
  }
});

clearBtn.addEventListener("click", async () => {
  clearStoredLinks();
  playlists = [];
  render([]);
  statusEl.textContent = "Alle gespeicherten Links gelöscht.";
});

// Initial load
(async function main() {
  try {
    const stored = loadStoredLinks();
    if (stored.length) {
      await loadFromLinks(stored);
    } else {
      statusEl.textContent = "Noch keine Playlists hinzugefügt. Füge oben Links ein.";
      render([]);
    }
  } catch (e) {
    statusEl.textContent = `Fehler: ${String(e.message || e)}`;
  }
})();
