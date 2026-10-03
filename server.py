#!/usr/bin/env python3
"""小記帳本機伺服器：提供網頁並把資料存在 SQLite。

只用 Python 標準函式庫，不需要安裝任何套件。

    python3 server.py                 # http://localhost:8000 ，資料存在 ./ledger.db
    python3 server.py --port 9000 --db ~/記帳.db

API（皆為 JSON）：
    GET  /api/state             全部紀錄與設定
    PUT  /api/state             整本帳本取代（還原、清除、第一次匯入）
    PUT  /api/months/<YYYY-MM>  取代某個月份的全部紀錄
    PUT  /api/settings          更新預算等設定
    GET  /api/backup            下載資料庫檔案（一致性備份）
"""

import argparse
import json
import os
import re
import sqlite3
import tempfile
import threading
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MONTH_RE = re.compile(r"^\d{4}-\d{2}$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MAX_BODY = 20 * 1024 * 1024

SCHEMA = """
CREATE TABLE IF NOT EXISTS transactions (
    id          TEXT PRIMARY KEY,
    type        TEXT NOT NULL CHECK (type IN ('expense', 'income')),
    amount      REAL NOT NULL CHECK (amount > 0),
    category    TEXT NOT NULL,
    date        TEXT NOT NULL,
    note        TEXT NOT NULL DEFAULT '',
    created_at  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions (date);
CREATE TABLE IF NOT EXISTS settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
);
"""


class BadRequest(Exception):
    pass


class Store:
    def __init__(self, path):
        self.path = path
        self.lock = threading.Lock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    # ---------- 讀取 ----------
    def state(self):
        with self.lock:
            rows = self.conn.execute(
                "SELECT id, type, amount, category, date, note, created_at FROM transactions ORDER BY date, created_at"
            ).fetchall()
            settings = dict(self.conn.execute("SELECT key, value FROM settings").fetchall())
        txs = [
            {
                "id": r["id"], "type": r["type"], "amount": r["amount"], "category": r["category"],
                "date": r["date"], "note": r["note"], "createdAt": r["created_at"],
            }
            for r in rows
        ]
        budget = float(settings.get("budget", 0) or 0)
        return {
            "txs": txs,
            "budget": budget if budget > 0 else None,
            "started": settings.get("started") == "1" or bool(txs),
        }

    # ---------- 寫入 ----------
    def replace_all(self, body):
        txs = [clean_tx(t) for t in require_list(body.get("txs"))]
        with self.lock, self.conn:
            self.conn.execute("DELETE FROM transactions")
            self._insert(txs)
            self._write_settings(body)

    def replace_month(self, month, body):
        txs = [clean_tx(t) for t in require_list(body.get("txs"))]
        if any(t[4][:7] != month for t in txs):
            raise BadRequest("txs must all belong to " + month)
        with self.lock, self.conn:
            self.conn.execute("DELETE FROM transactions WHERE substr(date, 1, 7) = ?", (month,))
            self._insert(txs)

    def update_settings(self, body):
        with self.lock, self.conn:
            self._write_settings(body)

    def backup_to(self, dest):
        with self.lock:
            target = sqlite3.connect(dest)
            try:
                self.conn.backup(target)
            finally:
                target.close()

    def _insert(self, txs):
        # 以 id 為主鍵：同一筆紀錄被移到別的月份時直接覆寫
        self.conn.executemany(
            "INSERT OR REPLACE INTO transactions (id, type, amount, category, date, note, created_at) "
            "VALUES (?, ?, ?, ?, ?, ?, ?)",
            txs,
        )

    def _write_settings(self, body):
        if "budget" in body:
            b = body.get("budget")
            if b is not None and not isinstance(b, (int, float)):
                raise BadRequest("budget must be a number")
            self.conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('budget', ?)",
                (str(b if b and b > 0 else 0),),
            )
        if "started" in body:
            self.conn.execute(
                "INSERT OR REPLACE INTO settings (key, value) VALUES ('started', ?)",
                ("1" if body.get("started") else "0",),
            )


