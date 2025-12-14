// Same-origin API (dein Express servt web/ + /api/...)
const PROXY_BASE = "";

/* ---------------------------
   Firebase (Client) Setup
   - In Firebase Console: Web-App anlegen -> config kopieren
   - Auth aktivieren: Anonymous + Google
   - Firestore aktivieren
--------------------------- */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously,
  GoogleAuthProvider,
  signInWithPopup,
  signOut
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// TODO: HIER DEINE FIREBASE CONFIG EINFÜGEN
const firebaseConfig = {
  apiKey: "AIzaSyCAMRqJKC0AEGKT0fgUmu3GDp_EhQah5TI",
  authDomain: "yt-playlists-premium-ab3df.firebaseapp.com",
  projectId: "yt-playlists-premium-ab3df",
  storageBucket: "yt-playlists-premium-ab3df.firebasestorage.app",
  messagingSenderId: "306459443658",
  appId: "1:306459443658:web:1880c0b96885fdb25e4f33"
};


const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = getFirestore(fbApp);

/* ---------------------------
   UI refs
--------------------------- */
const grid = document.getElementById("grid");
const statusEl = document.getElementById("status");
const qEl = document.getElementById("q");
const sortEl = document.getElementById("sort");

const authStateEl = document.getElementById("authState");
const btnAnon = document.getElementById("btnAnon");
const btnGoogle = document.getElementById("btnGoogle");
const btnLogout = document.getElementById("btnLogout");

const openAdd = document.getElementById("openAdd");
const addModal = document.getElementById("addModal");
const closeAdd = document.getElementById("closeAdd");
const inputEl = document.getElementById("playlistInput");
const addBtn = document.getElementById("addPlaylists");
const clearAllBtn = document.getElementById("clearAll");

const playerModal = document.getElementById("playerModal");
const modalTitle = document.getElementById("modalTitle");
const modalMeta = document.getElementById("modalMeta");
const player = document.getElementById("player");
document.getElementById("closePlayer").onclick = closePlayer;
playerModal.addEventListener("click", (e) => { if (e.target === playerModal) closePlayer(); });

const featuredWrap = document.getElementById("featuredWrap");
const featuredCardHost = document.getElementById("featuredCard");

/* ---------------------------
   State
--------------------------- */
let uid = null;
let unsubUserDoc = null;

// We store playlist IDs (strings) and featuredId in Firestore
let stored = {
  playlistIds: [],
  featuredId: null
};

let playlists = []; // fetched playlist metadata from YouTube API

/* ---------------------------
   Helpers
--------------------------- */
function escapeHtml(s) {
  return (s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
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

function dedupeIds(ids) {
  return [...new Set(ids.filter(Boolean))];
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
    return new Date(iso).toLocaleDateString("de-DE", { year: "numeric", month: "short", day: "2-digit" });
  } catch { return ""; }
}

function openSheet() { addModal.classList.add("open"); }
function closeSheet() { addModal.classList.remove("open"); }

function closePlayer() {
  playerModal.classList.remove("open");
  player.src = "about:blank";
}

function openPlaylist(p) {
  playerModal.classList.add("open");
  modalTitle.textContent = p.title || "Playlist";
  player.src = `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(p.id)}`;
  modalMeta.textContent =
    `${p.channelTitle ? `Kanal: ${p.channelTitle}\n` : ""}` +
    `${p.itemCount != null ? `Videos: ${p.itemCount}\n` : ""}` +
    `${p.publishedAt ? `Veröffentlicht: ${fmtDate(p.publishedAt)}\n\n` : "\n"}` +
    `${p.description || ""}`;
}

/* ---------------------------
   YouTube fetch via your proxy
--------------------------- */
async function fetchPlaylistsByIds(ids) {
  const url = `${PROXY_BASE}/api/playlists?ids=${encodeURIComponent(ids.join(","))}`;
  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error || "API error");
  return data.items || [];
}

/* ---------------------------
   Firestore paths
--------------------------- */
function userDocRef() {
  // users/{uid}/playlists/main (single doc)
  return doc(db, "users", uid, "playlists", "main");
}

async function ensureUserDoc() {
  const ref = userDocRef();
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      playlistIds: [],
      featuredId: null,
      updatedAt: serverTimestamp()
    }, { merge: true });
  }
}

