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

    outside = []
    page.on("request", lambda r: outside.append(r.url)
            if re.search(r"github|jsdelivr\.net/gh|firestore|firebasejs", r.url) else None)
    page.goto(base + "/rana-e2e")
    page.wait_for_function("document.getElementById('hero-name').textContent.startsWith('Rana')")
    assert page.title() == "Happy Birthday, Rana"
    assert outside == []
    page.goto(base + "/no-such-birthday")
    page.wait_for_selector("text=/not found|isn.t available|مش متاحة/i")
    assert page.js_errors == []
