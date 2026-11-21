// (c) Koshik Kumar - https://github.com/KoshikKumar17
(() => {
  const API = "https://jiosaavnsearch-up.koshikkumar17.workers.dev/api/search/songs";
  const LINK_API = "https://jiosaavnsearch-up.koshikkumar17.workers.dev/api/songs";
  const LINK_RE = /https?:\/\/(?:[\w-]+\.)*(?:jiosaavn|saavn)\.com\/\S*song\/\S+/i;
  const LIMIT = 20;
  const QUALS = [96, 160, 320]; // Add 12, 48 if you want
  const QNAME = { 96: "Low", 160: "Medium", 320: "High" }; // Add 12, 48 if you want

  const $ = s => document.querySelector(s);
  const audio = $("#audio"), list = $("#list"), statusEl = $("#status");
  const state = { query: "", page: 1, songs: [], done: true, loading: false, cur: -1, gq: 160, q: {}, repeat: false };
  let rid = 0, seeking = false;

  /* ---------- helpers ---------- */
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dec = s => { const t = document.createElement("textarea"); t.innerHTML = s || ""; return t.value; };
  const hueOf = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const fmt = s => { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const mb = (kbps, dur) => { const m = kbps * 1000 / 8 * dur / 1e6; return m < 1 ? "~" + m.toFixed(1) + " MB" : "~" + m.toFixed(1) + " MB"; };
  const safeName = s => s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
  const pickImg = (arr, q) => (arr.find(i => i.quality === q) || arr[arr.length - 1] || {}).url || "";

  function normalize(s) {
    const dl = (s.downloadUrl || []).map(d => ({ q: parseInt(d.quality, 10), url: d.url })).filter(d => d.url && d.q);
    if (!dl.length) return null;
    const prim = (s.artists && s.artists.primary && s.artists.primary.length) ? s.artists.primary : ((s.artists && s.artists.all) || []);
    const artist = dec(prim.map(a => a.name).filter(Boolean).join(", ")) || "Unknown artist";
    const imgs = s.image || [];
    return {
      id: s.id, title: dec(s.name) || "Untitled", artist, album: dec((s.album && s.album.name) || ""),
      duration: +s.duration || 0, explicit: !!s.explicitContent, year: s.year || "",
      small: pickImg(imgs, "50x50"), large: pickImg(imgs, "500x500"), dl, url: s.url || ""
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
    share: '<svg class="s" viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/></svg>'
  };

  /* ---------- global quality ---------- */
  const gq = $("#gq");
  gq.innerHTML = QUALS.map(q => `<option value="${q}">${q} kbps · ${QNAME[q]}</option>`).join("");
  gq.value = state.gq;
  gq.addEventListener("change", () => {
    state.gq = +gq.value; state.q = {};
    document.querySelectorAll("select.rowq").forEach(sel => { const s = state.songs[+sel.dataset.i]; sel.value = qualityFor(s); });
    if (state.cur >= 0) { syncFpQuality(); reloadSource(); }
  });

  /* ---------- search ---------- */
  let debounce;
  $("#form").addEventListener("submit", e => { e.preventDefault(); clearTimeout(debounce); startSearch(); });
  $("#q").addEventListener("input", () => { clearTimeout(debounce); debounce = setTimeout(startSearch, 550); });
  $("#moreBtn").addEventListener("click", () => load(false));
  // (For auto load more) new IntersectionObserver(es => { if (es[0].isIntersecting && !state.done && !state.loading && state.songs.length) load(false); }, { rootMargin: "400px" }).observe($("#more"));

  function startSearch() {
    const q = $("#q").value.trim();
    // For auto clearing list if placeholder is emptied :- (!q) { rid++; state.query = ""; state.songs = []; state.done = true; list.innerHTML = ""; setStatus(""); $("#more").hidden = true; return; }
    if (!q) return;
    if (q === state.query && state.songs.length) return;
    state.query = q; load(true);
  }
  function setStatus(html) { statusEl.hidden = !html; statusEl.innerHTML = html || ""; }

  async function load(reset) {
    if (!reset && (state.loading || state.done)) return;
    const my = ++rid;
    if (reset) {
      state.page = 1; state.songs = []; state.done = false; state.q = {};
      list.innerHTML = Array.from({ length: 6 }, () => '<div class="skel"></div>').join("");
      setStatus(""); $("#more").hidden = true;
    }
    state.loading = true;
    try {
      const linkM = state.query.match(LINK_RE);
      const isLink = !!linkM;
      const r = await fetch(isLink
        ? `${LINK_API}?link=${encodeURIComponent(linkM[0])}`
        : `${API}?query=${encodeURIComponent(state.query)}&page=${state.page}&limit=${LIMIT}`);
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (my !== rid) return;
      const raw = (j && j.data && j.data.results) || (Array.isArray(j && j.data) ? j.data : (j && j.data && j.data.id ? [j.data] : []));
      const items = raw.map(normalize).filter(Boolean);
      if (reset) list.innerHTML = "";
      const start = state.songs.length;
      const seen = new Set(state.songs.map(s => s.id));
      const fresh = items.filter(s => !seen.has(s.id));
      state.songs.push(...fresh);
      renderRows(fresh, start);
      state.done = isLink || raw.length < LIMIT || !fresh.length;
      state.page++;
      state.loading = false;
      if (!state.songs.length) setStatus(`<h3>No songs found</h3><p>Nothing matched “${esc(state.query)}”. Check the spelling or try the artist's name.</p>`);
      else setStatus("");
      $("#more").hidden = state.done || !state.songs.length;
    } catch (err) {
      if (my !== rid) return;
      state.loading = false;
      if (reset) list.innerHTML = "";
      setStatus(`<h3>Couldn't load songs</h3><p>The search service didn't respond. Check your connection and try again.</p><button class="retry" type="button" id="retry">Try again</button>`);
      $("#retry").onclick = () => load(reset && !state.songs.length ? true : false);
    }
  }

  function renderRows(items, start) {
    list.insertAdjacentHTML("beforeend", items.map((s, k) => {
      const i = start + k;
      return `<article class="row" data-i="${i}" style="--h:${hueOf(s.id)};--i:${Math.min(k, 12)}">
        <div class="cover"><img src="${esc(s.small)}" width="50" height="50" loading="lazy" alt=""><div class="eq"><b></b><b></b><b></b></div></div>
        <div class="meta"><div class="t" title="${esc(s.title)}">${esc(s.title)}</div><div class="a">${esc(s.artist)}</div>
          <div class="d"><span>${fmt(s.duration)}</span>${s.year ? `<span>${esc(s.year)}</span>` : ""}${s.explicit ? '<span class="badge">E</span>' : ""}</div></div>
        <div class="acts">
          <select class="sel rowq" data-i="${i}" aria-label="Quality for ${esc(s.title)}">${optionsFor(s)}</select>
          <button class="ibtn dl" data-act="dl" data-i="${i}" aria-label="Download ${esc(s.title)}">${IC.dl}</button>
          <button class="ibtn play" data-act="play" data-i="${i}" aria-label="Play ${esc(s.title)}">${IC.play}${IC.pause}</button>
        </div></article>`;
    }).join(""));
    items.forEach((s, k) => { const sel = list.querySelector(`select.rowq[data-i="${start + k}"]`); if (sel) sel.value = qualityFor(s); });
  }

  list.addEventListener("click", e => {
    const b = e.target.closest("button[data-act]");
    if (!b) {
      if (e.target.closest("select")) return;
      const row = e.target.closest(".row");
      if (row) selectIdx(+row.dataset.i);
      return;
    }
    const i = +b.dataset.i;
    if (b.dataset.act === "play") (i === state.cur ? togglePlay() : playIdx(i));
    else if (b.dataset.act === "share") shareSong(state.songs[i]);
    else download(state.songs[i], b);
  });
  list.addEventListener("change", e => {
    const sel = e.target.closest("select.rowq"); if (!sel) return;
    const i = +sel.dataset.i; state.q[state.songs[i].id] = +sel.value;
    if (i === state.cur) { syncFpQuality(); reloadSource(); }
  });

  /* ---------- player ---------- */
  const bar = $("#bar"), fp = $("#fp");
  const curSong = () => state.songs[state.cur];

  function playIdx(i) {
    const s = state.songs[i]; if (!s) return;
    state.cur = i;
    audio.src = urlFor(s, qualityFor(s));
    audio.play().catch(() => toast("Couldn't start playback. Tap play to try again."));
    paintSong();
  }
  function selectIdx(i) {
    const s = state.songs[i]; if (!s) return;
    if (i !== state.cur) {
      audio.pause();
      state.cur = i;
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
    if (state.cur < 0) { if (state.songs.length) playIdx(0); return; }
    audio.paused ? audio.play().catch(() => {}) : audio.pause();
  }
  async function step(dir) {
    let n = state.cur + dir;
    if (n >= state.songs.length && !state.done) { await load(false); }
    if (n >= 0 && n < state.songs.length) playIdx(n);
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
    const row = list.querySelector(`select.rowq[data-i="${state.cur}"]`); if (row) row.value = qualityFor(s);
  }
  function syncUI() {
    const playing = !audio.paused && !audio.ended;
    document.querySelectorAll(".row.cur, .row.live").forEach(r => r.classList.remove("cur", "live"));
    const row = list.querySelector(`.row[data-i="${state.cur}"]`);
    if (row) { row.classList.add("cur"); if (playing) row.classList.add("live"); }
    bar.classList.toggle("playing", playing); fp.classList.toggle("playing", playing);
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
    if (state.cur < 0 || fp.classList.contains("open")) return;
    fp.inert = false; fp.classList.add("open"); $("#fpClose").focus({ preventScroll: true });
    history.pushState({ fp: 1 }, "");
  }
  function hideFp() { fp.classList.remove("open"); fp.inert = true; }
  function closeFp() { if (history.state && history.state.fp) history.back(); else hideFp(); }
  window.addEventListener("popstate", () => { if (fp.classList.contains("open")) hideFp(); });
  bar.addEventListener("click", e => { if (!e.target.closest("button, select, input")) openFp(); });
  $("#barOpen").onclick = e => { e.stopPropagation(); openFp(); };
  $("#fpClose").onclick = closeFp;
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && fp.classList.contains("open")) closeFp();
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.code === "Space" && !typing && state.cur >= 0) { e.preventDefault(); togglePlay(); }
  });
  if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => audio.play());
    navigator.mediaSession.setActionHandler("pause", () => audio.pause());
    navigator.mediaSession.setActionHandler("nexttrack", () => step(1));
    navigator.mediaSession.setActionHandler("previoustrack", () => step(-1));
  }

  /* ---------- download as "Title - Artist.m4a" ---------- */
  const busy = new Map();
  async function download(s, btn) {
    if (!s) return;
    if (busy.has(s.id)) { busy.get(s.id).abort(); return; }   // click again = cancel
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
      toast("Saved: " + name);
    } catch (err) {
      if (err.name === "AbortError") { toast("Download cancelled"); reset(); return; }
      const a = document.createElement("a"); a.href = url; a.download = name; a.target = "_blank"; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      toast("The file server blocks renaming here, so the browser may save it under its original name.");
    }
    reset();
  }
  function saveBlob(blob, name) {
    const u = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = u; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 15000);
  }

  async function shareSong(s) {
    if (!s || !s.url) { toast("No link available for this song."); return; }
    if (navigator.share) {
      try { await navigator.share({ url: s.url }); return; }
      catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(s.url); toast("Song link copied"); }
    catch (e) { prompt("Copy song link:", s.url); }
  }

  $("#q").focus({ preventScroll: true });
})();
