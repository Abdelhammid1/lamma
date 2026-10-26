"""The four flows from the audit, end to end in Chromium:
buyer (create → sign in → publish), guest (open, RSVP, wish),
owner (dashboard, activate later, edit + save), admin (create for a
new host → password link). Each also fails on any uncaught JS error.
"""
from __future__ import annotations

import re
import urllib.request

from conftest import sign_in  # e2e/conftest.py (pytest puts e2e/ on sys.path)

TINY_WAV = "tone.wav"   # built in the page by pick_file, no file on disk


def pick_file(page, selector, src, name):
    """Put a file into a file input without the OS file dialog: fetched
    from the site (src starts with "/"), or a 0.1 s generated tone."""
    page.evaluate(
        """async ([sel, src, name]) => {
            let blob;
            if (src.startsWith('/')) {
                blob = await (await fetch(src)).blob();
            } else {
                const n = 800, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
                const w = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
                w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
                v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
                v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true);
                v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
                blob = new Blob([b], { type: 'audio/wav' });
            }
            const dt = new DataTransfer();
            dt.items.add(new File([blob], name, { type: blob.type }));
            const input = document.querySelector(sel);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }""",
        [selector, src, name],
    )


def fill_wedding(page, groom="Omar", bride="Laila"):
    page.fill("#f-groom", groom)
    page.fill("#f-bride", bride)
    page.fill("#f-event-datetime", "2026-12-12T19:00")
    page.fill("#f-venue-name", "Solitaire Hall")
    page.fill("#f-venue-address", "Corniche El Nil, Maadi")
    page.fill("#f-venue-maps", "https://maps.app.goo.gl/AhvV1WDhUhArTbwU9")
    page.fill("#f-blessing", "Our joy is complete with you")
    page.click("#add-schedule-btn")
    page.fill("#schedule-builder .sched-time", "19:00")
    page.fill("#schedule-builder .sched-label", "Dinner")
    page.click("#add-contact-btn")
    page.fill("#contacts-builder .c-name", "Ali")
    page.fill("#contacts-builder .c-phone", "+201001234567")
    pick_file(page, "#gallery-builder .mem-file", "/logo.jpg", "couple.jpg")
    pick_file(page, "#f-wedding-music", TINY_WAV, "our-song.wav")


def publish_with(page, code):
    page.fill("#f-code", code)
    page.click("#publish-btn")


# --- buyer --------------------------------------------------------------------

def test_buyer_creates_signs_in_and_publishes(page, site):
    base = site["base"]
    page.goto(base + "/create?type=wedding")
    fill_wedding(page)
    # The link hint updates once the address has been checked.
    page.wait_for_function(
        "document.getElementById('slug-preview').textContent === 'lamma.manasety.ai/wedding/omar-laila'")

    # Not signed in: Publish asks to sign in instead of failing.
    publish_with(page, "GOOD-CODE-0001")
    page.wait_for_selector("#signin-gate:not([hidden])")

    sign_in(page, site)                                   # comes back to /create
    page.goto(base + "/create.html?type=wedding")
    page.wait_for_selector("#draft-note:not([hidden])")
    assert page.input_value("#f-groom") == "Omar"         # draft restored
    pick_file(page, "#gallery-builder .mem-file", "/logo.jpg", "couple.jpg")
    pick_file(page, "#f-wedding-music", TINY_WAV, "our-song.wav")

    # Wrong code: refused before anything is reserved.
    publish_with(page, "WRNG-CODE-0000")
    page.wait_for_function("document.getElementById('code-error').textContent.length > 0")
    status = urllib.request.urlopen(urllib.request.Request(
        base + "/api/check-slug", data=b'{"slug":"omar-laila"}',
        headers={"Content-Type": "application/json"}))
    assert b'"available":true' in status.read()

    publish_with(page, "GOOD-CODE-0001")
    page.wait_for_selector("#success-screen:not([hidden])", timeout=20_000)
    assert page.text_content("#success-url").endswith("/wedding/omar-laila")
    assert page.evaluate("localStorage.getItem('lamma:create-draft')") is None
    assert page.js_errors == []


# --- guest --------------------------------------------------------------------

