// (c) Koshik Kumar - https://github.com/KoshikKumar17
(() => {
  const BASE = "https://jiosaavnsearch-up.koshikkumar17.workers.dev/api";
  // search = list endpoint, detail = ?id= / ?link= endpoint
  const KINDS = {
    songs:     { search: BASE + "/search/songs",     detail: BASE + "/songs",     limit: 15, noun: "songs" },
    albums:    { search: BASE + "/search/albums",    detail: BASE + "/albums",    limit: 10, noun: "albums" },
    playlists: { search: BASE + "/search/playlists", detail: BASE + "/playlists", limit: 10, noun: "playlists" }
  };
  const HINT = { songs: "hindi", albums: "Search albums, then press Enter", playlists: "Search playlists, then press Enter" };
  const QUALS = [96, 160, 320]; // Add 12, 48 if you want
  const QNAME = { 96: "Low", 160: "Medium", 320: "High" }; // Add 12, 48 if you want
  const PX = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

  const $ = s => document.querySelector(s);
  const audio = $("#audio"), list = $("#list"), statusEl = $("#status");
  const colEl = $("#col"), browse = $("#browse"), colList = $("#colList"), colStatus = $("#colStatus");

  // search results (songs OR album/playlist cards)
  const state = { mode: "songs", kind: "songs", query: "", page: 1, songs: [], cards: [], done: true, loading: false, gq: 160, q: {}, repeat: false, lastLink: "" };
  // the play queue: any array of songs (search results or an album/playlist)
  const player = { arr: [], cur: -1 };
  // the opened album/playlist
  const col = { open: false, kind: "", songs: [], meta: null, ref: null };
  let rid = 0, crid = 0, seeking = false, browseY = 0;

  /* ---------- helpers ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dec = s => { const t = document.createElement("textarea"); t.innerHTML = s || ""; return t.value; };
  const hueOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const mb = (kbps, dur) => { const m = kbps * 1000 / 8 * dur / 1e6; return m < 1 ? "~" + m.toFixed(1) + " MB" : "~" + m.toFixed(1) + " MB"; };
  const safeName = s => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
  const pickImg = (arr, q) => ((arr || []).find(i => i.quality === q) || (arr || [])[(arr || []).length - 1] || {}).url || "";
  const imgTag = (src, w) => src ? `<img src="${esc(src)}" width="${w}" height="${w}" loading="lazy" alt="">` : "";
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const skeletons = n => Array.from({ length: n }, () => '<div class="skel"></div>').join("");
  const longTime = sec => { const m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + " hr " + (m % 60) + " min" : m + " min"; };

  const primaryNames = x => {
    const a = x && x.artists;
    const prim = (a && a.primary && a.primary.length) ? a.primary : ((a && a.all) || []);
    return dec(prim.map(p => p.name).filter(Boolean).join(", "));
  };

  function normalize(s) {
    const dl = (s.downloadUrl || []).map(d => ({ q: parseInt(d.quality, 10), url: d.url })).filter(d => d.url && d.q);
    if (!dl.length) return null;
    const artist = primaryNames(s) || "Unknown artist";
    const imgs = s.image || [];
    return {
      id: s.id, title: dec(s.name) || "Untitled", artist, album: dec((s.album && s.album.name) || ""),
      duration: +s.duration || 0, explicit: !!s.explicitContent, year: s.year || "",
      small: pickImg(imgs, "50x50"), large: pickImg(imgs, "500x500"), dl, url: s.url || ""
    };
  }
  // album / playlist card used in search results
  function normalizeCard(x, kind) {
    const imgs = x.image || [];
    return {
      id: x.id, kind, title: dec(x.name || x.title) || "Untitled",
      artist: primaryNames(x) || (kind === "albums" ? dec(x.description || "") : ""),
      year: x.year || "", lang: cap(x.language || ""), count: +x.songCount || 0, explicit: !!x.explicitContent,
      small: pickImg(imgs, "50x50"), large: pickImg(imgs, "500x500"), url: x.url || ""
    };
  }
  // (for all quality) const avail = s => s.dl.map(d => d.q).sort((a, b) => a - b);
  const avail = s => { const all = s.dl.map(d => d.q).sort((a, b) => a - b); const good = all.filter(q => q >= 96); return good.length ? good : all; }; // only 96, 160, 320
  function qualityFor(s) {
    const want = state.q[s.id] ?? state.gq, a = avail(s);
    return a.reduce((best, q) => Math.abs(q - want) < Math.abs(best - want) ? q : best, a[0]);
  }
  const urlFor = (s, q) => (s.dl.find(d => d.q === q) || s.dl[0]).url;
  const fileName = s => safeName(s.title) + " - " + safeName(s.artist) + ".m4a";
  const optionsFor = s => avail(s).map(q => `<option value="${q}">${q} kbps · ${QNAME[q] || ""} · ${mb(q, s.duration)}</option>`).join("");

  let toastT;
  function toast(msg) { const t = $("#toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 3600); }

  const IC = {
    play: '<svg class="f pl" viewBox="0 0 24 24"><path d="M8 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 8 5.2z"/></svg>',
    pause: '<svg class="f pa" viewBox="0 0 24 24"><rect x="6" y="4.5" width="4.2" height="15" rx="1.3"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3"/></svg>',
    dl: '<svg class="s" viewBox="0 0 24 24"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 20h14"/></svg>',
    share: '<svg class="s" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>',
    open: '<svg class="s" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>'
  };

  /* ---------- JioSaavn link detection ---------- */
  // song:  jiosaavn.com/song/<name>/<token>
  // album: jiosaavn.com/album/<name>/<token>
  // playlist: jiosaavn.com/featured/<name>/<token>  or  /s/playlist/.../<token>
  const LINK_RE = /https?:\/\/(?:[\w-]+\.)*(?:jiosaavn|saavn)\.com\/\S+/i;
  function parseLink(text) {
    const m = (text || "").match(LINK_RE); if (!m) return null;
    const k = m[0].match(/\/(song|album|featured|playlist)\/[^\s/?#]+\/[^\s/?#]+/i);
    if (!k) return null;
    const w = k[1].toLowerCase();
    return { url: m[0], kind: w === "song" ? "songs" : w === "album" ? "albums" : "playlists" };
  }

  /* ---------- global quality ---------- */
  const gq = $("#gq");
  gq.innerHTML = QUALS.map(q => `<option value="${q}">${q} kbps · ${QNAME[q]}</option>`).join("");
  gq.value = state.gq;
  gq.addEventListener("change", () => {
    state.gq = +gq.value; state.q = {};
    document.querySelectorAll("select.rowq").forEach(sel => {
      const arr = sel.closest("#colList") ? col.songs : state.songs;
      const s = arr[+sel.dataset.i]; if (s) sel.value = qualityFor(s);
    });
    if (player.cur >= 0) { syncFpQuality(); reloadSource(); }
  });

  /* ---------- search type + search box ---------- */
  const modeSel = $("#mode");
  let debounce;
  $("#form").addEventListener("submit", e => { e.preventDefault(); clearTimeout(debounce); startSearch(true); });
  $("#moreBtn").addEventListener("click", () => load(false));
  // (For auto load more) new IntersectionObserver(es => { if (es[0].isIntersecting && !state.done && !state.loading && state.songs.length) load(false); }, { rootMargin: "400px" }).observe($("#more"));

  $("#q").addEventListener("input", () => {
    clearTimeout(debounce);
    const v = $("#q").value.trim();
    if (!v) { startSearch(false); return; }
    if (parseLink(v)) { debounce = setTimeout(() => startSearch(false), 150); return; } // pasted link: fetch directly
    if (state.mode === "songs") debounce = setTimeout(() => startSearch(false), 550);    // only songs auto search
    // albums / playlists: only when the user presses Search / Enter
  });

  modeSel.addEventListener("change", () => {
    state.mode = modeSel.value;
    $("#q").placeholder = HINT[state.mode];
    clearTimeout(debounce);
    resetResults();
    const v = $("#q").value.trim();
    if (!v) return;
    if (state.mode === "songs" || parseLink(v)) startSearch(true);
    else setStatus(`<h3>Ready to search ${state.mode}</h3><p>Press Search to look for “${esc(v)}”.</p>`);
  });

  function setStatus(html) { statusEl.hidden = !html; statusEl.innerHTML = html || ""; }
  function resetResults() {
    rid++; state.query = ""; state.songs = []; state.cards = []; state.done = true; state.loading = false;
    list.innerHTML = ""; setStatus(""); $("#more").hidden = true;
  }

  function startSearch(force) {
    const raw = $("#q").value.trim();
    //if (!raw) { state.lastLink = ""; resetResults(); return; }
    if (!raw) return;
    const link = parseLink(raw);
    if (link && link.kind !== "songs") {                 // album / playlist link -> open it directly
      if (!force && state.lastLink === link.url) return;
      state.lastLink = link.url;
      openCollection(link.kind, { link: link.url });
      return;
    }
    state.lastLink = "";
    if (!force && raw === state.query && (state.songs.length || state.cards.length)) return;
    state.query = raw; load(true);
  }

  async function getJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  async function load(reset) {
    if (!reset && (state.loading || state.done)) return;
    const my = ++rid;
    const link = reset ? parseLink(state.query) : null;
    const kind = reset ? (link ? "songs" : state.mode) : state.kind;
    const cfg = KINDS[kind];
    if (reset) {
      state.kind = kind; state.page = 1; state.songs = []; state.cards = []; state.done = false;
      list.innerHTML = skeletons(6);
      setStatus(""); $("#more").hidden = true;
    }
    state.loading = true;
    try {
      const isLink = !!parseLink(state.query);
      const j = await getJSON(isLink
        ? `${cfg.detail}?link=${encodeURIComponent(parseLink(state.query).url)}`
        : `${cfg.search}?query=${encodeURIComponent(state.query)}&page=${state.page}&limit=${cfg.limit}`);
      if (my !== rid) return;
      const d = j && j.data;
      const raw = (d && d.results) || (Array.isArray(d) ? d : (d && d.id ? [d] : []));
      if (reset) list.innerHTML = "";
      let fresh;
      if (kind === "songs") {
        const seen = new Set(state.songs.map(s => s.id));
        fresh = raw.map(normalize).filter(s => s && !seen.has(s.id));
        const start = state.songs.length;
        state.songs.push(...fresh);
        renderRows(list, fresh, start);
      } else {
        const seen = new Set(state.cards.map(c => c.id));
        fresh = raw.map(x => normalizeCard(x, kind)).filter(c => c.id && !seen.has(c.id));
        const start = state.cards.length;
        state.cards.push(...fresh);
        renderCards(fresh, start);
      }
      const total = kind === "songs" ? state.songs.length : state.cards.length;
      state.done = isLink || raw.length < cfg.limit || !fresh.length;
      state.page++;
      state.loading = false;
      $("#moreBtn").textContent = "Load more " + cfg.noun;
      if (!total) setStatus(`<h3>No ${cfg.noun} found</h3><p>Nothing matched “${esc(state.query)}”. Check the spelling or try the artist's name.</p>`);
      else setStatus("");
      $("#more").hidden = state.done || !total;
    } catch (err) {
      if (my !== rid) return;
      state.loading = false;
      if (reset) list.innerHTML = "";
      setStatus(`<h3>Couldn't load ${cfg.noun}</h3><p>The search service didn't respond. Check your connection and try again.</p><button class="retry" type="button" id="retry">Try again</button>`);
      $("#retry").onclick = () => load(reset && !state.songs.length && !state.cards.length);
    }
  }

  /* ---------- rows ---------- */
  const songRow = (s, i, k) => `<article class="row" data-i="${i}" style="--h:${hueOf(s.id)};--i:${Math.min(k, 12)}">
        <div class="cover">${imgTag(s.small, 50)}<div class="eq"><b></b><b></b><b></b></div></div>
        <div class="meta"><div class="t" title="${esc(s.title)}">${esc(s.title)}</div><div class="a">${esc(s.artist)}</div>
          <div class="d"><span>${fmt(s.duration)}</span>${s.year ? `<span>${esc(s.year)}</span>` : ""}${s.explicit ? '<span class="badge">E</span>' : ""}</div></div>
        <div class="acts">
          <select class="sel rowq" data-i="${i}" aria-label="Quality for ${esc(s.title)}">${optionsFor(s)}</select>
          <button class="ibtn dl" data-act="dl" data-i="${i}" aria-label="Download ${esc(s.title)}">${IC.dl}</button>
          <button class="ibtn play" data-act="play" data-i="${i}" aria-label="Play ${esc(s.title)}">${IC.play}${IC.pause}</button>
        </div></article>`;

  function renderRows(el, items, start) {
    el.insertAdjacentHTML("beforeend", items.map((s, k) => songRow(s, start + k, k)).join(""));
    items.forEach((s, k) => { const sel = el.querySelector(`select.rowq[data-i="${start + k}"]`); if (sel) sel.value = qualityFor(s); });
  }

  function renderCards(items, start) {
    list.insertAdjacentHTML("beforeend", items.map((c, k) => {
      const album = c.kind === "albums";
      const line = album ? (c.artist || "Various artists") : (c.count ? c.count + " songs" : "Playlist");
      const bits = album
        ? [c.count ? c.count + " songs" : "", c.year, c.lang]
        : [c.lang];
      return `<article class="row card" data-i="${start + k}" tabindex="0" style="--h:${hueOf(c.id)};--i:${Math.min(k, 12)}">
        <div class="cover">${imgTag(c.small, 50)}</div>
        <div class="meta"><div class="t" title="${esc(c.title)}">${esc(c.title)}</div><div class="a">${esc(line)}</div>
          <div class="d"><span class="tag">${album ? "Album" : "Playlist"}</span>${bits.filter(Boolean).map(b => `<span>${esc(b)}</span>`).join("")}${c.explicit ? '<span class="badge">E</span>' : ""}</div></div>
        <div class="acts"><button class="ibtn open" data-act="open" data-i="${start + k}" aria-label="Open ${esc(c.title)}">${IC.open}</button></div></article>`;
    }).join(""));
  }

  // shared click / change handling for any list of song rows
  function bindSongList(el, getArr) {
    el.addEventListener("click", e => {
      const arr = getArr();
      const b = e.target.closest("button[data-act]");
      if (!b) {
        if (e.target.closest("select")) return;
        const row = e.target.closest(".row");
        if (row && !row.classList.contains("card")) selectIdx(+row.dataset.i, arr);
        return;
      }
      const i = +b.dataset.i;
      if (b.dataset.act === "play") (arr === player.arr && i === player.cur ? togglePlay() : playIdx(i, arr));
      else if (b.dataset.act === "share") shareSong(arr[i]);
      else if (b.dataset.act === "dl") download(arr[i], b);
    });
    el.addEventListener("change", e => {
      const sel = e.target.closest("select.rowq"); if (!sel) return;
      const arr = getArr(), i = +sel.dataset.i; if (!arr[i]) return;
      state.q[arr[i].id] = +sel.value;
      if (arr === player.arr && i === player.cur) { syncFpQuality(); reloadSource(); }
    });
  }
  bindSongList(list, () => state.songs);
  bindSongList(colList, () => col.songs);

  // album / playlist cards in the search results
  const openCard = row => { const c = row && state.cards[+row.dataset.i]; if (c) openCollection(c.kind, { id: c.id }, c); };
  list.addEventListener("click", e => openCard(e.target.closest(".row.card")));
  list.addEventListener("keydown", e => { if (e.key === "Enter" && e.target.classList.contains("card")) openCard(e.target); });

  /* ---------- album / playlist view ---------- */
  function showCol() {
    if (col.open) return;
    browseY = window.scrollY;
    col.open = true; browse.hidden = true; colEl.hidden = false;
    window.scrollTo({ top: 0, behavior: "instant" });
    history.pushState({ col: 1 }, "");
  }
  function hideCol() {
    if (!col.open) return;
    col.open = false; crid++; colEl.hidden = true; browse.hidden = false;
    window.scrollTo({ top: browseY, behavior: "instant" });
  }
  function closeCol() { if (history.state && history.state.col) history.back(); else hideCol(); }
  $("#colBack").onclick = closeCol;

  function paintColHead(m, kind) {
    $("#colType").textContent = kind === "albums" ? "Album" : "Playlist";
    $("#colTitle").textContent = m ? m.title : "Loading…";
    $("#colSub").textContent = m ? (m.sub || "") : "";
    $("#colStats").textContent = m ? (m.stats || "") : "";
    $("#colImg").src = (m && (m.large || m.small)) || PX;
    $("#colHead").style.setProperty("--ch", m ? hueOf(m.id) : 265);
  }

  async function fetchCollection(kind, ref) {
    const base = KINDS[kind].detail;
    const q = ref.link ? "link=" + encodeURIComponent(ref.link) : "id=" + encodeURIComponent(ref.id);
    const extra = kind === "playlists" ? "&limit=100" : "";
    const j = await getJSON(`${base}?${q}${extra}`);
    const d = (j && j.data) || null;
    if (!d || !d.id) throw new Error("empty");
    let rawSongs = (d.songs || []).slice();
    // playlists can be paged: keep pulling until we have songCount songs
    const want = +d.songCount || 0;
    if (kind === "playlists" && rawSongs.length < want) {
      const ids = new Set(rawSongs.map(s => s.id));
      let p = 1, miss = 0;
      while (rawSongs.length < want && p <= 8 && miss < 2) {
        const jj = await getJSON(`${base}?${q}&page=${p}&limit=100`);
        const more = (jj && jj.data && jj.data.songs) || [];
        const before = rawSongs.length;
        more.forEach(s => { if (!ids.has(s.id)) { ids.add(s.id); rawSongs.push(s); } });
        miss = rawSongs.length === before ? miss + 1 : 0;
        p++;
      }
    }
    return { d, rawSongs };
  }

  async function openCollection(kind, ref, preview) {
    const my = ++crid;
    col.kind = kind; col.songs = []; col.ref = ref;
    col.meta = preview ? { id: preview.id, title: preview.title, large: preview.large, small: preview.small, sub: preview.artist, url: preview.url,
      stats: [preview.count ? preview.count + " songs" : "", preview.year].filter(Boolean).join(" · ") } : null;
    showCol();
    paintColHead(col.meta, kind);
    colList.innerHTML = skeletons(6); colStatus.hidden = true;
    syncUI();
    try {
      const { d, rawSongs } = await fetchCollection(kind, ref);
      if (my !== crid) return;
      const songs = rawSongs.map(normalize).filter(Boolean);
      const imgs = d.image || [];
      const secs = songs.reduce((a, s) => a + s.duration, 0);
      col.meta = {
        id: d.id, title: dec(d.name) || "Untitled", url: d.url || "",
        large: pickImg(imgs, "500x500"), small: pickImg(imgs, "150x150"),
        sub: (kind === "albums" ? primaryNames(d) : "") || dec((d.description || "").replace(/<[^>]*>/g, "")),
        stats: [songs.length + " songs", secs ? longTime(secs) : "", d.year].filter(Boolean).join(" · ")
      };
      col.songs = songs;
      paintColHead(col.meta, kind);
      colList.innerHTML = "";
      if (!songs.length) {
        colStatus.hidden = false;
        colStatus.innerHTML = `<h3>No playable songs</h3><p>This ${kind === "albums" ? "album" : "playlist"} has no songs we can stream right now.</p>`;
      } else { colStatus.hidden = true; renderRows(colList, songs, 0); }
      syncUI();
    } catch (err) {
      if (my !== crid) return;
      colList.innerHTML = "";
      colStatus.hidden = false;
      colStatus.innerHTML = `<h3>Couldn't open this ${kind === "albums" ? "album" : "playlist"}</h3><p>The service didn't respond. Check your connection and try again.</p><button class="retry" type="button" id="colRetry">Try again</button>`;
      $("#colRetry").onclick = () => openCollection(kind, ref, preview);
    }
  }

  $("#colPlay").onclick = () => {
    if (!col.songs.length) return;
    if (player.arr === col.songs && player.cur >= 0) togglePlay(); else playIdx(0, col.songs);
  };
  $("#colShare").onclick = () => { const m = col.meta; if (m) shareSong({ title: m.title, artist: col.kind === "albums" ? "Album" : "Playlist", url: m.url }); };
  $("#colDl").onclick = e => downloadAll(e.currentTarget);

  /* ---------- player ---------- */
  const bar = $("#bar"), fp = $("#fp");
  const curSong = () => player.arr[player.cur];
  const containerFor = arr => arr === state.songs ? list : (arr === col.songs ? colList : null);

  function playIdx(i, arr = player.arr) {
    const s = arr[i]; if (!s) return;
    player.arr = arr; player.cur = i;
    audio.src = urlFor(s, qualityFor(s));
    audio.play().catch(() => toast("Couldn't start playback. Tap play to try again."));
    paintSong();
  }
  function selectIdx(i, arr) {
    const s = arr[i]; if (!s) return;
    if (arr !== player.arr || i !== player.cur) {
      audio.pause();
      player.arr = arr; player.cur = i;
      audio.src = urlFor(s, qualityFor(s));
      $("#miniProg").style.width = "0%";
      $("#barTime").textContent = "0:00 / " + fmt(s.duration);
      $("#fpCur").textContent = "0:00";
      const sk = $("#seek"); sk.value = 0; sk.style.setProperty("--p", "0%");
      paintSong();
    }
    openFp();
  }
  function reloadSource() {
    const s = curSong(); if (!s) return;
    const t = audio.currentTime, was = !audio.paused;
    audio.src = urlFor(s, qualityFor(s));
    audio.addEventListener("loadedmetadata", () => { try { audio.currentTime = t; } catch (e) {} }, { once: true });
    if (was) audio.play().catch(() => {});
    toast(`Now ${qualityFor(s)} kbps`);
  }
  function togglePlay() {
    if (player.cur < 0) { if (state.songs.length) playIdx(0, state.songs); return; }
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
  }
  // next / previous inside the current queue (search results, album or playlist)
  async function step(dir) {
    const arr = player.arr, n = player.cur + dir;
    if (n >= arr.length && arr === state.songs && state.kind === "songs" && !state.done) await load(false);
    if (arr !== player.arr) return;
    if (n >= 0 && n < arr.length) playIdx(n, arr);
  }

  function paintSong() {
    const s = curSong(); if (!s) return;
    document.documentElement.style.setProperty("--ph", hueOf(s.id));
    bar.classList.add("show");
    $("#barImg").src = s.small || s.large; $("#barT").textContent = s.title; $("#barA").textContent = s.artist;
    $("#fpImg").src = s.large || s.small; $("#fpT").textContent = s.title; $("#fpA").textContent = s.artist;
    $("#fpDur").textContent = fmt(s.duration);
    syncFpQuality(); syncUI();
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: s.artist, album: s.album, artwork: s.large ? [{ src: s.large, sizes: "500x500" }] : [] });
    }
    document.title = s.title + " – " + s.artist;
  }
  function syncFpQuality() {
    const s = curSong(); if (!s) return;
    const sel = $("#fpQ"); sel.innerHTML = optionsFor(s); sel.value = qualityFor(s);
    const c = containerFor(player.arr);
    const row = c && c.querySelector(`select.rowq[data-i="${player.cur}"]`); if (row) row.value = qualityFor(s);
  }
  function syncUI() {
    const playing = !audio.paused && !audio.ended;
    document.querySelectorAll(".row.cur, .row.live").forEach(r => r.classList.remove("cur", "live"));
    const c = containerFor(player.arr);
    const row = c && c.querySelector(`.row[data-i="${player.cur}"]`);
    if (row) { row.classList.add("cur"); if (playing) row.classList.add("live"); }
    bar.classList.toggle("playing", playing); fp.classList.toggle("playing", playing);
    const mine = col.songs.length && player.arr === col.songs && player.cur >= 0;
    $("#colPlayT").textContent = mine ? (playing ? "Pause" : "Resume") : "Play all";
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }

  audio.addEventListener("play", syncUI);
  audio.addEventListener("pause", syncUI);
  audio.addEventListener("waiting", () => bar.classList.add("buffer"));
  audio.addEventListener("playing", () => { bar.classList.remove("buffer"); syncUI(); });
  audio.addEventListener("error", () => { if (audio.src) toast("This file couldn't be played. Try another quality."); syncUI(); });
  audio.addEventListener("ended", () => { if (state.repeat) { audio.currentTime = 0; audio.play(); } else step(1).then(syncUI); });
  audio.addEventListener("timeupdate", () => {
    const d = audio.duration && isFinite(audio.duration) ? audio.duration : (curSong() ? curSong().duration : 0);
    const p = d ? audio.currentTime / d : 0;
    $("#miniProg").style.width = (p * 100) + "%";
    $("#barTime").textContent = fmt(audio.currentTime) + " / " + fmt(d);
    $("#fpCur").textContent = fmt(audio.currentTime); $("#fpDur").textContent = fmt(d);
    if (!seeking) { const sk = $("#seek"); sk.value = p * 1000; sk.style.setProperty("--p", (p * 100) + "%"); }
  });

  const sk = $("#seek");
  sk.addEventListener("pointerdown", () => seeking = true);
  sk.addEventListener("input", () => {
    sk.style.setProperty("--p", (sk.value / 10) + "%");
    const d = audio.duration && isFinite(audio.duration) ? audio.duration : (curSong() ? curSong().duration : 0);
    $("#fpCur").textContent = fmt(sk.value / 1000 * d);
  });
  sk.addEventListener("change", () => {
    const d = audio.duration && isFinite(audio.duration) ? audio.duration : (curSong() ? curSong().duration : 0);
    if (d) audio.currentTime = sk.value / 1000 * d; seeking = false;
  });
  const vol = $("#vol"); vol.style.setProperty("--p", "100%");
  vol.addEventListener("input", () => { audio.volume = vol.value / 100; vol.style.setProperty("--p", vol.value + "%"); });

  $("#barPP").onclick = e => { e.stopPropagation(); togglePlay(); };
  $("#fpPP").onclick = togglePlay;
  $("#barPrev").onclick = e => { e.stopPropagation(); step(-1); };
  $("#barNext").onclick = e => { e.stopPropagation(); step(1); };
  $("#fpPrev").onclick = () => (audio.currentTime > 4 ? (audio.currentTime = 0) : step(-1));
  $("#fpNext").onclick = () => step(1);
  $("#rep").onclick = e => { state.repeat = !state.repeat; e.currentTarget.classList.toggle("on", state.repeat); e.currentTarget.setAttribute("aria-pressed", state.repeat); };
  $("#fpQ").addEventListener("change", e => { state.q[curSong().id] = +e.target.value; syncFpQuality(); reloadSource(); });
  $("#fpDl").onclick = e => download(curSong(), e.currentTarget);
  $("#fpShare").onclick = () => shareSong(curSong());

  function openFp() {
    if (player.cur < 0 || fp.classList.contains("open")) return;
    fp.inert = false; fp.classList.add("open"); $("#fpClose").focus({ preventScroll: true });
    history.pushState({ fp: 1 }, "");
  }
  function hideFp() { fp.classList.remove("open"); fp.inert = true; }
  function closeFp() { if (history.state && history.state.fp) history.back(); else hideFp(); }
  // browser / phone back button: close the full player first, then the album / playlist view
  window.addEventListener("popstate", () => {
    if (fp.classList.contains("open")) hideFp();
    else if (col.open) hideCol();
  });
  bar.addEventListener("click", e => { if (!e.target.closest("button, select, input")) openFp(); });
  $("#barOpen").onclick = e => { e.stopPropagation(); openFp(); };
  $("#fpClose").onclick = closeFp;
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") { if (fp.classList.contains("open")) closeFp(); else if (col.open) closeCol(); }
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.code === "Space" && !typing && player.cur >= 0) { e.preventDefault(); togglePlay(); }
  });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
  }

  /* ---------- download as "Title - Artist.m4a" ---------- */
  const busy = new Map();
  // returns "ok" | "cancel" | "fail" | "fallback"
  async function download(s, btn, opt = {}) {
    if (!s) return "fail";
    if (busy.has(s.id)) { busy.get(s.id).abort(); return "cancel"; }   // click again = cancel
    const ctrl = new AbortController();
    busy.set(s.id, ctrl);
    const q = qualityFor(s), url = urlFor(s, q), name = fileName(s);
    const label = btn.querySelector("span");
    const setPct = p => { if (label) label.textContent = p + "%"; else btn.textContent = p + "%"; };
    const reset = () => { btn.classList.remove("busy"); btn.title = ""; if (label) label.textContent = "Download"; else btn.innerHTML = IC.dl; busy.delete(s.id); };
    btn.classList.add("busy"); btn.title = "Click to cancel"; setPct(0);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const total = +res.headers.get("content-length") || 0;
      const reader = res.body.getReader(), chunks = []; let got = 0;
      for (;;) {
        const { done, value } = await reader.read(); if (done) break;
        chunks.push(value); got += value.length;
        if (total) setPct(Math.min(99, Math.round(got / total * 100)));
      }
      saveBlob(new Blob(chunks, { type: "audio/mp4" }), name);
      if (!opt.quiet) toast("Saved: " + name);
      reset(); return "ok";
    } catch (err) {
      if (err.name === "AbortError") { if (!opt.quiet) toast("Download cancelled"); reset(); return "cancel"; }
      reset();
      if (opt.noFallback) return "fail";
      const a = document.createElement("a"); a.href = url; a.download = name; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      toast("The file server blocks renaming here, so the browser may save it under its original name.");
      return "fallback";
    }
  }
  function saveBlob(blob, name) {
    const u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 15000);
  }

  // download every song of the opened album / playlist, one after another
  let all = null;
  async function downloadAll(btn) {
    const label = btn.querySelector("span");
    if (all) {                                          // click again = cancel
      all.stop = true;
      const c = busy.get(all.curId); if (c) c.abort();
      return;
    }
    const songs = col.songs.slice();
    if (!songs.length) return;
    all = { stop: false, curId: null };
    btn.classList.add("busy"); btn.title = "Click to cancel";
    let ok = 0, fail = 0;
    for (let n = 0; n < songs.length && !all.stop; n++) {
      const s = songs[n];
      all.curId = s.id;
      label.textContent = `${n + 1}/${songs.length} · cancel`;
      const rowBtn = (col.songs.length && col.songs[0] === songs[0] && colList.querySelector(`button.dl[data-i="${n}"]`)) || document.createElement("button");
      const r = await download(s, rowBtn, { quiet: true, noFallback: true });
      if (r === "ok") ok++;
      else if (r === "cancel") break;
      else fail++;
      await sleep(400);
    }
    const stopped = all.stop;
    all = null;
    btn.classList.remove("busy"); btn.title = ""; label.textContent = "Download all";
    if (stopped) toast(ok ? `Stopped after ${ok} song${ok > 1 ? "s" : ""}` : "Download cancelled");
    else if (fail && !ok) toast("The file server blocked bulk saving. Use the download button on each song.");
    else toast(fail ? `Saved ${ok} of ${songs.length} songs` : `Saved all ${ok} songs`);
  }

  async function shareSong(s) {
    if (!s || !s.url) { toast("No link available for this one."); return; }
    if (navigator.share) {
      try { await navigator.share({ url: s.url }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(s.url); toast("Link copied"); }
    catch (e) { prompt("Copy link:", s.url); }
  }

  $("#q").focus({ preventScroll: true });
})();
