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
  const loadRsvp = () => { try { const r = JSON.parse(localStorage.getItem(STORAGE_KEY)); return r && r.guests ? r : null; } catch { return null; } };
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
  // An invitation ("group") = { invitation, hit, guests: [{ id, name, status, answeredBy, table }] }
  const ATTENDING = "Attending", NOT_ATTENDING = "Not attending";
  const demoRows = (window.GUESTS || []).map((g) => ({ status: "", answeredBy: "", table: "", ...g, invitation: g.invitation || g.name }));
  const demoGroup = (key, hit) => ({ invitation: key, hit, guests: demoRows.filter((r) => r.invitation === key).map((r) => ({ ...r })) });

  async function apiSearch(q) {
    if (DEMO) {
      const tokens = norm(q).split(" ").filter(Boolean);
      const matches = (text) => { const words = norm(text).split(" "); return tokens.every((t) => words.some((w) => w.startsWith(t))); };
      const keys = [...new Set(demoRows.map((r) => r.invitation))];
      const out = [];
      for (const key of keys) {
        const hitRow = demoRows.find((r) => r.invitation === key && matches(r.name));
        if (hitRow || matches(key)) out.push(demoGroup(key, hitRow ? hitRow.name : null));
        if (out.length >= MAX_RESULTS) break;
      }
      return out;
    }
    const res = await fetch(`${API}?action=search&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "search failed");
    return data.results;
  }

  async function apiRsvp(payload) {
    if (DEMO) {
      await new Promise((r) => setTimeout(r, 600));
      if (isClosed()) return { ok: false, code: "closed" };
      const saved = [], skipped = [];
      payload.answers.forEach((a) => {
        const row = demoRows.find((r) => r.id === a.id && r.invitation === payload.invitation);
        if (!row) return;
        if (row.status) { skipped.push(row.name); return; }
        row.status = a.attending ? ATTENDING : NOT_ATTENDING;
        row.answeredBy = payload.answeredBy;
        saved.push(row.name);
      });
      return { ok: true, saved, skipped, group: demoGroup(payload.invitation, null) };
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
    if (!reduceMotion) for (let i = 0; i < 16; i++) {
      const b = document.createElement("i");
      const a = (Math.PI * 2 * i) / 16, r = 90 + Math.random() * 70;
      b.className = "burst";
      b.style.cssText = `--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r}px`;
      $("#envelope").appendChild(b);
      b.addEventListener("animationend", () => b.remove());
    }
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
  let current = null;

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
      const n = g.guests.length, answered = g.guests.filter((x) => x.status).length;
      const sub = g.hit && g.hit !== g.invitation ? `<span class="r-sub">includes ${escapeHtml(g.hit)}</span>` : "";
      const badge = answered === n ? `<span class="r-seats r-done">Replied</span>`
        : answered ? `<span class="r-seats r-part">${answered} of ${n} replied</span>`
        : `<span class="r-seats">${n} guest${plural(n)}</span>`;
      li.innerHTML = `<span class="r-name">${escapeHtml(g.invitation)}${sub}</span>${badge}`;
      const open = () => openInvite(g);
      li.addEventListener("click", open);
      li.addEventListener("keydown", (e) => e.key === "Enter" && open());
      results.appendChild(li);
    });
  }

  let picks = {}; // guest id -> "yes" | "no"

  function openInvite(g) {
    Sound.chime();
    current = g; picks = {};
    showCard(invite);
    const n = g.guests.length;
    $("#guestName").textContent = g.invitation;
    $("#seatCount").textContent = n;
    $("#seatPlural").textContent = plural(n);
    $("#seatIcons").innerHTML = g.guests.map((_, i) => `<i style="animation-delay:${.4 + i * .1}s"></i>`).join("");
    $("#formError").hidden = true;
    $("#message").value = "";

    const pending = g.guests.filter((x) => !x.status);
    const allDone = !pending.length;
    $("#rsvpForm").hidden = allDone;
    $("#replied").hidden = !allDone;
    $("#question").textContent = allDone ? "Thank you for your RSVP!" : "Who will be celebrating with us?";
    $("#questionHint").hidden = allDone || n === 1;

    // who is answering: the searched name, else the first person not yet answered
    const me = g.hit || pending.concat(g.guests)[0].name;
    $("#answeredBy").innerHTML = g.guests.map((x) => `<option${x.name === me ? " selected" : ""}>${escapeHtml(x.name)}</option>`).join("");
    $(".as").hidden = n === 1;

    if (allDone) rememberGroup(g);
    renderPeople();
    const list = $("#people");
    list.classList.add("animate");
    setTimeout(() => list.classList.remove("animate"), 900);
  }

  function renderPeople() {
    const g = current;
    $("#people").innerHTML = g.guests.map((x) => {
      const table = x.table ? `<small class="table-no">Table ${escapeHtml(x.table)}</small>` : "";
      if (x.status) {
        const yes = x.status === ATTENDING;
        const by = x.answeredBy && x.answeredBy !== x.name ? `<small>answered by ${escapeHtml(x.answeredBy)}</small>` : "";
        return `<li class="person done"><span class="person__name">${escapeHtml(x.name)}${table}${by}</span>
          <span class="badge ${yes ? "badge--yes" : "badge--no"}">${yes ? "✓ Attending" : "Can't attend"}</span></li>`;
      }
      const p = picks[x.id];
      return `<li class="person"><span class="person__name">${escapeHtml(x.name)}${p ? "" : `<small>not answered yet</small>`}</span>
        <span class="seg" role="radiogroup" aria-label="${escapeHtml(x.name)}">
          <button data-id="${escapeHtml(x.id)}" data-a="yes" role="radio" aria-checked="${p === "yes"}">Attending</button>
          <button data-id="${escapeHtml(x.id)}" data-a="no" role="radio" aria-checked="${p === "no"}">Can't attend</button>
        </span></li>`;
    }).join("");

    // seats: filled = attending, faded = can't attend, light = not answered
    $$("#seatIcons i").forEach((el, i) => {
      const x = g.guests[i], st = x.status ? (x.status === ATTENDING ? "yes" : "no") : picks[x.id];
      el.className = st === "yes" ? "" : st === "no" ? "unused" : "pending";
    });

    const count = Object.keys(picks).length;
    const btn = $("#submitBtn");
    btn.disabled = !count;
    btn.textContent = count ? `Send RSVP for ${count} guest${plural(count)}` : "Choose an answer above";

    // let someone whose own answer is already in go straight to the details
    const me = g.guests.find((x) => x.name === $("#answeredBy").value);
    $("#skipBtn").hidden = !(me && me.status);
  }

  $("#people").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    Sound.tap();
    const id = b.dataset.id;
    picks[id] === b.dataset.a ? delete picks[id] : (picks[id] = b.dataset.a); // tap again to clear
    $("#formError").hidden = true;
    renderPeople();
  });
  $("#answeredBy").addEventListener("change", renderPeople);

  $("#backBtn").addEventListener("click", () => {
    Sound.tap();
    showCard(searchCard);
    search.focus();
  });

  function formError(msg) {
    Sound.error();
    const el = $("#formError");
    el.textContent = msg; el.hidden = false;
    invite.classList.add("shake"); setTimeout(() => invite.classList.remove("shake"), 400);
  }

  // Step 1: review answers in a confirmation dialog (answers can't be undone)
  const confirmBox = $("#confirmBox");
  $("#submitBtn").addEventListener("click", () => {
    const ids = Object.keys(picks);
    if (!ids.length) return formError("Please choose an answer for at least one guest.");
    Sound.tap();
    $("#confirmList").innerHTML = current.guests.filter((x) => picks[x.id]).map((x) => {
      const yes = picks[x.id] === "yes";
      return `<li><span>${escapeHtml(x.name)}</span><b class="${yes ? "yes" : "no"}">${yes ? "✓ Attending" : "Can't attend"}</b></li>`;
    }).join("");
    confirmBox.hidden = false;
    requestAnimationFrame(() => confirmBox.classList.add("open"));
    $("#confirmSend").focus();
  });

  function closeConfirm() {
    confirmBox.classList.remove("open");
    setTimeout(() => (confirmBox.hidden = true), 250);
  }
  $("#confirmBack").addEventListener("click", () => { Sound.tap(); closeConfirm(); });
  confirmBox.addEventListener("click", (e) => { if (e.target === confirmBox) closeConfirm(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !confirmBox.hidden) closeConfirm(); });

  // Step 2: send
  $("#confirmSend").addEventListener("click", async () => {
    closeConfirm();
    const ids = Object.keys(picks);
    const btn = $("#submitBtn");
    btn.disabled = true; btn.textContent = "Sending…";
    const payload = {
      invitation: current.invitation,
      answeredBy: $("#answeredBy").value,
      message: $("#message").value.trim(),
      answers: ids.map((id) => ({ id, attending: picks[id] === "yes" }))
    };
    let res;
    try { res = await apiRsvp(payload); } catch { res = { ok: false, code: "network" }; }

    if (res.ok) {
      current = { ...res.group, hit: current.hit };
      picks = {};
      rememberGroup(current);
      showThanks(current, res);
    } else if (res.code === "closed") {
      showCard(closedCard);
    } else {
      renderPeople();
      formError("Sorry, we couldn't send your RSVP. Please check your internet and try again.");
    }
  });

  function rememberGroup(g) {
    saveRsvp({ invitation: g.invitation, guests: g.guests.map(({ name, status, table }) => ({ name, status, table })) });
  }

  function floatHearts(n) {
    if (reduceMotion) return;
    const colors = ["#a2463a", "#c08a7c", "#7b5232", "#cfb08a"];
    for (let i = 0; i < n; i++) {
      const h = document.createElement("span");
      h.className = "float-heart";
      h.textContent = "♥";
      h.style.cssText = `left:${5 + Math.random() * 90}vw;--c:${colors[i % colors.length]};--s:${14 + Math.random() * 18}px;--d:${3 + Math.random() * 2.5}s;--x:${(Math.random() - .5) * 120}px;--r:${(Math.random() - .5) * 60}deg;animation-delay:${Math.random() * 1.2}s`;
      document.body.appendChild(h);
      h.addEventListener("animationend", () => h.remove());
    }
  }

  function showThanks(g, res) {
    showCard(thanks);
    const saved = g.guests.filter((x) => res.saved.includes(x.name));
    const coming = saved.filter((x) => x.status === ATTENDING);
    const pending = g.guests.filter((x) => !x.status);
    const lines = [];
    if (coming.length) lines.push(`<strong>${coming.length}</strong> guest${plural(coming.length)} confirmed: ${coming.map((x) => escapeHtml(x.name)).join(", ")}.`);
    if (res.skipped && res.skipped.length) lines.push(`<span class="small muted">${res.skipped.map(escapeHtml).join(", ")} had already been answered by someone else.</span>`);
    if (pending.length) lines.push(`<span class="small muted">${pending.map((x) => escapeHtml(x.name)).join(", ")} can search their name anytime to answer.</span>`);

    if (coming.length) {
      Sound.success(); leafBurst(30); floatHearts(18);
      $("#thanksIcon").textContent = "♥";
      $("#thanksTitle").textContent = "See you there!";
      lines.unshift("We can't wait to celebrate with you.");
    } else {
      Sound.chime();
      $("#thanksIcon").textContent = "✉";
      $("#thanksTitle").textContent = "You'll be missed";
      lines.unshift("Thank you for letting us know. You'll be in our hearts on our special day.");
    }
    $("#thanksText").innerHTML = lines.join("<br>");
  }

  $$("[data-enter]").forEach((b) => b.addEventListener("click", () => {
    Sound.tap();
    if (current) rememberGroup(current);
    showSite(loadRsvp());
  }));

  // ---------- 3. main site ----------
  function showSite(r) {
    gate.hidden = true; site.hidden = false;
    document.body.classList.remove("locked");
    window.scrollTo(0, 0);
    const box = $(".my-rsvp");
    if (!r || !r.guests) { box.hidden = true; return; }
    box.hidden = false;
    $("#myRsvp").innerHTML = `<li class="my-title">${escapeHtml(r.invitation)}</li>` + r.guests.map((x) => {
      const st = x.status === ATTENDING ? "✓ Attending" : x.status ? "Can't attend" : "Not answered yet";
      const table = x.table && x.status === ATTENDING ? ` · Table ${escapeHtml(x.table)}` : "";
      return `<li><span>${escapeHtml(x.name)}</span><small>${st}${table}</small></li>`;
    }).join("");
  }

  $("#anotherBtn").addEventListener("click", () => {
    Sound.tap();
    current = null;
    search.value = ""; results.innerHTML = "";
    showGate();
  });

  $("#hashtag").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    try { await navigator.clipboard.writeText("#CarolAndRanelWedding"); } catch {}
    Sound.tap();
    btn.querySelector("span").textContent = "copied!";
    setTimeout(() => (btn.querySelector("span").textContent = "copy"), 1800);
  });

  // reveal variants and stagger (siblings appear one after another)
  [[".story__photo", "from-left"], [".story__text", "from-right"], [".details .detail", "zoom"], [".attire-card", "zoom"], [".notes .detail", "from-left"]]
    .forEach(([sel, cls]) => $$(sel).forEach((el) => el.classList.add(cls)));
  const seen = new Set();
  $$("#site .reveal").forEach((el) => {
    const parent = el.parentElement;
    if (seen.has(parent) || el.style.getPropertyValue("--i")) return;
    seen.add(parent);
    [...parent.children].filter((c) => c.classList.contains("reveal")).forEach((c, i) => c.style.setProperty("--i", i));
  });

  // hero: drifting sparkles
  if (!reduceMotion) {
    const sp = document.createElement("div");
    sp.className = "hero__sparkles";
    sp.innerHTML = Array.from({ length: 18 }, () =>
      `<i style="left:${Math.random() * 100}%;--d:${7 + Math.random() * 7}s;--delay:${-Math.random() * 12}s;--x:${(Math.random() - .5) * 120}px;transform:scale(${.5 + Math.random()})"></i>`).join("");
    $(".hero").appendChild(sp);
  }

  // scroll reveal
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: .15 });
  $$("#site .reveal").forEach((el) => io.observe(el));

  // countdown
  const pad = (n) => String(n).padStart(2, "0");
  function setDigit(sel, v) {
    const el = $(sel);
    if (el.textContent === v) return;
    el.textContent = v;
    el.classList.remove("tick"); void el.offsetWidth; el.classList.add("tick");
  }
  function tickCountdown() {
    const ms = Math.max(0, WEDDING_DATE - Date.now());
    setDigit("#cdD", pad(Math.floor(ms / 864e5)));
    setDigit("#cdH", pad(Math.floor(ms / 36e5) % 24));
    setDigit("#cdM", pad(Math.floor(ms / 6e4) % 60));
    setDigit("#cdS", pad(Math.floor(ms / 1e3) % 60));
  }
  tickCountdown(); setInterval(tickCountdown, 1000);

  if (DEMO) {
    console.info("[RSVP] Demo mode — set scriptUrl in config.js to use the Google Sheet.");
    const tag = document.createElement("div");
    tag.className = "demo-tag";
    tag.textContent = "Demo mode · sample names · answers are not saved";
    document.body.appendChild(tag);
  }
})();