def test_guest_page_rsvp_and_wish(page, site):
    base = site["base"]
    html = urllib.request.urlopen(base + "/wedding/omar-laila").read().decode()
    assert "<title>Omar &amp; Laila · Wedding</title>" in html
    assert 'og:image" content="https://lamma.manasety.ai/media/omar-laila/' in html

    page.goto(base + "/wedding/omar-laila")
    page.click("#open-btn")
    assert "Omar" in page.text_content("#cover")
    assert page.text_content("#ann-blessing") == "Our joy is complete with you"
    assert page.get_attribute("audio", "src").startswith("/media/omar-laila/")
    assert "Solitaire" in page.get_attribute("#venue-iframe", "src")
    assert "Dinner" in page.text_content("#schedule-list")           # shared schedule module
    assert "Ali" in page.text_content("#contacts")                   # shared contacts module

    page.click("#rsvp-open")
    page.fill("#rsvp-name", "Guest One")
    page.fill("#rsvp-guests", "2")
    page.click("#rsvp-form button[type=submit]")
    page.wait_for_function("/thank|see you|received|confirmed/i.test(document.getElementById('rsvp-status').textContent)")

    page.fill("#gb-name", "Guest One")
    page.fill("#gb-message", "Mabrook!")
    page.click("#gb-form button[type=submit]")
    page.wait_for_selector("#gb-list li:has-text('Mabrook!')")
    assert page.js_errors == []


def test_unknown_link_says_not_available(page, site):
    page.goto(site["base"] + "/wedding/no-such-couple")
    page.wait_for_selector("text=This invitation isn't available")
    page.goto(site["base"] + "/wedding/")
    page.wait_for_selector("text=Ahmed")                             # bare template = demo
    assert page.js_errors == []


# --- owner --------------------------------------------------------------------

def test_owner_dashboard_activate_later_and_edit(page, site):
    base = site["base"]
    sign_in(page, site)
    # An invitation created but never activated.
    page.evaluate("""() => fetch('/api/events', {method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({slug: 'baby-yassin', event_type: 'sobou',
                              payload_json: {couple: {groom: 'Yassin', bride: 'Family'}}})})""")
    page.goto(base + "/user/")
    card = page.locator(".event-card[data-slug='baby-yassin']")
    card.locator("input[name=code]").fill("GOOD-CODE-0002")
    card.locator("button[type=submit]").click()
    page.wait_for_selector(".event-card[data-slug='baby-yassin'] >> text=Published")

    wedding = page.locator(".event-card[data-slug='omar-laila']")
    assert "Omar & Laila" in wedding.inner_text()
    assert "1 attending" in re.sub(r"\s+", " ", wedding.inner_text())

    # Edit: change the venue, keep the song.
    wedding.locator("text=Edit").click()
    page.wait_for_selector("text=Current song")
    assert page.text_content("#cx-title") == "Edit your invitation"
    page.fill("#f-venue-name", "Solitaire Hall Maadi")
    page.click("#publish-btn")
    page.wait_for_function("document.getElementById('progress-text').textContent === 'Saved.'")
    data = urllib.request.urlopen(base + "/data/omar-laila.json").read().decode()
    assert "Solitaire Hall Maadi" in data and "/media/omar-laila/music-" in data
    assert page.js_errors == []


# --- admin --------------------------------------------------------------------

def test_admin_creates_for_new_host_who_sets_a_password(page, site):
    base = site["base"]
    sign_in(page, site, "admin")
    page.goto(base + "/create.html?admin_create=1&type=engagement")
    page.fill("#f-host-email", "new-host@e2e.test")
    page.fill("#f-groom", "Karim")
    page.fill("#f-bride", "Mona")
    page.wait_for_function("!document.getElementById('publish-btn').disabled")
    page.click("#publish-btn")
    page.wait_for_selector("#claim-block:not([hidden])", timeout=20_000)
    claim = page.text_content("#claim-url")

    page.context.clear_cookies()
    page.goto(claim)
    page.fill('input[name="password"]', "new-host-pass-123")
    page.click('button[type="submit"]')
    page.wait_for_url(re.compile(r"/user/?$"))
    assert "Karim & Mona" in page.text_content("body")
    assert page.js_errors == []


# --- classic birthday (the template the GitHub-migrated invitations use) ---