async function writeUserDoc(next) {
  const ref = userDocRef();
  await setDoc(ref, {
    playlistIds: next.playlistIds,
    featuredId: next.featuredId ?? null,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/* ---------------------------
   Rendering
--------------------------- */
function makeCard(p) {
  const thumbUrl = bestThumb(p.thumbnails);
  const date = fmtDate(p.publishedAt);
  const count = (p.itemCount ?? null) !== null ? `${p.itemCount} Videos` : "";

  const isFeatured = stored.featuredId && p.id === stored.featuredId;

  const card = document.createElement("div");
  card.className = "card";
  card.innerHTML = `
    <div class="thumb">
      ${thumbUrl ? `<img loading="lazy" src="${thumbUrl}" alt="">` : ""}
      <div class="badge">${[count, date].filter(Boolean).join(" • ")}</div>

      <div class="cardActions">
        <button class="iconBtn" data-action="feature" title="Featured">
          ${isFeatured ? "⭐" : "☆"}
        </button>
        <button class="iconBtn danger" data-action="delete" title="Löschen">🗑</button>
      </div>
    </div>
    <div class="meta">
      <h3 class="title">${escapeHtml(p.title)}</h3>
      <div class="sub">
        <span>${escapeHtml(p.channelTitle || "")}</span>
        <span style="opacity:.75">ID: ${escapeHtml(p.id)}</span>
      </div>
    </div>
  `;

  // Click: open playlist (but not when clicking icon buttons)
  card.addEventListener("click", (e) => {
    const btn = e.target.closest("button");
    if (btn) return;
    openPlaylist(p);
  });

  // Actions
  card.querySelector('[data-action="feature"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!uid) return;

    const nextFeatured = (stored.featuredId === p.id) ? null : p.id;
    await writeUserDoc({
      playlistIds: stored.playlistIds,
      featuredId: nextFeatured
    });
  });

  card.querySelector('[data-action="delete"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!uid) return;

    const nextIds = stored.playlistIds.filter(id => id !== p.id);
    const nextFeatured = (stored.featuredId === p.id) ? null : stored.featuredId;

    await writeUserDoc({
      playlistIds: nextIds,
      featuredId: nextFeatured
    });
  });

  return card;
}

function renderFeatured() {
  const fid = stored.featuredId;
  if (!fid) {
    featuredWrap.style.display = "none";
    featuredCardHost.innerHTML = "";
    return;
  }

  const p = playlists.find(x => x.id === fid);
  if (!p) {
    featuredWrap.style.display = "none";
    featuredCardHost.innerHTML = "";
    return;
  }

  featuredWrap.style.display = "block";
  featuredCardHost.innerHTML = "";
  const card = makeCard(p);
  card.classList.add("featuredCard");
  featuredCardHost.appendChild(card);
}

function applyFiltersAndRender() {
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
  if (sort === "featured") {
    // featured first, then recent
    list.sort((a, b) => {
      const af = stored.featuredId && a.id === stored.featuredId ? 0 : 1;
      const bf = stored.featuredId && b.id === stored.featuredId ? 0 : 1;
      if (af !== bf) return af - bf;
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    });
  }

  // Render grid
  grid.innerHTML = "";
  if (!list.length) {
    grid.innerHTML = `<div class="footerNote">Keine Playlists gefunden.</div>`;
  } else {
    for (const p of list) grid.appendChild(makeCard(p));
  }

  renderFeatured();

  statusEl.textContent =
    `${list.length} angezeigt • ${playlists.length} geladen • ${stored.playlistIds.length} gespeichert` +
    (uid ? ` • User: ${uid.slice(0, 6)}…` : "");
}

/* ---------------------------
   Sync: load playlists from Firestore list
--------------------------- */
async function refreshFromStoredIds() {
  const ids = dedupeIds(stored.playlistIds);

  if (!ids.length) {
    playlists = [];
    applyFiltersAndRender();
    statusEl.textContent = "Noch keine Playlists gespeichert. Klick auf „+ Playlists hinzufügen“.";
    return;
  }

  statusEl.textContent = "Lade Playlists…";
  playlists = await fetchPlaylistsByIds(ids);
  applyFiltersAndRender();
}

/* ---------------------------
   Auth UI
--------------------------- */
btnAnon.addEventListener("click", async () => {
  await signInAnonymously(auth);
});

btnGoogle.addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
});

btnLogout.addEventListener("click", async () => {
  await signOut(auth);
});

/* ---------------------------
   Add modal UI
--------------------------- */
openAdd.addEventListener("click", openSheet);
closeAdd.addEventListener("click", closeSheet);
addModal.addEventListener("click", (e) => { if (e.target === addModal) closeSheet(); });

addBtn.addEventListener("click", async () => {
  if (!uid) {
    statusEl.textContent = "Bitte einloggen (Anon oder Google), damit Sync funktioniert.";
    return;
  }

  const raw = (inputEl.value || "").trim();
  if (!raw) return;

  const links = raw.split("\n").map(x => x.trim()).filter(Boolean);
  const ids = links.map(extractPlaylistId).filter(Boolean);

  // merge + dedupe
  const nextIds = dedupeIds([...stored.playlistIds, ...ids]);

  inputEl.value = "";
  closeSheet();

  await writeUserDoc({
    playlistIds: nextIds,
    featuredId: stored.featuredId ?? null
  });
});

clearAllBtn.addEventListener("click", async () => {
  if (!uid) return;
  await writeUserDoc({ playlistIds: [], featuredId: null });
  closeSheet();
});

/* ---------------------------
   Search / Sort
--------------------------- */
qEl.addEventListener("input", applyFiltersAndRender);
sortEl.addEventListener("change", applyFiltersAndRender);

/* ---------------------------
   Bootstrap
--------------------------- */
onAuthStateChanged(auth, async (user) => {
  // cleanup old listener
  if (unsubUserDoc) { unsubUserDoc(); unsubUserDoc = null; }

  if (!user) {
    uid = null;
    stored = { playlistIds: [], featuredId: null };
    playlists = [];
    authStateEl.textContent = "Nicht eingeloggt";
    btnLogout.style.display = "none";
    btnAnon.style.display = "";
    btnGoogle.style.display = "";
    applyFiltersAndRender();
    statusEl.textContent = "Bitte einloggen (Anon oder Google), damit Sync funktioniert.";
    return;
  }

  uid = user.uid;

  const isAnon = user.isAnonymous;
  const label = isAnon ? "Anon" : (user.email || "Google");
  authStateEl.textContent = `Eingeloggt: ${label}`;
  btnLogout.style.display = "";
  btnAnon.style.display = "none";
  btnGoogle.style.display = "";

  await ensureUserDoc();

  // live sync from Firestore
  unsubUserDoc = onSnapshot(userDocRef(), async (snap) => {
    const data = snap.data() || {};
    stored = {
      playlistIds: Array.isArray(data.playlistIds) ? data.playlistIds : [],
      featuredId: data.featuredId || null
    };

    try {
      await refreshFromStoredIds();
    } catch (e) {
      statusEl.textContent = `Fehler: ${String(e.message || e)}`;
      playlists = [];
      applyFiltersAndRender();
    }
  });
});
