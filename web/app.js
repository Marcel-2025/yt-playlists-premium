const PROXY_BASE = "";

/* ---------------------------
   Firebase (CDN Modules)
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
  onSnapshot,
  updateDoc,
  increment
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

/* ✅ Deine Firebase Config (ohne Analytics) */
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
const statsPill = document.getElementById("statsPill");
const btnGoogle = document.getElementById("btnGoogle");
const btnLogout = document.getElementById("btnLogout");

const openAdd = document.getElementById("openAdd");
const addModal = document.getElementById("addModal");
const closeAdd = document.getElementById("closeAdd");
const inputEl = document.getElementById("playlistInput");
const addBtn = document.getElementById("addPlaylists");
const clearAllBtn = document.getElementById("clearAll");

const openShare = document.getElementById("openShare");
const shareModal = document.getElementById("shareModal");
const closeShare = document.getElementById("closeShare");
const shareUrlInput = document.getElementById("shareUrl");
const copyShareBtn = document.getElementById("copyShare");

const shareBanner = document.getElementById("shareBanner");
const shareBannerText = document.getElementById("shareBannerText");
const importMergeBtn = document.getElementById("importMerge");
const importReplaceBtn = document.getElementById("importReplace");
const dismissShareBtn = document.getElementById("dismissShare");

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

let stored = {
  playlistIds: [],
  featuredId: null
};

let playlists = [];

// Share payload if opened via ?share=
let incomingShare = null;

// Auto-anon guard
let triedAnon = false;

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

function openSheet(el) { el.classList.add("open"); }
function closeSheet(el) { el.classList.remove("open"); }

function closePlayer() {
  playerModal.classList.remove("open");
  player.src = "about:blank";
}

/* ---------------------------
   Base64URL for share token
--------------------------- */
function b64urlEncode(str) {
  const b64 = btoa(unescape(encodeURIComponent(str)));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlDecode(b64url) {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64url.length + 3) % 4);
  const str = decodeURIComponent(escape(atob(b64)));
  return str;
}

function parseIncomingShare() {
  const u = new URL(window.location.href);
  const token = u.searchParams.get("share");
  if (!token) return null;

  try {
    const json = b64urlDecode(token);
    const payload = JSON.parse(json);
    if (!payload || payload.v !== 1 || !Array.isArray(payload.ids)) return null;

    return {
      ids: dedupeIds(payload.ids),
      featuredId: payload.featuredId || null
    };
  } catch {
    return null;
  }
}

function clearShareParamFromUrl() {
  const u = new URL(window.location.href);
  u.searchParams.delete("share");
  window.history.replaceState({}, "", u.toString());
}