def test_classic_birthday_loads_from_the_server_only(page, site):
    """Shaped like an invitation moved over by `flask migrate-github`:
    /media links, no GitHub or Firestore fallback left to hide a miss."""
    base = site["base"]
    sign_in(page, site)
    created = page.evaluate("""async () => {
        const r = await fetch('/api/events', {method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({slug: 'rana-e2e', event_type: 'birthday', payload_json: {
                name: 'Rana', letterAr: 'لصديقة عمري', letterEn: 'To my best friend',
                quiz: [{question: 'q?', options: ['a', 'b'], correctIndex: 1}],
                memories: [{url: '/logo.jpg', dateLabel: '15/9/2026'}]}})});
        const ev = await r.json();
        const a = await fetch(`/api/events/${ev.event_id}/activate`, {method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({code: 'GOOD-CODE-0003'})});
        return a.status;
    }""")
    assert created == 200

    # Nothing may leave the site except Google Fonts — no GitHub,
    # jsDelivr (scripts included), Firebase or any other CDN.
    allowed = (base, "https://fonts.googleapis.com/", "https://fonts.gstatic.com/")
    outside = []
    page.on("request", lambda r: outside.append(r.url)
            if not r.url.startswith(allowed) and not r.url.startswith(("data:", "blob:")) else None)
    page.goto(base + "/rana-e2e")
    page.wait_for_function("document.getElementById('hero-name').textContent.startsWith('Rana')")
    assert page.title() == "Happy Birthday, Rana"
    assert page.evaluate("typeof confetti") == "function"       # self-hosted, loaded
    assert outside == []
    page.goto(base + "/no-such-birthday")
    page.wait_for_selector("text=/not found|isn.t available|مش متاحة/i")
    assert page.js_errors == []


# --- Wedding · Burgundy: form → publish → every section → edit ------------

def test_burgundy_end_to_end(page, site):
    base = site["base"]
    allowed = (base, "https://fonts.googleapis.com/", "https://fonts.gstatic.com/")
    outside = []
    page.on("request", lambda r: outside.append(r.url)
            if not r.url.startswith(allowed) and not r.url.startswith(("data:", "blob:")) else None)

    sign_in(page, site)
    page.goto(base + "/create.html?type=wedding-burgundy")
    page.wait_for_selector("#burgundy-group:not([hidden])")
    assert page.is_hidden("#elegant-group")
    fill_wedding(page, groom="Karim", bride="Nour")
    page.fill("#f-groom-full", "Karim Adel")
    page.fill("#f-bride-full", "Nour Samir")
    page.fill("#f-family-groom", "Mr. & Mrs.\nAdel Fathy")
    page.fill("#f-family-bride", "Mr. & Mrs.\nSamir Lotfy")
    page.fill("#f-ceremony-place", "Al-Sayeda Nafisa Mosque")
    page.fill("#f-gift-message", "Your presence is our gift")
    page.fill("#f-gift-details", "InstaPay: karim@instapay")
    page.wait_for_function(
        "document.getElementById('slug-preview').textContent === 'lamma.manasety.ai/wedding-burgundy/karim-nour'")
    publish_with(page, "GOOD-CODE-0004")
    page.wait_for_selector("#success-screen:not([hidden])", timeout=20_000)

    html = urllib.request.urlopen(base + "/wedding-burgundy/karim-nour").read().decode()
    assert "<title>Karim &amp; Nour · Wedding</title>" in html

    page.goto(base + "/wedding-burgundy/karim-nour")
    # The template fills the cover a moment after load (modules load async).
    page.wait_for_function("document.getElementById('cover-groom').textContent === 'Karim'")
    assert page.is_hidden("#invitation")
    page.click("#open-btn")
    page.wait_for_selector("#invitation", state="visible")
    assert page.get_attribute("#hero-photo", "src").startswith("/media/karim-nour/")
    assert page.text_content("#family-groom") == "Mr. & Mrs.\nAdel Fathy"
    assert page.text_content("#full-bride") == "Nour Samir"
    assert page.text_content("#ceremony-place") == "Al-Sayeda Nafisa Mosque"
    assert page.text_content("#reception-place") == "Solitaire Hall"
    assert page.locator("#car-count").count() == 0                     # no "1 / 5" under the photos
    assert re.match(r"\d+ days \d+ hours \d+ min \d+ sec", page.text_content("#countdown"))
    assert page.text_content(".cal-event") == "12"                     # 12 December
    assert "Dinner" in page.text_content("#schedule-list")
    assert "7:00 PM" in page.text_content("#schedule-list")             # 12-hour clock
    assert page.get_attribute("audio", "src").startswith("/media/karim-nour/")
    assert "Ali" in page.text_content("#contacts")

    # Gift box: closed until tapped, then the details with a Copy button.
    assert page.is_hidden("#gift-card")
    page.click("#gift-open")
    assert page.text_content("#gift-details") == "InstaPay: karim@instapay"
    assert page.is_visible("#gift-copy")
    assert page.text_content("#gift-message") == "Your presence is our gift"

    page.click("#rsvp-open")
    page.fill("#rsvp-name", "Guest Two")
    page.click("#rsvp-form button[type=submit]")
    page.wait_for_function("/thank/i.test(document.getElementById('rsvp-status').textContent)")
    page.fill("#gb-name", "Guest Two")
    page.fill("#gb-message", "Alf mabrook")
    page.click("#gb-form button[type=submit]")
    page.wait_for_selector("#gb-list li:has-text('Alf mabrook')")
    assert outside == [], outside
    assert page.js_errors == []

    # Edit: change only the gift message; song, photo and the rest stay.
    page.goto(base + "/user/")
    page.locator(".event-card[data-slug='karim-nour'] >> text=Edit").click()
    page.wait_for_selector("text=Current song")
    assert page.input_value("#f-family-bride") == "Mr. & Mrs.\nSamir Lotfy"
    page.fill("#f-gift-message", "Thank you for coming")
    page.click("#publish-btn")
    page.wait_for_function("document.getElementById('progress-text').textContent === 'Saved.'")
    data = urllib.request.urlopen(base + "/data/karim-nour.json").read().decode()
    for kept in ("Thank you for coming", "InstaPay: karim@instapay", "Al-Sayeda Nafisa Mosque",
                 "/media/karim-nour/music-", "/media/karim-nour/gallery-", "Karim Adel"):
        assert kept in data, kept
    assert page.js_errors == []


