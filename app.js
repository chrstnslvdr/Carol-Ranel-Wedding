(() => {
  "use strict";

  const CFG = window.WEDDING_CONFIG || {};
  const WEDDING_DATE = new Date(CFG.weddingDate || "2026-11-14T14:30:00+08:00");
  const DEADLINE = new Date(CFG.rsvpDeadline || "2026-10-30T23:59:59+08:00");
  const API = (CFG.scriptUrl || "").trim();
  const DEMO = !API;
  const STORAGE_KEY = "cr-wedding-rsvp";
  const MIN_CHARS = 3;
  const MAX_RESULTS = 5;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ---------- helpers ----------
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const loadRsvp = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } };
  const saveRsvp = (r) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch {} };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n) => (n === 1 ? "" : "s");
  const isClosed = () => Date.now() > DEADLINE.getTime();
  const fmtPhone = (p) => p.replace(/^(\d{4})(\d{3})(\d{4})$/, "$1 $2 $3");

  // contact buttons
  const contactsHtml = (CFG.contacts || []).map((c) => `
    <div class="contact">
      <span class="contact__name">${escapeHtml(c.name)}<small>${escapeHtml(fmtPhone(c.phone))}</small></span>
      <a href="tel:${escapeHtml(c.phone)}" aria-label="Call ${escapeHtml(c.name)}">Call</a>
      <a href="sms:${escapeHtml(c.phone)}" aria-label="Text ${escapeHtml(c.name)}">Text</a>
    </div>`).join("");
  $$("[data-contacts]").forEach((el) => (el.innerHTML = contactsHtml));

  // ---------- data layer: Google Sheet (Apps Script) or demo ----------
  const demoGuests = (window.GUESTS || []).map((g) => ({ status: "", count: 0, members: [], ...g }));

  async function apiSearch(q) {
    if (DEMO) {
      const tokens = norm(q).split(" ").filter(Boolean);
      return demoGuests
        .map((g) => {
          const words = norm([g.name, ...g.members].join(" ")).split(" ");
          if (!tokens.every((t) => words.some((w) => w.startsWith(t)))) return null;
          const hit = g.members.find((m) => tokens.every((t) => norm(m).split(" ").some((w) => w.startsWith(t))));
          return { ...g, hit };
        })
        .filter(Boolean)
        .slice(0, MAX_RESULTS);
    }
    const res = await fetch(`${API}?action=search&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "search failed");
    return data.results;
  }

  async function apiRsvp(payload) {
    if (DEMO) {
      await new Promise((r) => setTimeout(r, 600));
      const g = demoGuests.find((x) => x.id === payload.id);
      if (isClosed()) return { ok: false, code: "closed" };
      if (g.status) return { ok: false, code: "already", guest: g };
      g.status = payload.attending ? "Attending" : "Not attending";
      g.count = payload.attending ? payload.count : 0;
      return { ok: true, status: g.status, count: g.count, seats: g.seats };
    }
    // text/plain avoids a CORS preflight, which Apps Script doesn't support
    const res = await fetch(API, { method: "POST", body: JSON.stringify(payload) });
    return res.json();
  }

  // ---------- sound (Web Audio; no files needed) ----------
  const Sound = (() => {
    let ctx, master, musicGain, musicTimer, musicEl, musicOn = false;

    function init() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain(); master.gain.value = .6; master.connect(ctx.destination);
      musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master);
    }

    function tone(freq, start, dur, vol = .2, type = "sine", dest = master) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0, start);
      g.gain.linearRampToValueAtTime(vol, start + .01);
      g.gain.exponentialRampToValueAtTime(.0001, start + dur);
      o.connect(g); g.connect(dest); o.start(start); o.stop(start + dur + .05);
    }

    function paper() { // soft envelope-opening rustle
      if (!ctx) return;
      const len = ctx.sampleRate * .5, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
      const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      src.buffer = buf; f.type = "bandpass"; f.frequency.value = 2200; f.Q.value = .7; g.gain.value = .35;
      src.connect(f); f.connect(g); g.connect(master); src.start();
    }

    const chime = () => ctx && [1318.5, 1760].forEach((f, i) => tone(f, ctx.currentTime + i * .07, 1.2, .08, "sine"));
    const tap = () => ctx && tone(880, ctx.currentTime, .12, .06, "triangle");
    const error = () => ctx && tone(220, ctx.currentTime, .25, .08, "triangle");
    const success = () => ctx && [523.3, 659.3, 784, 1046.5].forEach((f, i) => tone(f, ctx.currentTime + i * .12, 1.6, .12, "sine"));

    // Background music: assets/audio/music.mp3 if present, otherwise a gentle generated music-box loop.
    const NOTES = [392, 493.9, 587.3, 740, 659.3, 587.3, 493.9, 587.3, 349.2, 440, 523.3, 659.3, 587.3, 523.3, 440, 523.3];
    function musicBox() {
      let step = 0;
      const beat = .42;
      const tick = () => {
        const t = ctx.currentTime + .05;
        for (let i = 0; i < 8; i++) {
          const n = NOTES[(step + i) % NOTES.length];
          tone(n, t + i * beat, 1.8, .07, "sine", musicGain);
          tone(n * 2, t + i * beat, .6, .015, "sine", musicGain);
          if (i % 4 === 0) tone(n / 2, t + i * beat, 2.4, .05, "triangle", musicGain);
        }
        step = (step + 8) % NOTES.length;
      };
      tick(); musicTimer = setInterval(tick, 8 * beat * 1000);
    }

    function startMusic() {
      init();
      musicOn = true;
      if (ctx) ctx.resume();
      musicEl = musicEl || new Audio("assets/audio/music.mp3");
      musicEl.loop = true; musicEl.volume = .5;
      musicEl.play().catch(() => { // no file → generated melody
        if (!ctx || !musicOn) return;
        if (!musicTimer) musicBox();
        musicGain.gain.cancelScheduledValues(ctx.currentTime);
        musicGain.gain.linearRampToValueAtTime(1, ctx.currentTime + 2);
      });
    }
    function stopMusic() {
      musicOn = false;
      if (musicEl) musicEl.pause();
      if (ctx) musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + .4);
      clearInterval(musicTimer); musicTimer = null;
    }
    const toggleMusic = () => (musicOn ? stopMusic() : startMusic(), musicOn);

    // pause when the tab/app is hidden (phones)
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { ctx && ctx.suspend(); musicEl && musicEl.pause(); }
      else if (musicOn) { ctx && ctx.resume(); musicEl && !musicEl.error && musicEl.play().catch(() => {}); }
    });

    return { init, paper, chime, tap, error, success, startMusic, toggleMusic };
  })();

  // ---------- falling leaves ----------
  const LEAF_COLORS = ["#a87b51", "#7b5232", "#cfb08a", "#c08a7c", "#6b4134"];
  function spawnLeaf(burst) {
    const el = document.createElement("i");
    el.className = "leaf";
    const size = 10 + Math.random() * 14;
    el.style.cssText = `left:${Math.random() * 100}vw;width:${size}px;height:${size}px;--c:${LEAF_COLORS[Math.random() * LEAF_COLORS.length | 0]};--d:${(burst ? 5 : 10) + Math.random() * 8}s;animation-delay:${burst ? Math.random() * 1.5 : 0}s`;
    $(".leaves").appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const leafBurst = (n = 30) => { if (!reduceMotion) for (let i = 0; i < n; i++) spawnLeaf(true); };
  if (!reduceMotion) setInterval(() => document.hidden || spawnLeaf(false), 1600);

  // ---------- photos: placeholder until real files are added ----------
  $$("img[data-placeholder]").forEach((img) => {
    const fallback = () => {
      const div = document.createElement("div");
      div.className = "photo-fallback";
      div.textContent = img.dataset.placeholder;
      img.replaceWith(div);
    };
    if (img.complete && img.naturalWidth === 0) fallback(); else img.addEventListener("error", fallback);
  });

  // ---------- 1. intro ----------
  const intro = $("#intro"), gate = $("#gate"), site = $("#site");

  $("#openBtn").addEventListener("click", () => {
    Sound.init(); Sound.paper(); Sound.startMusic();
    $("#envelope").classList.add("open");
    $("#musicBtn").hidden = false;
    setTimeout(() => {
      intro.classList.add("gone");
      const existing = loadRsvp();
      existing ? showSite(existing) : showGate();
    }, 1900);
  });

  $("#musicBtn").addEventListener("click", (e) => {
    e.currentTarget.classList.toggle("off", !Sound.toggleMusic());
  });

  // ---------- 2. RSVP gate ----------
  const search = $("#search"), results = $("#results"), invite = $("#invite"), thanks = $("#thanks");
  const searchCard = $("#searchCard"), closedCard = $("#closedCard");
  let current = null, choice = null, count = 1;

  function showCard(card) {
    [searchCard, closedCard, invite, thanks].forEach((c) => (c.hidden = c !== card));
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function showGate() {
    gate.hidden = false; site.hidden = true;
    document.body.classList.remove("locked");
    if (isClosed()) { showCard(closedCard); return; }
    showCard(searchCard);
    requestAnimationFrame(() => searchCard.classList.add("in"));
  }

  let debounce, searchSeq = 0;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(runSearch, DEMO ? 150 : 400);
  });

  async function runSearch() {
    const q = search.value.trim();
    const seq = ++searchSeq;
    if (norm(q).replace(/ /g, "").length < MIN_CHARS) { results.innerHTML = ""; return; }
    results.innerHTML = `<li class="empty loading"><span class="dots"><i></i><i></i><i></i></span> Looking for your invitation…</li>`;
    let found;
    try { found = await apiSearch(q); }
    catch {
      if (seq === searchSeq) results.innerHTML = `<li class="empty">We couldn't reach the guest list. Please check your internet and try again.</li>`;
      return;
    }
    if (seq !== searchSeq) return; // a newer search is running
    renderResults(q, found);
  }

  function renderResults(q, found) {
    results.innerHTML = "";
    if (!found.length) {
      results.innerHTML = `<li class="empty">No invitation found for “${escapeHtml(q)}”.<br>Try your last name or check the spelling.</li>`;
      return;
    }
    found.forEach((g, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.tabIndex = 0;
      li.style.animationDelay = `${i * 60}ms`;
      const sub = g.hit && g.hit !== g.name ? `<span class="r-sub">includes ${escapeHtml(g.hit)}</span>` : "";
      const badge = g.status ? `<span class="r-seats r-done">Replied</span>` : `<span class="r-seats">${g.seats} seat${plural(g.seats)}</span>`;
      li.innerHTML = `<span class="r-name">${escapeHtml(g.name)}${sub}</span>${badge}`;
      const open = () => openInvite(g);
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => e.key === "Enter" && open());
      results.appendChild(li);
    });
  }

  function openInvite(g) {
    Sound.chime();
    current = g; choice = null; count = g.seats;
    showCard(invite);
    $("#guestName").textContent = g.name;
    $("#guestMembers").textContent = g.members && g.members.length > 1 ? g.members.join(" · ") : "";
    $("#seatCount").textContent = g.seats;
    $("#seatPlural").textContent = plural(g.seats);
    $("#seatIcons").innerHTML = Array.from({ length: g.seats }, (_, i) => `<i style="animation-delay:${.4 + i * .12}s"></i>`).join("");
    $("#formError").hidden = true;

    if (g.status) { showReplied(g); return; }

    $("#rsvpForm").hidden = false; $("#replied").hidden = true;
    $$(".choice").forEach((b) => b.setAttribute("aria-checked", "false"));
    $("#countWrap").hidden = true;
    $("#message").value = "";
    $("#submitBtn").disabled = true;
  }

  function showReplied(g) {
    const attending = g.status === "Attending";
    $("#rsvpForm").hidden = true; $("#replied").hidden = false;
    $("#repliedText").innerHTML = attending
      ? `You've already confirmed: <strong>attending</strong>, ${g.count} of ${g.seats} seat${plural(g.seats)}. ♥`
      : `You've already let us know you <strong>can't attend</strong>. You'll be missed!`;
    $$("#seatIcons i").forEach((i, idx) => i.classList.toggle("unused", !attending || idx >= g.count));
    saveRsvp({ id: g.id, name: g.name, seats: g.seats, attending, count: attending ? g.count : 0 });
  }

  $("#backBtn").addEventListener("click", () => {
    Sound.tap();
    showCard(searchCard);
    search.focus();
  });

  function setChoice(c) {
    choice = c;
    Sound.tap();
    $$(".choice").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.choice === c)));
    $("#countWrap").hidden = !(c === "yes" && current.seats > 1);
    setCount(count);
    $("#submitBtn").disabled = false;
    $("#formError").hidden = true;
  }
  $$(".choice").forEach((b) => b.addEventListener("click", () => setChoice(b.dataset.choice)));

  function setCount(n) {
    count = Math.max(1, Math.min(current.seats, n || 1));
    $("#attending").textContent = count;
    $("#minus").disabled = count <= 1;
    $("#plus").disabled = count >= current.seats;
    $$("#seatIcons i").forEach((i, idx) => i.classList.toggle("unused", choice === "no" || (choice === "yes" && idx >= count)));
  }
  $("#minus").addEventListener("click", () => { Sound.tap(); setCount(count - 1); });
  $("#plus").addEventListener("click", () => { Sound.tap(); setCount(count + 1); });

  function formError(msg) {
    Sound.error();
    const el = $("#formError");
    el.textContent = msg; el.hidden = false;
    invite.classList.add("shake"); setTimeout(() => invite.classList.remove("shake"), 400);
  }

  $("#submitBtn").addEventListener("click", async () => {
    if (!choice) return formError("Please choose whether you'll attend.");
    const btn = $("#submitBtn");
    btn.disabled = true; btn.textContent = "Sending…";
    const payload = { id: current.id, attending: choice === "yes", count: choice === "yes" ? count : 0, message: $("#message").value.trim() };
    let res;
    try { res = await apiRsvp(payload); } catch { res = { ok: false, code: "network" }; }
    btn.textContent = "Send my RSVP";

    if (res.ok) {
      const r = { id: current.id, name: current.name, seats: current.seats, attending: payload.attending, count: res.count };
      saveRsvp(r);
      showThanks(r);
    } else if (res.code === "already") {
      Sound.chime(); showReplied({ ...current, ...(res.guest || {}) });
    } else if (res.code === "closed") {
      showCard(closedCard);
    } else {
      btn.disabled = false;
      formError("Sorry, we couldn't send your RSVP. Please check your internet and try again.");
    }
  });

  function showThanks(r) {
    showCard(thanks);
    if (r.attending) {
      Sound.success(); leafBurst(40);
      $("#thanksIcon").textContent = "♥";
      $("#thanksTitle").textContent = "See you there!";
      $("#thanksText").innerHTML = `We can't wait to celebrate with you.<br><strong>${r.count} of ${r.seats}</strong> seat${plural(r.seats)} confirmed.`;
    } else {
      Sound.chime();
      $("#thanksIcon").textContent = "✉";
      $("#thanksTitle").textContent = "You'll be missed";
      $("#thanksText").textContent = "Thank you for letting us know. You'll be in our hearts on our special day.";
    }
  }

  $$("[data-enter]").forEach((b) => b.addEventListener("click", () => { Sound.tap(); showSite(loadRsvp()); }));

  // ---------- 3. main site ----------
  function showSite(r) {
    gate.hidden = true; site.hidden = false;
    document.body.classList.remove("locked");
    window.scrollTo(0, 0);
    const box = $(".my-rsvp");
    if (!r) { box.hidden = true; return; }
    box.hidden = false;
    $("#myRsvp").innerHTML = r.attending
      ? `<strong>${escapeHtml(r.name)}</strong><br>Attending · ${r.count} of ${r.seats} seat${plural(r.seats)}`
      : `<strong>${escapeHtml(r.name)}</strong><br>Unable to attend`;
  }

  $("#hashtag").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText("#CarolAndRanelWedding"); } catch {}
    Sound.tap();
    btn.querySelector("span").textContent = "copied!";
    setTimeout(() => (btn.querySelector("span").textContent = "copy"), 1800);
  });

  // scroll reveal
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: .15 });
  $$("#site .reveal").forEach((el) => io.observe(el));

  // countdown
  const pad = (n) => String(n).padStart(2, "0");
  function tickCountdown() {
    const ms = Math.max(0, WEDDING_DATE - Date.now());
    $("#cdD").textContent = pad(Math.floor(ms / 864e5));
    $("#cdH").textContent = pad(Math.floor(ms / 36e5) % 24);
    $("#cdM").textContent = pad(Math.floor(ms / 6e4) % 60);
    $("#cdS").textContent = pad(Math.floor(ms / 1e3) % 60);
  }
  tickCountdown(); setInterval(tickCountdown, 1000);

  if (DEMO) console.info("[RSVP] Demo mode — set scriptUrl in config.js to use the Google Sheet.");
})();
