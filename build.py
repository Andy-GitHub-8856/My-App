#!/usr/bin/env python3
"""產生單一檔案版 dist/小記帳.html（內含 SQLite / sql.js，可離線使用）。

    python3 build.py
"""

import base64
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OUT = ROOT / "dist" / "小記帳.html"


def script(code):
    # 防止程式碼裡出現 </script> 提早結束標籤
    return "<script>\n" + code.replace("</script", "<\\/script") + "\n</script>"


def main():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "css" / "style.css").read_text(encoding="utf-8")
    app = (ROOT / "js" / "app.js").read_text(encoding="utf-8")
    sqljs = (ROOT / "vendor" / "sql.js" / "sql-wasm.js").read_text(encoding="utf-8")
    wasm = base64.b64encode((ROOT / "vendor" / "sql.js" / "sql-wasm.wasm").read_bytes()).decode("ascii")

    link = '<link rel="stylesheet" href="css/style.css">'
    tag = '<script src="js/app.js"></script>'
    assert link in html and tag in html, "index.html 的 css/js 引用格式改變了"

    html = html.replace(link, "<style>\n" + css + "</style>")
    html = html.replace(tag, "\n".join([
        "<!-- sql.js 1.13.0 (MIT License) https://github.com/sql-js/sql.js -->",
        script(sqljs),
        script(f'window.SQLJS_WASM_BASE64 = "{wasm}";'),
        script(app),
    ]))
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(html, encoding="utf-8")
    print(f"已產生 {OUT.relative_to(ROOT)}（{OUT.stat().st_size / 1024:.0f} KB）")


if __name__ == "__main__":
    main()