# --- preview links can't be forged -------------------------------------------

def test_hand_made_preview_link_is_ignored_but_create_preview_works(page, site):
    """?preview=1&data=… used to render whatever the link carried, on our
    domain — e.g. a fake payment number in the gift box. Only our own
    /create may hand a preview its content now."""
    import base64, json
    base = site["base"]
    fake = {"couple": {"groom": "Scam", "bride": "Couple"},
            "gift": {"message": "Send money", "details": "Wallet 0100 000 0000"}}
    data = base64.b64encode(json.dumps(fake).encode()).decode()

    page.goto(f"{base}/wedding-burgundy/index.html?preview=1&data={data}")
    page.wait_for_timeout(800)
    assert page.text_content("#cover-groom") == "Omar"          # the demo, not the link's data
    assert "Wallet" not in page.content()
    assert page.locator("#lamma-preview-banner").count() == 0

    # The real thing: the create page's preview iframe shows what was typed…
    sign_in(page, site)
    page.goto(base + "/create.html?type=wedding-burgundy")
    page.fill("#f-groom", "Real")
    page.fill("#f-bride", "Host")
    frame = page.frame_locator("#preview-frame")
    page.wait_for_function(
        "() => document.querySelector('#preview-frame')?.contentDocument?.getElementById('cover-groom')?.textContent === 'Real'",
        timeout=15_000)
    # …and "Open in new tab" too, with the preview banner on top.
    with page.context.expect_page() as new_tab:
        page.click("#preview-open")
    tab = new_tab.value
    tab.wait_for_selector("#lamma-preview-banner")
    assert tab.text_content("#cover-groom") == "Real"
    assert page.js_errors == []


def test_preview_framed_by_another_site_page_is_ignored(page, site):
    """Same origin is not enough: only /create itself may feed a preview."""
    import base64, json
    base = site["base"]
    fake = {"couple": {"groom": "Scam", "bride": "Couple"}}
    data = base64.b64encode(json.dumps(fake).encode()).decode()
    page.goto(base + "/wedding/")                                   # some other page on our site
    page.evaluate(f"""() => {{ const f = document.createElement('iframe');
        f.id = 'probe'; f.src = '/wedding-burgundy/index.html?preview=1&data={data}';
        document.body.appendChild(f); }}""")
    page.wait_for_function("() => document.getElementById('probe')?.contentDocument?.getElementById('cover-groom')?.textContent")
    page.wait_for_timeout(600)
    assert page.evaluate("document.getElementById('probe').contentDocument.getElementById('cover-groom').textContent") == "Omar"