def require_list(v):
    if not isinstance(v, list):
        raise BadRequest("txs must be a list")
    return v


def clean_tx(t):
    if not isinstance(t, dict):
        raise BadRequest("each tx must be an object")
    amount = t.get("amount")
    if t.get("type") not in ("expense", "income"):
        raise BadRequest("invalid type")
    if not isinstance(amount, (int, float)) or isinstance(amount, bool) or not amount > 0:
        raise BadRequest("invalid amount")
    date = t.get("date")
    if not isinstance(date, str) or not DATE_RE.match(date):
        raise BadRequest("invalid date")
    tid = str(t.get("id") or "").strip()
    if not tid:
        raise BadRequest("missing id")
    created = t.get("createdAt") or 0
    return (
        tid[:64], t["type"], float(amount), str(t.get("category") or "other")[:32],
        date, str(t.get("note") or "")[:60], int(created) if isinstance(created, (int, float)) else 0,
    )


class Handler(SimpleHTTPRequestHandler):
    store: Store = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    # 只公開網頁需要的檔案，資料庫與原始碼目錄以外的東西不提供
    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        allowed = clean in ("/", "/index.html") or clean.startswith(("/css/", "/js/"))
        if not allowed:
            return str(ROOT / "__not_found__")
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, fmt, *args):
        if self.path.startswith("/api/"):
            super().log_message(fmt, *args)

    # ---------- API ----------
    def do_GET(self):
        if self.path == "/api/state":
            return self._json(self.store.state())
        if self.path == "/api/backup":
            return self._backup()
        if self.path.startswith("/api/"):
            return self._error(HTTPStatus.NOT_FOUND, "not found")
        return super().do_GET()

    def do_PUT(self):
        try:
            body = self._body()
            if self.path == "/api/state":
                self.store.replace_all(body)
            elif self.path.startswith("/api/months/"):
                month = self.path.rsplit("/", 1)[1]
                if not MONTH_RE.match(month):
                    raise BadRequest("invalid month")
                self.store.replace_month(month, body)
            elif self.path == "/api/settings":
                self.store.update_settings(body)
            else:
                return self._error(HTTPStatus.NOT_FOUND, "not found")
        except BadRequest as e:
            return self._error(HTTPStatus.BAD_REQUEST, str(e))
        return self._json({"ok": True})

    def _body(self):
        # 擋掉跨站請求：只接受同源送來的 JSON
        origin = self.headers.get("Origin")
        if origin and origin.split("://", 1)[-1] != self.headers.get("Host"):
            raise BadRequest("cross-origin request refused")
        if "application/json" not in (self.headers.get("Content-Type") or ""):
            raise BadRequest("expected application/json")
        length = int(self.headers.get("Content-Length") or 0)
        if length <= 0 or length > MAX_BODY:
            raise BadRequest("invalid body size")
        try:
            body = json.loads(self.rfile.read(length))
        except ValueError:
            raise BadRequest("invalid JSON")
        if not isinstance(body, dict):
            raise BadRequest("body must be an object")
        return body

    def _backup(self):
        fd, tmp = tempfile.mkstemp(suffix=".db")
        os.close(fd)
        try:
            self.store.backup_to(tmp)
            data = Path(tmp).read_bytes()
        finally:
            os.unlink(tmp)
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/vnd.sqlite3")
        self.send_header("Content-Disposition", "attachment; filename=\"ledger-backup.db\"")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _json(self, obj, status=HTTPStatus.OK):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _error(self, status, message):
        self._json({"error": message}, status)


def main():
    ap = argparse.ArgumentParser(description="小記帳本機伺服器（SQLite）")
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1", help="預設只允許本機連線")
    ap.add_argument("--db", default=str(ROOT / "ledger.db"), help="SQLite 資料庫檔案路徑")
    args = ap.parse_args()

    db_path = Path(args.db).expanduser().resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    Handler.store = Store(str(db_path))

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"小記帳已啟動：http://localhost:{args.port}")
    print(f"資料庫檔案：{db_path}")
    print("按 Ctrl+C 停止")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止")


if __name__ == "__main__":
    main()
