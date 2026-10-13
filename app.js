(() => {
  "use strict";

  const WEDDING_DATE = new Date("2026-12-12T14:00:00+08:00"); // placeholder
  const STORAGE_KEY = "cr-wedding-rsvp";
  const MIN_CHARS = 3;
  const MAX_RESULTS = 5;

  const $ = (s) => document.querySelector(s);
  const guests = window.GUESTS || [];

  // ---------- helpers ----------
  const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const loadRsvp = () => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch { return null; } };
  const saveRsvp = (r) => { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(r)); } catch {} };
  const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- sound (Web Audio; no files needed) ----------
  const Sound = (() => {
    let ctx, master, musicGain, musicTimer, musicEl, musicOn = false;

    function init() {
      if (ctx) return;
      ctx = new (window.AudioContext || window.webkitAudioContext)();
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

    // Background music: uses assets/audio/music.mp3 if present, otherwise a gentle generated music-box loop.
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
      init(); ctx.resume();
      musicOn = true;
      musicEl = musicEl || new Audio("assets/audio/music.mp3");
      musicEl.loop = true; musicEl.volume = .5;
      musicEl.play().catch(() => { // no file → generated melody
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
      if (!ctx) return;
      if (document.hidden) { ctx.suspend(); musicEl && musicEl.pause(); }
      else if (musicOn) { ctx.resume(); musicEl && !musicEl.error && musicEl.play().catch(() => {}); }
    });

    return { init, paper, chime, tap, error, success, startMusic, toggleMusic };
  })();

  // ---------- falling leaves ----------
  const LEAF_COLORS = ["#a87b51", "#7b5232", "#cfb08a", "#6b6f4e", "#b5653a"];
  function spawnLeaf(burst) {
    const el = document.createElement("i");
    el.className = "leaf";
    const size = 10 + Math.random() * 14;
    el.style.cssText = `left:${Math.random() * 100}vw;width:${size}px;height:${size}px;--c:${LEAF_COLORS[Math.random() * LEAF_COLORS.length | 0]};--d:${(burst ? 5 : 10) + Math.random() * 8}s;animation-delay:${burst ? Math.random() * 1.5 : 0}s`;
    $(".leaves").appendChild(el);
    el.addEventListener("animationend", () => el.remove());
  }
  const leafBurst = (n = 30) => { for (let i = 0; i < n; i++) spawnLeaf(true); };
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) setInterval(() => document.hidden || spawnLeaf(false), 1600);

  // ---------- photos: placeholder until real files are added ----------
  document.querySelectorAll("img[data-placeholder]").forEach((img) => {
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
  const searchCard = $(".gate__card");
  let current = null, choice = null, count = 1;

  function showGate() {
    gate.hidden = false; site.hidden = true;
    document.body.classList.remove("locked");
    searchCard.hidden = false; invite.hidden = true; thanks.hidden = true;
    requestAnimationFrame(() => searchCard.classList.add("in"));
    window.scrollTo(0, 0);
  }

  function matches(q) {
    const tokens = norm(q).split(" ").filter(Boolean);
    return guests
      .map((g) => {
        const names = [g.name, ...(g.members || [])].map(norm);
        const words = names.join(" ").split(" ");
        const ok = tokens.every((t) => words.some((w) => w.startsWith(t)));
        const hit = (g.members || []).find((m) => tokens.every((t) => norm(m).split(" ").some((w) => w.startsWith(t))));
        return ok && { g, hit };
      })
      .filter(Boolean)
      .slice(0, MAX_RESULTS);
  }

  let debounce;
  search.addEventListener("input", () => {
    clearTimeout(debounce);
    debounce = setTimeout(renderResults, 150);
  });

  function renderResults() {
    const q = search.value.trim();
    results.innerHTML = "";
    if (norm(q).length < MIN_CHARS) return;
    const found = matches(q);
    if (!found.length) {
      results.innerHTML = `<li class="empty">No invitation found for “${escapeHtml(q)}”.<br>Try your last name or check the spelling.</li>`;
      return;
    }
    const mine = loadRsvp();
    found.forEach(({ g, hit }, i) => {
      const li = document.createElement("li");
      li.setAttribute("role", "option");
      li.style.animationDelay = `${i * 60}ms`;
      const sub = hit && hit !== g.name ? `<span class="r-sub">includes ${escapeHtml(hit)}</span>` : "";
      const done = mine && mine.id === g.id;
      li.innerHTML = `<span class="r-name">${escapeHtml(g.name)}${sub}</span><span class="r-seats ${done ? "r-done" : ""}">${done ? "Replied" : `${g.seats} seat${g.seats > 1 ? "s" : ""}`}</span>`;
      li.addEventListener("click", () => openInvite(g));
      results.appendChild(li);
    });
  }

  function openInvite(g) {
    Sound.chime();
    current = g; choice = null; count = g.seats;
    searchCard.hidden = true; invite.hidden = false;
    $("#guestName").textContent = g.name;
    $("#guestMembers").textContent = g.members && g.members.length > 1 ? g.members.join(" · ") : "";
    $("#seatCount").textContent = g.seats;
    $("#seatPlural").textContent = g.seats > 1 ? "s" : "";
    $("#seatIcons").innerHTML = Array.from({ length: g.seats }, (_, i) => `<i style="animation-delay:${.4 + i * .12}s"></i>`).join("");
    document.querySelectorAll(".choice").forEach((b) => b.setAttribute("aria-checked", "false"));
    $("#countWrap").hidden = true;
    $("#message").value = "";
    $("#submitBtn").disabled = true;
    // restore previous answer if changing
    const prev = loadRsvp();
    if (prev && prev.id === g.id) {
      setChoice(prev.attending ? "yes" : "no", true);
      if (prev.attending) setCount(prev.count);
      $("#message").value = prev.message || "";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("#backBtn").addEventListener("click", () => {
    Sound.tap();
    invite.hidden = true; searchCard.hidden = false;
    search.focus();
  });

  function setChoice(c, silent) {
    choice = c;
    if (!silent) Sound.tap();
    document.querySelectorAll(".choice").forEach((b) => b.setAttribute("aria-checked", String(b.dataset.choice === c)));
    $("#countWrap").hidden = !(c === "yes" && current.seats > 1);
    setCount(c === "yes" ? count : 0);
    $("#submitBtn").disabled = false;
  }
  document.querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => setChoice(b.dataset.choice)));

  function setCount(n) {
    if (choice === "yes") count = Math.max(1, Math.min(current.seats, n || 1));
    $("#attending").textContent = count;
    $("#minus").disabled = count <= 1;
    $("#plus").disabled = count >= current.seats;
    document.querySelectorAll("#seatIcons i").forEach((i, idx) => i.classList.toggle("unused", choice === "no" || (choice === "yes" && idx >= count)));
  }
  $("#minus").addEventListener("click", () => { Sound.tap(); setCount(count - 1); });
  $("#plus").addEventListener("click", () => { Sound.tap(); setCount(count + 1); });

  $("#submitBtn").addEventListener("click", async () => {
    if (!choice) { Sound.error(); invite.classList.add("shake"); setTimeout(() => invite.classList.remove("shake"), 400); return; }
    const btn = $("#submitBtn");
    btn.disabled = true; btn.textContent = "Sending…";
    const rsvp = {
      id: current.id, name: current.name, seats: current.seats,
      attending: choice === "yes", count: choice === "yes" ? count : 0,
      message: $("#message").value.trim(), at: new Date().toISOString()
    };
    await submitRsvp(rsvp);
    saveRsvp(rsvp);
    btn.textContent = "Send my RSVP";
    showThanks(rsvp);
  });

  // Netlify Forms (free tier). Fails silently when opened locally.
  async function submitRsvp(r) {
    const body = new URLSearchParams({
      "form-name": "rsvp", guest_id: r.id, guest_name: r.name, seats_reserved: r.seats,
      attending: r.attending ? "Yes" : "No", attending_count: r.count, message: r.message
    });
    try { await fetch("/", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body }); } catch {}
  }

  function showThanks(r) {
    invite.hidden = true; thanks.hidden = false;
    if (r.attending) {
      Sound.success(); leafBurst(40);
      $("#thanksIcon").textContent = "♥";
      $("#thanksTitle").textContent = "See you there!";
      $("#thanksText").innerHTML = `We can't wait to celebrate with you.<br><strong>${r.count} of ${r.seats}</strong> seat${r.seats > 1 ? "s" : ""} confirmed.`;
    } else {
      Sound.chime();
      $("#thanksIcon").textContent = "✉";
      $("#thanksTitle").textContent = "You'll be missed";
      $("#thanksText").textContent = "Thank you for letting us know. You'll be in our hearts on our special day.";
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  $("#enterBtn").addEventListener("click", () => { Sound.tap(); showSite(loadRsvp()); });

  // ---------- 3. main site ----------
  function showSite(r) {
    gate.hidden = true; site.hidden = false;
    document.body.classList.remove("locked");
    window.scrollTo(0, 0);
    $("#myRsvp").innerHTML = r.attending
      ? `<strong>${escapeHtml(r.name)}</strong> — attending, ${r.count} of ${r.seats} seat${r.seats > 1 ? "s" : ""}.`
      : `<strong>${escapeHtml(r.name)}</strong> — unable to attend.`;
  }

  $("#changeBtn").addEventListener("click", () => {
    const r = loadRsvp();
    const g = r && guests.find((x) => x.id === r.id);
    showGate();
    if (g) openInvite(g);
  });

  // scroll reveal
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
  }), { threshold: .15 });
  document.querySelectorAll("#site .reveal").forEach((el) => io.observe(el));

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
})();
