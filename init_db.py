"""命令列初始化資料庫：python init_db.py"""
import sys

import psycopg
from dotenv import load_dotenv

from db import SCHEMA_FILE, get_database_url

load_dotenv()

if __name__ == "__main__":
    url = get_database_url()
    if not url:
        sys.exit("請先在 .env 或 .streamlit/secrets.toml 設定 DATABASE_URL")
    with psycopg.connect(url, prepare_threshold=None) as conn:
        conn.execute(SCHEMA_FILE.read_text(encoding="utf-8"))
        n = conn.execute("select count(*) from products").fetchone()[0]
    print(f"資料庫初始化完成，目前產品筆數：{n}")