/* ---------------------------
   YouTube fetch via proxy
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
function userMainDocRef() {
  return doc(db, "users", uid, "playlists", "main");
}

function userStatsSummaryRef() {
  return doc(db, "users", uid, "stats", "summary");
}

function userStatsPlaylistRef(playlistId) {
  return doc(db, "users", uid, "stats", `pl_${playlistId}`);
}

async function ensureUserDoc() {
  const ref = userMainDocRef();
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
  const ref = userMainDocRef();
  await setDoc(ref, {
    playlistIds: next.playlistIds,
    featuredId: next.featuredId ?? null,
    updatedAt: serverTimestamp()
  }, { merge: true });
}

/* ---------------------------
   Stats
--------------------------- */
async function bumpPageViewOncePerSession() {
  // per uid pro session einmal zählen
  const key = `pv_done_${uid}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, "1");

  const ref = userStatsSummaryRef();
  await setDoc(ref, { pageViews: 0, playlistOpens: 0, updatedAt: serverTimestamp() }, { merge: true });
  await updateDoc(ref, { pageViews: increment(1), updatedAt: serverTimestamp() });
}

async function bumpPlaylistOpen(playlistId) {
  // summary
  const summary = userStatsSummaryRef();
  await setDoc(summary, { pageViews: 0, playlistOpens: 0, updatedAt: serverTimestamp() }, { merge: true });
  await updateDoc(summary, { playlistOpens: increment(1), updatedAt: serverTimestamp() });

  // per playlist
  const pl = userStatsPlaylistRef(playlistId);
  await setDoc(pl, { opens: 0, playlistId, updatedAt: serverTimestamp() }, { merge: true });
  await updateDoc(pl, { opens: increment(1), updatedAt: serverTimestamp() });
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

  // open playlist (unless clicking buttons)
  card.addEventListener("click", async (e) => {
    const btn = e.target.closest("button");
    if (btn) return;

    playerModal.classList.add("open");
    modalTitle.textContent = p.title || "Playlist";
    player.src = `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(p.id)}`;
    modalMeta.textContent =
      `${p.channelTitle ? `Kanal: ${p.channelTitle}\n` : ""}` +
      `${p.itemCount != null ? `Videos: ${p.itemCount}\n` : ""}` +
      `${p.publishedAt ? `Veröffentlicht: ${fmtDate(p.publishedAt)}\n\n` : "\n"}` +
      `${p.description || ""}`;

    if (uid) {
      try { await bumpPlaylistOpen(p.id); } catch {}
      // stats UI wird über onSnapshot aktualisiert (siehe unten)
    }
  });

  // feature toggle
  card.querySelector('[data-action="feature"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!uid) return;
    const nextFeatured = (stored.featuredId === p.id) ? null : p.id;
    await writeUserDoc({ playlistIds: stored.playlistIds, featuredId: nextFeatured });
  });

  // delete
  card.querySelector('[data-action="delete"]').addEventListener("click", async (e) => {
    e.stopPropagation();
    if (!uid) return;

    const nextIds = stored.playlistIds.filter(id => id !== p.id);
    const nextFeatured = (stored.featuredId === p.id) ? null : stored.featuredId;
    await writeUserDoc({ playlistIds: nextIds, featuredId: nextFeatured });
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
    list.sort((a, b) => {
      const af = stored.featuredId && a.id === stored.featuredId ? 0 : 1;
      const bf = stored.featuredId && b.id === stored.featuredId ? 0 : 1;
      if (af !== bf) return af - bf;
      return new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0);
    });
  }

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
   Sync load
--------------------------- */
async function refreshFromStoredIds() {
  const ids = dedupeIds(stored.playlistIds);
  if (!ids.length) {
    playlists = [];
    applyFiltersAndRender();
    statusEl.textContent = "Noch keine Playlists. Klick auf „+ Playlists“.";
    return;
  }

  statusEl.textContent = "Lade Playlists…";
  playlists = await fetchPlaylistsByIds(ids);
  applyFiltersAndRender();
}

/* ---------------------------
   Share: export + import
--------------------------- */
function buildShareUrl() {
  const payload = {
    v: 1,
    ids: dedupeIds(stored.playlistIds),
    featuredId: stored.featuredId || null
  };
  const token = b64urlEncode(JSON.stringify(payload));
  const u = new URL(window.location.href);
  u.searchParams.set("share", token);
  return u.toString();
}

function showShareBannerIfNeeded() {
  incomingShare = parseIncomingShare();
  if (!incomingShare || !incomingShare.ids.length) {
    shareBanner.style.display = "none";
    return;
  }

  shareBanner.style.display = "";
  shareBannerText.textContent = `Gefunden: ${incomingShare.ids.length} Playlists` +
    (incomingShare.featuredId ? " • inkl. Featured" : "");
}

async function importShare(mode) {
  if (!uid || !incomingShare) return;

  const incomingIds = incomingShare.ids;
  const incomingFeatured = incomingShare.featuredId;

  let nextIds;
  let nextFeatured;

  if (mode === "replace") {
    nextIds = incomingIds;
    nextFeatured = incomingFeatured && incomingIds.includes(incomingFeatured) ? incomingFeatured : null;
  } else {
    nextIds = dedupeIds([...stored.playlistIds, ...incomingIds]);

    // featured: wenn du schon eins hast -> behalten, sonst incoming übernehmen (wenn vorhanden)
    const keep = stored.featuredId && nextIds.includes(stored.featuredId) ? stored.featuredId : null;
    const take = incomingFeatured && nextIds.includes(incomingFeatured) ? incomingFeatured : null;
    nextFeatured = keep || take || null;
  }

  await writeUserDoc({ playlistIds: nextIds, featuredId: nextFeatured });

  // UI clean
  incomingShare = null;
  shareBanner.style.display = "none";
  clearShareParamFromUrl();
}

/* ---------------------------
   UI events
--------------------------- */
qEl.addEventListener("input", applyFiltersAndRender);
sortEl.addEventListener("change", applyFiltersAndRender);

btnGoogle.addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  await signInWithPopup(auth, provider);
});

btnLogout.addEventListener("click", async () => {
  await signOut(auth);
});

openAdd.addEventListener("click", () => openSheet(addModal));
closeAdd.addEventListener("click", () => closeSheet(addModal));
addModal.addEventListener("click", (e) => { if (e.target === addModal) closeSheet(addModal); });

addBtn.addEventListener("click", async () => {
  if (!uid) return;

  const raw = (inputEl.value || "").trim();
  if (!raw) return;

  const links = raw.split("\n").map(x => x.trim()).filter(Boolean);
  const ids = links.map(extractPlaylistId).filter(Boolean);
  const nextIds = dedupeIds([...stored.playlistIds, ...ids]);

  inputEl.value = "";
  closeSheet(addModal);

  await writeUserDoc({ playlistIds: nextIds, featuredId: stored.featuredId ?? null });
});

clearAllBtn.addEventListener("click", async () => {
  if (!uid) return;
  await writeUserDoc({ playlistIds: [], featuredId: null });
  closeSheet(addModal);
});

openShare.addEventListener("click", () => {
  if (!uid) return;
  shareUrlInput.value = buildShareUrl();
  openSheet(shareModal);
});

closeShare.addEventListener("click", () => closeSheet(shareModal));
shareModal.addEventListener("click", (e) => { if (e.target === shareModal) closeSheet(shareModal); });

copyShareBtn.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(shareUrlInput.value);
    copyShareBtn.textContent = "Kopiert ✅";
    setTimeout(() => (copyShareBtn.textContent = "Link kopieren"), 1200);
  } catch {
    // fallback: select text
    shareUrlInput.focus();
    shareUrlInput.select();
    document.execCommand("copy");
  }
});

importMergeBtn.addEventListener("click", () => importShare("merge"));
importReplaceBtn.addEventListener("click", () => importShare("replace"));
dismissShareBtn.addEventListener("click", () => {
  incomingShare = null;
  shareBanner.style.display = "none";
  clearShareParamFromUrl();
});

/* ---------------------------
   Bootstrap: Auto-Anon + Sync
--------------------------- */
showShareBannerIfNeeded();

onAuthStateChanged(auth, async (user) => {
  // auto-anon: wenn nicht eingeloggt -> sofort anonym einloggen
  if (!user && !triedAnon) {
    triedAnon = true;
    authStateEl.textContent = "Verbinde (anon)…";
    try { await signInAnonymously(auth); } catch {}
    return;
  }

  // cleanup old listener
  if (unsubUserDoc) { unsubUserDoc(); unsubUserDoc = null; }

  if (!user) {
    uid = null;
    stored = { playlistIds: [], featuredId: null };
    playlists = [];
    authStateEl.textContent = "Offline";
    btnLogout.style.display = "none";
    btnGoogle.style.display = "";
    statsPill.textContent = "📊 –";
    applyFiltersAndRender();
    return;
  }

  uid = user.uid;

  authStateEl.textContent = user.isAnonymous
    ? "Anon (auto)"
    : (user.email ? `Google: ${user.email}` : "Google");
  btnLogout.style.display = user.isAnonymous ? "none" : "";
  btnGoogle.style.display = user.isAnonymous ? "" : "none";

  // ensure docs
  await ensureUserDoc();

  // page view
  try { await bumpPageViewOncePerSession(); } catch {}

  // live sync main doc
  unsubUserDoc = onSnapshot(userMainDocRef(), async (snap) => {
    const data = snap.data() || {};
    stored = {
      playlistIds: Array.isArray(data.playlistIds) ? data.playlistIds : [],
      featuredId: data.featuredId || null
    };

    // update share url if modal open
    if (shareModal.classList.contains("open")) {
      shareUrlInput.value = buildShareUrl();
    }

    try {
      await refreshFromStoredIds();
    } catch (e) {
      statusEl.textContent = `Fehler: ${String(e.message || e)}`;
      playlists = [];
      applyFiltersAndRender();
    }
  });

  // live stats pill
  onSnapshot(userStatsSummaryRef(), (snap) => {
    const d = snap.data() || {};
    const pv = d.pageViews ?? 0;
    const opens = d.playlistOpens ?? 0;
    statsPill.textContent = `📊 Views: ${pv} • Klicks: ${opens}`;
  });

  // if share link is present, keep banner visible + allow import
  showShareBannerIfNeeded();
});
