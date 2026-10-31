// ============================================================================
//  "This invitation isn't available" screen, shared by every template
//  bootstrap. Shown when the URL names a slug but no published data
//  exists for it (typo, not activated yet, expired, deleted). Before
//  this, those links rendered the demo couple — guests couldn't tell
//  the invitation was wrong.
// ============================================================================

export function showNotFound() {
  document.title = "الدعوة مش متاحة · لمّة";
  document.documentElement.lang = "ar";
  document.documentElement.dir = "rtl";
  document.body.className = "";
  document.body.removeAttribute("style");
  document.body.style.margin = "0";
  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href = "https://fonts.googleapis.com/css2?family=Aref+Ruqaa:wght@700&family=IBM+Plex+Sans+Arabic:wght@400;600&display=swap";
  document.head.appendChild(fonts);
  const wrap = document.createElement("main");
  wrap.setAttribute("role", "main");
  wrap.style.cssText =
    "min-height:100vh;min-height:100dvh;box-sizing:border-box;padding:24px;display:flex;" +
    "flex-direction:column;justify-content:center;background:#f3e9dc;color:#2c1a12;" +
    "font-family:'IBM Plex Sans Arabic',Tahoma,sans-serif;font-size:18px;line-height:1.65;text-align:right;";
  wrap.innerHTML = `
    <div style="width:100%;max-width:420px;margin:0 auto;">
      <img src="/logo.jpg" alt="لمّة" width="64" height="64" style="display:block;border-radius:50%;object-fit:cover;">
      <h1 style="margin:18px 0 0;font-family:'Aref Ruqaa','Times New Roman',serif;font-weight:700;font-size:52px;line-height:1.25;color:#4a2c19;">الدعوة دي<br>مش متاحة</h1>
      <p style="margin:10px 0 0;color:#5c4537;">ممكن اللينك يكون مكتوب غلط، أو الدعوة لسه ما اتنشرتش. اتأكد من اللينك مع اللي بعتهولك.</p>
      <p lang="en" dir="ltr" style="margin:14px 0 0;font-size:15px;color:#5c4537;text-align:right;">This invitation isn't available. Check the link with whoever sent it to you.</p>
      <a href="/" style="display:inline-flex;align-items:center;min-height:44px;margin-top:14px;color:#7c4f2e;font-weight:600;">اعمل دعوتك مع لمّة</a>
    </div>`;
  document.body.replaceChildren(wrap);
}
