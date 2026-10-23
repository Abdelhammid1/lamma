// ============================================================================
//  Contacts — WhatsApp + Call buttons per person listed in
//  CONFIG.contacts. Hides the whole section when the host left it
//  empty so the invitation doesn't show a bare "Contacts" header.
// ============================================================================
//
//  Shared by every template: each template's js/contacts.js passes its own
//  CONFIG in. Edit here, not in the template folders.

export function renderContacts(CONFIG) {

  const section = document.getElementById("contacts");
  const list    = document.getElementById("contacts-list");

  const items = Array.isArray(CONFIG.contacts)
    ? CONFIG.contacts.filter((c) => c && typeof c.name === "string" && typeof c.phone === "string" && c.name && c.phone)
    : [];

  if (!section || !list || !items.length) {
    if (section) section.hidden = true;
  } else {
    section.hidden = false;

    const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ "<":"&lt;",">":"&gt;","&":"&amp;",'"':"&quot;" }[c]));
    // Strip everything but digits for the WhatsApp link (wa.me requires
    // E.164 without the plus). Keep + and formatting for tel: so the
    // dialer handles whatever the host typed.
    const digits = (p) => String(p || "").replace(/[^0-9]/g, "");
    const telSafe = (p) => String(p || "").replace(/[^0-9+]/g, "");

    list.innerHTML = items.map((c) => {
      const d = digits(c.phone);
      const t = telSafe(c.phone);
      const roleHtml = c.role ? ` <span class="contact-role">(${esc(c.role)})</span>` : "";
      return `
        <div class="contact">
          <div class="contact-label" dir="auto">${esc(c.name)}${roleHtml}</div>
          <div class="contact-actions">
            <a class="btn-contact btn-whatsapp" href="https://wa.me/${esc(d)}" target="_blank" rel="noopener noreferrer">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M20.5 3.5A11 11 0 0 0 3.3 17.1L2 22l5-1.3a11 11 0 0 0 16.5-9.4c0-2.9-1.1-5.7-3-7.8ZM12 20.3c-1.6 0-3.2-.4-4.6-1.3l-.3-.2-3 .8.8-2.9-.2-.3A9 9 0 1 1 21 11.3a9 9 0 0 1-9 9Zm5-6.5c-.3-.2-1.7-.8-1.9-.9-.3-.1-.5-.2-.7.2s-.8.9-1 1.1c-.2.2-.3.2-.6 0s-1.2-.5-2.3-1.4c-.9-.8-1.4-1.7-1.6-2s0-.5.2-.7l.4-.5c.1-.2.2-.3.3-.5s.1-.4 0-.5c0-.2-.7-1.6-.9-2.2-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4a3.1 3.1 0 0 0-1 2.3c0 1.4 1 2.8 1.2 3 .1.2 2 3 4.7 4.2.7.3 1.2.5 1.6.6a3.8 3.8 0 0 0 1.7.1c.5-.1 1.6-.7 1.9-1.3.2-.6.2-1.2.1-1.3-.1-.2-.3-.2-.6-.4Z"/></svg>
              <span>WhatsApp</span>
            </a>
            <a class="btn-contact btn-call" href="tel:${esc(t)}">
              <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3-8.7A2 2 0 0 1 4 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2L8 9.3a16 16 0 0 0 6 6l1-1a2 2 0 0 1 2.1-.5c.9.3 1.8.5 2.6.6a2 2 0 0 1 1.7 2.1Z"/></svg>
              <span>Call</span>
            </a>
          </div>
        </div>
      `;
    }).join("");
  }
}
