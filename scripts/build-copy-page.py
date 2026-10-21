"""Build a one-page "copy the Apps Script code" helper from dist/Loyalty.gs."""
import html, sys
code = open(sys.argv[1], encoding='utf-8').read()
lines = code.count('\n') + 1
page = f"""<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Code Loyalty Haravan</title>
<style>
:root {{ --bg:#f7f7f5; --fg:#1f1f1f; --muted:#5f5f5f; --card:#ffffff; --border:#dedede; --accent:#1a73e8; --ok:#188038; }}
@media (prefers-color-scheme: dark) {{ :root:not([data-theme="light"]) {{ --bg:#161616; --fg:#ececec; --muted:#a8a8a8; --card:#202020; --border:#353535; --accent:#8ab4f8; --ok:#81c995; }} }}
:root[data-theme="dark"] {{ --bg:#161616; --fg:#ececec; --muted:#a8a8a8; --card:#202020; --border:#353535; --accent:#8ab4f8; --ok:#81c995; }}
* {{ box-sizing:border-box; }}
body {{ margin:0; background:var(--bg); color:var(--fg); font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif; }}
main {{ max-width:900px; margin:0 auto; padding:24px 16px 48px; }}
h1 {{ font-size:1.4rem; margin:0 0 4px; }}
p {{ color:var(--muted); margin:0 0 16px; }}
ol {{ padding-left:20px; margin:0 0 20px; }}
button {{ font:inherit; font-weight:600; background:var(--accent); color:#fff; border:0; border-radius:8px; padding:12px 20px; cursor:pointer; width:100%; }}
#status {{ color:var(--ok); font-weight:600; min-height:1.5em; margin:8px 0 16px; }}
pre {{ background:var(--card); border:1px solid var(--border); border-radius:8px; padding:12px; max-height:50vh; overflow:auto; font-size:12px; line-height:1.4; margin:0; }}
</style></head>
<body><main>
<h1>Code Loyalty Haravan</h1>
<p>{lines} dòng. Bấm nút để chép toàn bộ, rồi dán vào Apps Script.</p>
<ol>
<li>Bấm <b>Sao chép toàn bộ code</b>.</li>
<li>Trong Apps Script, bấm vào khung code của <b>Mã.gs</b>, nhấn <b>Ctrl + A</b> rồi <b>Delete</b> để xoá sạch.</li>
<li>Nhấn <b>Ctrl + V</b> để dán, rồi bấm 💾 Lưu. Dòng cuối cùng phải là <code>}};</code> ở khoảng dòng {lines}.</li>
</ol>
<button id="copy">📋 Sao chép toàn bộ code</button>
<div id="status" role="status"></div>
<pre id="code">{html.escape(code)}</pre>
</main>
<script>
document.getElementById('copy').addEventListener('click', async () => {{
  const text = document.getElementById('code').textContent;
  const s = document.getElementById('status');
  try {{ await navigator.clipboard.writeText(text); s.textContent = '✅ Đã chép ' + text.split('\\n').length + ' dòng. Giờ dán vào Apps Script.'; }}
  catch (e) {{
    const r = document.createRange(); r.selectNodeContents(document.getElementById('code'));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    s.textContent = 'Đã bôi đen toàn bộ code — nhấn Ctrl + C để chép.';
  }}
}});
</script>
</body></html>
"""
open(sys.argv[2], 'w', encoding='utf-8').write(page)
