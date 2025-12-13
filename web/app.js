const PROXY_BASE = "http://localhost:8787"; // Backend-Port
const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const qEl = document.getElementById("q");
const sortEl = document.getElementById("sort");

const modal = document.getElementById("modal");
const modalTitle = document.getElementById("modalTitle");
const modalMeta = document.getElementById("modalMeta");
const player = document.getElementById("player");
document.getElementById("close").onclick = closeModal;
modal.addEventListener("click", (e) => { if (e.target === modal) closeModal(); });

function closeModal() {
  modal.classList.remove("open");
  player.src = "about:blank";
}

function extractPlaylistId(url) {
  try {
    const u = new URL(url.trim());
    const id = u.searchParams.get("list");
    return id || null;
  } catch { return null; }
}

function dedupeById(ids) {
  return [...new Set(ids.filter(Boolean))];
}

function bestThumb(thumbnails) {
  // prefer maxres -> standard -> high -> medium -> default
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
    return new Date(iso).toLocaleDateString("de-DE", { year: "numeric", month: "short", day: "2-digit" });
  } catch { return ""; }
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
  if (sort === "az") list.sort((a,b) => (a.title||"").localeCompare(b.title||""));
  if (sort === "count") list.sort((a,b) => (b.itemCount ?? -1) - (a.itemCount ?? -1));
  if (sort === "recent") list.sort((a,b) => new Date(b.publishedAt||0) - new Date(a.publishedAt||0));

  render(list);
  statusEl.textContent = `${list.length} Playlists angezeigt • ${playlists.length} total (Duplikate entfernt)`;
}

function render(list) {
  grid.innerHTML = "";
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

function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  }[c]));
}

async function loadUrlsTxt() {
  const r = await fetch("./playlists.txt");
  const txt = await r.text();
  return txt
    .split("\n")
    .map(x => x.trim())
    .filter(x => x && !x.startsWith("#"));
}

async function fetchPlaylists(ids) {
  const url = `${PROXY_BASE}/api/playlists?ids=${encodeURIComponent(ids.join(","))}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "API error");
  return data.items || [];
}

async function main() {
  statusEl.textContent = "Lade Playlists…";
  try {
    const urls = await loadUrlsTxt();
    const ids = dedupeById(urls.map(extractPlaylistId));
    if (!ids.length) {
      statusEl.textContent = "Keine Playlist-Links gefunden. Füge welche in playlists.txt ein.";
      return;
    }
    playlists = await fetchPlaylists(ids);
    statusEl.textContent = `Geladen: ${playlists.length} Playlists (Duplikate entfernt).`;
    applyFilters();
  } catch (e) {
    statusEl.textContent = `Fehler: ${String(e.message || e)}`;
  }
}

qEl.addEventListener("input", applyFilters);
sortEl.addEventListener("change", applyFilters);

main();
