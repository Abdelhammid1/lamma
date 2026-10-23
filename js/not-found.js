// ============================================================================
//  "This invitation isn't available" screen, shared by every template
//  bootstrap. Shown when the URL names a slug but no published data
//  exists for it (typo, not activated yet, expired, deleted). Before
//  this, those links rendered the demo couple — guests couldn't tell
//  the invitation was wrong.
// ============================================================================

export function showNotFound() {
  document.title = "Invitation not available · لمّة";
  document.body.className = "";
  document.body.removeAttribute("style");
  const wrap = document.createElement("main");
  wrap.setAttribute("role", "main");
  wrap.style.cssText =
    "min-height:100vh;display:flex;flex-direction:column;align-items:center;" +
    "justify-content:center;gap:12px;padding:24px 16px;text-align:center;" +
    "background:#faf6f1;color:#3d2230;font-family:Georgia,'Times New Roman',serif;";
  wrap.innerHTML = `
    <p style="font-size:40px;margin:0;" aria-hidden="true">💌</p>
    <h1 style="font-size:24px;font-weight:500;margin:0;">This invitation isn't available</h1>
    <p dir="rtl" lang="ar" style="font-size:20px;margin:0;">الدعوة دي مش متاحة</p>
    <p style="max-width:340px;margin:8px 0 0;font-size:15px;line-height:1.5;color:#6b5560;">
      The link may be mistyped, or the invitation isn't live yet.
      Check the link with whoever sent it to you.
    </p>
    <p dir="rtl" lang="ar" style="max-width:340px;margin:0;font-size:15px;line-height:1.6;color:#6b5560;">
      اتأكد من اللينك مع اللي بعتهولك.
    </p>
    <a href="/" style="margin-top:12px;color:#a13b58;font-size:14px;">lamma.manasety.ai</a>`;
  document.body.replaceChildren(wrap);
}
