// ============================================================================
//  Guestbook — writes + reads go through the Lamma backend (not Firestore),
//  so the owning host can see wishes in /user/.../responses and no PII is
//  readable by anonymous clients. Poll-based "live" feed: refresh every 25s
//  while the tab is visible.
// ============================================================================
//
//  Shared by every template that uses this markup: each template's
//  js/guestbook.js passes its own CONFIG in. Edit here, not in the folders.

export function initGuestbook(CONFIG) {

  const SLUG     = CONFIG.slug || "demo";
  const POST_URL = `/api/invitations/${encodeURIComponent(SLUG)}/wishes`;
  const LIST_URL = `/api/invitations/${encodeURIComponent(SLUG)}/wishes?limit=100`;
  const POLL_MS  = 25000;

  const form       = document.getElementById("gb-form");
  const nameEl     = document.getElementById("gb-name");
  const messageEl  = document.getElementById("gb-message");
  const submitBtn  = form ? form.querySelector('button[type="submit"]') : null;
  const statusEl   = document.getElementById("gb-status");
  const listEl     = document.getElementById("gb-list");
  const emptyEl    = document.getElementById("gb-empty");
  const nameErr    = document.querySelector('.error[data-for="gb-name"]');
  const messageErr = document.querySelector('.error[data-for="gb-message"]');

  /* ------------------------ Inline validation helpers ------------------------ */
  function showError(input, errSpan, msg) {
    if (errSpan) errSpan.textContent = msg;
    input && input.classList.toggle("invalid", Boolean(msg));
  }
  if (nameEl)    nameEl.addEventListener("input",    () => showError(nameEl,    nameErr,    ""));
  if (messageEl) messageEl.addEventListener("input", () => showError(messageEl, messageErr, ""));

  /* ------------------------ Submit → POST /api/wishes ------------------------ */
  if (form) {
    form.setAttribute("novalidate", "");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const name    = (nameEl.value    || "").trim();
      const message = (messageEl.value || "").trim();

      let ok = true;
      if (!name)    { showError(nameEl,    nameErr,    "Please enter your name."); ok = false; }
      if (!message) { showError(messageEl, messageErr, "Please write a wish.");    ok = false; }
      if (!ok) { (nameEl.value ? messageEl : nameEl).focus(); return; }

      submitBtn.disabled = true;
      if (statusEl) {
        statusEl.textContent = "Sending your wish…";
        statusEl.className   = "rsvp-status pending";
      }

      try {
        const r = await fetch(POST_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, message }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        form.reset();
        if (statusEl) {
          statusEl.textContent = "Thank you, your wish has been saved 💌";
          statusEl.className   = "rsvp-status success";
        }
        // Pull the fresh list immediately so the submitter sees their own wish.
        loadWishes();
      } catch (err) {
        console.error(err);
        if (statusEl) {
          statusEl.textContent = "Something went wrong. Please try again.";
          statusEl.className   = "rsvp-status error";
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }

  /* ------------------------ Poll-based list render --------------------------- */
  function relativeTime(then) {
    if (!then) return "just now";
    const s = Math.floor((Date.now() - then.getTime()) / 1000);
    if (s < 60)        return "just now";
    if (s < 3600)      return `${Math.floor(s / 60)}m ago`;
    if (s < 86400)     return `${Math.floor(s / 3600)}h ago`;
    if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
    return then.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function renderEntries(entries) {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = entries.length > 0;

    for (const e of entries) {
      const li = document.createElement("li");
      li.className = "wish";
      li.setAttribute("dir", "auto");

      const header = document.createElement("div");
      header.className = "wish-header";

      const name = document.createElement("span");
      name.className = "wish-name";
      name.setAttribute("dir", "auto");
      name.textContent = e.name;

      const when = document.createElement("span");
      when.className = "wish-when";
      when.textContent = relativeTime(e.createdAt);

      header.append(name, when);

      const body = document.createElement("p");
      body.className = "wish-body";
      body.setAttribute("dir", "auto");
      body.textContent = e.message;

      li.append(header, body);
      listEl.appendChild(li);
    }
  }

  // Guard against overlapping fetches: a slow earlier response arriving
  // AFTER a newer one would overwrite the fresh list with stale data. The
  // in-flight flag plus an incrementing seq number makes stale responses
  // a no-op even if the browser resolves them out of order.
  let gbInFlight = false;
  let gbSeq = 0;
  async function loadWishes() {
    if (!listEl || gbInFlight) return;
    gbInFlight = true;
    const myTicket = ++gbSeq;
    try {
      const r = await fetch(LIST_URL, { credentials: "same-origin" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      // Another, newer load started between our fetch() and our resolve.
      if (myTicket !== gbSeq) return;
      const entries = (j.wishes || []).map((w) => ({
        id: w.id,
        name: w.name || "",
        message: w.message || "",
        createdAt: w.created_at ? new Date(w.created_at) : null,
      }));
      renderEntries(entries);
    } catch (err) {
      console.warn("[guestbook]", err);
      if (emptyEl && !listEl.children.length) {
        emptyEl.hidden = false;
        emptyEl.textContent = "Could not load wishes right now.";
      }
    } finally {
      gbInFlight = false;
    }
  }

  if (listEl) {
    loadWishes();
    // Pause polling when the tab is hidden to save bandwidth + server load.
    setInterval(() => { if (!document.hidden) loadWishes(); }, POLL_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) loadWishes();
    });
  }
}
