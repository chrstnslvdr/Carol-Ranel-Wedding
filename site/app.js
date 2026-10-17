(() => {
  "use strict";

  const CFG = window.WEDDING_CONFIG || {};
  const WEDDING_DATE = new Date(CFG.weddingDate || "2026-11-14T14:30:00+08:00");
  const DEADLINE = new Date(CFG.rsvpDeadline || "2026-10-30T23:59:59+08:00");
  const API = (CFG.scriptUrl || "").trim();
  const DEMO = !API;
  const STORAGE_KEY = DEMO ? "cr-wedding-rsvp-preview" : "cr-wedding-rsvp-live"; // preview answers never carry over to the live site
  const MIN_CHARS = 3;
  const MAX_RESULTS = 8;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  // ---------- helpers ----------
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const loadRsvp = () => { try { const r = JSON.parse(localStorage.getItem(STORAGE_KEY)); return r && r.guests ? r : null; } catch { return null; } };
  const saveRsvp = (r) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch {} };
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n) => (n === 1 ? "" : "s");
  const isClosed = () => Date.now() > DEADLINE.getTime();
  // unnamed seats in the sheet, e.g. "One additional seat" — shown as "Additional guest", never searchable
  const EXTRA_RE = /^(one\s+)?(additional|extra)\s+(seat|guest)s?$|^plus\s*one$|^\+\s*1$/i;
  const isExtra = (name) => EXTRA_RE.test(String(name).trim());
  const label = (x) => (isExtra(x.name) ? "Additional guest" : x.name);
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
        const hitRow = demoRows.find((r) => r.invitation === key && !isExtra(r.name) && matches(r.name));
        if (hitRow || matches(key)) out.push(demoGroup(key, hitRow ? hitRow.name : null));
      }
      return { results: out.slice(0, MAX_RESULTS), more: out.length > MAX_RESULTS };
    }
    const res = await fetch(`${API}?action=search&q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "search failed");
    return { results: data.results, more: !!data.more };
  }

  async function apiRsvp(payload) {
    if (DEMO) {
      await new Promise((r) => setTimeout(r, 600));
      if (isClosed()) return { ok: false, code: "closed" };
      const saved = [], skipped = [];
      payload.answers.forEach((a) => {
        const row = demoRows.find((r) => r.id === a.id && r.invitation === payload.invitation);
        if (!row) return;
        if (row.status) { skipped.push(label(row)); return; }
        row.status = a.attending ? ATTENDING : NOT_ATTENDING;
        row.answeredBy = payload.answeredBy;
        saved.push(row.id);
      });
      return { ok: true, savedIds: saved, skipped, group: demoGroup(payload.invitation, null) };
    }
    // text/plain avoids a CORS preflight, which Apps Script doesn't support
    const res = await fetch(API, { method: "POST", body: JSON.stringify(payload) });
    return res.json();
  }

  // ---------- sound: background song + small Web Audio effects ----------
  const Sound = (() => {
    let ctx, master, musicGain, songNode = null, musicOn = false;
    const musicEl = new Audio("assets/audio/music.mp3"); // starts loading now, plays on the first tap
    musicEl.preload = "auto";

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

    function fadeIn(target) {
      musicGain.gain.cancelScheduledValues(ctx.currentTime);
      musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime);
      musicGain.gain.linearRampToValueAtTime(target, ctx.currentTime + 3);
    }
    function startMusic() {
      init();
      musicOn = true;
      musicEl.loop = true;
      if (ctx) {
        ctx.resume();
        // route the song through the mixer so the fade-in also works on iPhone (it ignores audio.volume)
        if (!songNode) { songNode = ctx.createMediaElementSource(musicEl); songNode.connect(musicGain); }
      } else {
        musicEl.volume = .5;
      }
      musicEl.play().then(() => ctx && fadeIn(.8)).catch(() => {});
    }
    function stopMusic() {
      musicOn = false;
      musicEl.pause();
      if (ctx) { musicGain.gain.cancelScheduledValues(ctx.currentTime); musicGain.gain.setValueAtTime(musicGain.gain.value, ctx.currentTime); musicGain.gain.linearRampToValueAtTime(0, ctx.currentTime + .4); }
    }
    const toggleMusic = () => (musicOn ? stopMusic() : startMusic(), musicOn);

    // pause when the tab/app is hidden (phones)
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { ctx && ctx.suspend(); musicEl.pause(); }
      else if (musicOn) { ctx && ctx.resume(); musicEl.play().catch(() => {}); }
    });

    return { init, paper, chime, tap, error, success, startMusic, toggleMusic };
  })();

  // ---------- falling leaves ----------
  const LEAF_COLORS = ["#c9a063", "#b98a64", "#dcc2a8", "#c08a7c", "#b9734f"];
  function spawnLeaf(burst) {
    const el = document.createElement("i");
    el.className = "leaf";
    const size = 8 + Math.random() * 10;
    el.style.cssText = `left:${Math.random() * 100}vw;width:${size}px;height:${size}px;--c:${LEAF_COLORS[Math.random() * LEAF_COLORS.length | 0]};--d:${(burst ? 5 : 10) + Math.random() * 8}s;animation-delay:${burst ? Math.random() * 1.5 : 0}s`;
    $(".leaves").appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }
  const leafBurst = (n) => { for (let i = 0; i < n; i++) spawnLeaf(true); };
  setInterval(() => document.hidden || spawnLeaf(false), 1400);

  // ---------- 1. intro ----------
  const intro = $("#intro"), gate = $("#gate"), site = $("#site");

  // opening sequence: seal pops → flap folds open → card glides out → scene dissolves into the RSVP page
  let opened = false;
  $("#openBtn").addEventListener("click", () => {
    if (opened) return;
    opened = true;
    Sound.init(); Sound.startMusic();
    const env = $("#envelope");
    const T = { flap: 700, rise: 2100, exit: 4700, done: 6400 };
    intro.classList.add("opening");
    env.classList.add("opening");
    for (let i = 0; i < 16; i++) {
      const b = document.createElement("i");
      const a = (Math.PI * 2 * i) / 16, r = 90 + Math.random() * 70;
      b.className = "burst";
      b.style.cssText = `--x:${Math.cos(a) * r}px;--y:${Math.sin(a) * r}px`;
      env.appendChild(b);
      b.addEventListener("animationend", () => b.remove());
    }
    setTimeout(() => { env.classList.add("flap"); Sound.paper(); }, T.flap);
    setTimeout(() => { env.classList.add("rise"); Sound.chime(); }, T.rise);
    setTimeout(() => {
      // show the next page underneath so the intro cross-fades into it
      const existing = loadRsvp();
      existing ? showSite(existing) : showGate();
      document.body.classList.add("locked");
      intro.classList.add("exit", "gone");
    }, T.exit);
    setTimeout(() => { document.body.classList.remove("locked"); $("#musicBtn").hidden = false; }, T.done);
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

  // "I haven't RSVP'd yet" / "I already RSVP'd": returning guests go straight to the details once we find their answer
  let mode = "new";
  const LEADS = {
    new: "Search your first or last name to confirm your attendance.",
    done: "Welcome back! Search your name and we'll take you straight to the wedding details.",
  };
  $$(".mode__btn").forEach((b) => b.addEventListener("click", () => {
    mode = b.dataset.mode;
    Sound.tap();
    $$(".mode__btn").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
    $("#lead").textContent = LEADS[mode];
    search.focus();
  }));

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
    renderResults(q, found.results, found.more);
  }

  function renderResults(q, found, more) {
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
    if (more) results.insertAdjacentHTML("beforeend", `<li class="empty">More invitations match “${escapeHtml(q)}”.<br>Add your first name to find yours, e.g. “Joyce Aquino”.</li>`);
  }

  let picks = {}; // guest id -> "yes" | "no"

  function openInvite(g) {
    if (mode === "done") {
      const me = g.guests.find((x) => x.name === g.hit) || null;
      const answered = me ? !!me.status : g.guests.some((x) => x.status);
      if (answered) { // their RSVP is in: skip straight to the details
        Sound.chime();
        current = g;
        rememberGroup(g);
        showSite(loadRsvp());
        return;
      }
    }
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
    const note = $("#inviteNote");
    note.hidden = mode !== "done";
    note.textContent = `We don't have ${g.hit ? `${g.hit.split(" ")[0]}'s` : "your"} RSVP yet, so please answer below. It only takes a moment!`;

    const pending = g.guests.filter((x) => !x.status);
    const allDone = !pending.length;
    $("#rsvpForm").hidden = allDone;
    $("#replied").hidden = !allDone;
    $("#question").textContent = allDone ? "Thank you for your RSVP!" : "Who will be celebrating with us?";
    $("#questionHint").hidden = allDone || n === 1;

    // who is answering: the searched name, else the first person not yet answered
    const named = g.guests.filter((x) => !isExtra(x.name));
    const me = g.hit || (named.find((x) => !x.status) || named[0] || g.guests[0]).name;
    $("#answeredBy").innerHTML = named.map((x) => `<option${x.name === me ? " selected" : ""}>${escapeHtml(x.name)}</option>`).join("");
    $(".as").hidden = named.length <= 1;

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
        return `<li class="person done"><span class="person__name">${escapeHtml(label(x))}${table}${by}</span>
          <span class="badge ${yes ? "badge--yes" : "badge--no"}">${yes ? "✓ Attending" : "Can't attend"}</span></li>`;
      }
      const p = picks[x.id];
      return `<li class="person"><span class="person__name">${escapeHtml(label(x))}${p ? "" : `<small>${isExtra(x.name) ? "a seat reserved for one more guest" : "not answered yet"}</small>`}</span>
        <span class="seg" role="radiogroup" aria-label="${escapeHtml(label(x))}">
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
      return `<li><span>${escapeHtml(label(x))}</span><b class="${yes ? "yes" : "no"}">${yes ? "✓ Attending" : "Can't attend"}</b></li>`;
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

    if (res.ok && !(res.savedIds || []).length) {
      // everyone they answered for was answered by someone else a moment earlier: show the latest answers instead
      openInvite({ ...res.group, hit: current.hit });
      Sound.error();
      const note = $("#inviteNote");
      note.textContent = `${(res.skipped || []).join(", ")} ${res.skipped && res.skipped.length > 1 ? "were" : "was"} just answered by someone else. Their answers are shown below.`;
      note.hidden = false;
    } else if (res.ok) {
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
    const colors = ["#c08a7c", "#b9734f", "#c9a063", "#7a4a35"];
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
    const saved = g.guests.filter((x) => (res.savedIds || []).includes(x.id));
    const coming = saved.filter((x) => x.status === ATTENDING);
    const pending = g.guests.filter((x) => !x.status && !isExtra(x.name));
    const lines = [];
    if (coming.length) lines.push(`<strong>${coming.length}</strong> guest${plural(coming.length)} confirmed: ${coming.map((x) => escapeHtml(label(x))).join(", ")}.`);
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
      return `<li><span>${escapeHtml(label(x))}</span><small>${st}${table}</small></li>`;
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
  const sp = document.createElement("div");
  sp.className = "hero__sparkles";
  sp.innerHTML = Array.from({ length: 18 }, () =>
    `<i style="left:${Math.random() * 100}%;--d:${7 + Math.random() * 7}s;--delay:${-Math.random() * 12}s;--x:${(Math.random() - .5) * 120}px;transform:scale(${.5 + Math.random()})"></i>`).join("");
  $(".hero").appendChild(sp);

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
    tag.textContent = "Preview mode · answers are not saved";
    document.body.appendChild(tag);
  }
})();