def test_preview_inside_a_framed_create_page_is_ignored(page, site):
    """/create framed by someone else (its preview iframe re-pointed at a
    crafted URL) must not count: the create page has to be top-level."""
    import base64, json
    base = site["base"]
    data = base64.b64encode(json.dumps({"couple": {"groom": "Scam", "bride": "X"}}).encode()).decode()
    page.goto(base + "/wedding/")
    page.evaluate("""() => { const f = document.createElement('iframe'); f.id = 'outer';
        f.src = '/create.html?type=wedding-burgundy'; f.style.width = '1200px'; f.style.height = '800px';
        document.body.appendChild(f); }""")
    page.wait_for_function("() => document.getElementById('outer')?.contentDocument?.getElementById('preview-frame')")
    page.evaluate(f"""() => {{ const pf = document.getElementById('outer').contentDocument.getElementById('preview-frame');
        pf.src = '/wedding-burgundy/index.html?preview=1&data={data}'; }}""")
    page.wait_for_timeout(2500)
    groom = page.evaluate("""() => document.getElementById('outer').contentDocument
        .getElementById('preview-frame').contentDocument.getElementById('cover-groom')?.textContent""")
    assert groom == "Omar"


def test_burgundy_carousel_moves_only_on_a_sideways_swipe(page, site):
    page.emulate_media(reduced_motion="reduce")   # holds still: only the guest moves it here
    page.goto(site["base"] + "/wedding-burgundy/")
    page.click("#open-btn")
    # Opening scrolls back to the top after its fade; wait for that first.
    page.wait_for_function("document.body.classList.contains('opened')")
    page.wait_for_timeout(300)
    page.wait_for_selector("#car-track .slide.is-current")
    page.locator("#gallery").scroll_into_view_if_needed()
    page.wait_for_timeout(300)
    current = lambda: page.evaluate(
        "[...document.querySelectorAll('#car-track .slide')].findIndex(s => s.classList.contains('is-current'))")
    box = page.locator("#car-track .slide.is-current").bounding_box()
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2

    def drag(dx, dy):
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + dx / 2, cy + dy / 2)
        page.mouse.move(cx + dx, cy + dy)
        page.mouse.up()
        page.wait_for_timeout(250)

    assert current() == 0
    drag(60, 140)                 # mostly vertical, like scrolling past it
    assert current() == 0
    assert not page.is_visible("#lightbox")   # a drag is not a tap on the photo
    drag(-120, 10)                # a real swipe to the left
    assert current() == 1         # exactly one step (the click after it is ignored)
    page.wait_for_timeout(700)    # let the 3D turn settle
    # Tap the strip of the right-hand photo that shows beside the middle one.
    mid = page.locator("#car-track .slide.is-current").bounding_box()
    side = page.locator("#car-track .slide").nth(2).bounding_box()
    x = (mid["x"] + mid["width"] + side["x"] + side["width"]) / 2
    hit = page.evaluate(f"document.elementFromPoint({x}, {side['y'] + side['height'] / 2})?.getAttribute('aria-label')")
    assert hit == "Photo 3 of 3", hit
    page.mouse.click(x, side["y"] + side["height"] / 2)
    page.wait_for_timeout(250)
    assert current() == 2         # tapping a side photo still brings it in
    assert page.locator("#car-count").count() == 0
    assert page.js_errors == []


def test_burgundy_carousel_turns_by_itself(page, site):
    page.goto(site["base"] + "/wedding-burgundy/")
    page.click("#open-btn")
    page.wait_for_function("document.body.classList.contains('opened')")
    page.wait_for_timeout(300)
    page.locator("#gallery").scroll_into_view_if_needed()
    current = "[...document.querySelectorAll('#car-track .slide')].findIndex(s => s.classList.contains('is-current'))"
    start = page.evaluate(current)
    page.wait_for_function(f"({current}) === {(start + 1) % 3}", timeout=9000)
    # While the full-screen viewer is open the carousel stays where it is.
    page.locator("#car-track .slide.is-current").click()
    page.wait_for_selector("#lightbox.open")
    held = page.evaluate(current)
    page.wait_for_timeout(5000)
    assert page.evaluate(current) == held
    assert page.js_errors == []
