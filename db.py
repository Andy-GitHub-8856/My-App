"""資料庫連線與共用查詢函式 (Supabase PostgreSQL)。"""
import os
from contextlib import contextmanager
from pathlib import Path

import pandas as pd
import streamlit as st
from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

load_dotenv()

SCHEMA_FILE = Path(__file__).parent / "db" / "schema.sql"


def get_database_url() -> str | None:
    """優先讀取 .streamlit/secrets.toml，其次讀取環境變數 / .env。"""
    try:
        url = st.secrets.get("DATABASE_URL")
    except Exception:  # 沒有 secrets.toml
        url = None
    return url or os.getenv("DATABASE_URL")


@st.cache_resource(show_spinner=False)
def get_pool() -> ConnectionPool:
    url = get_database_url()
    if not url:
        raise RuntimeError("尚未設定 DATABASE_URL，請參考 README 設定 Supabase 連線字串。")
    # prepare_threshold=None：相容 Supabase transaction pooler (port 6543)
    return ConnectionPool(
        url,
        min_size=1,
        max_size=5,
        kwargs={"row_factory": dict_row, "prepare_threshold": None},
        check=ConnectionPool.check_connection,
        open=True,
    )


@contextmanager
def transaction():
    """取得一個交易中的 cursor，區塊結束自動 commit，例外時 rollback。"""
    with get_pool().connection() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                yield cur


def fetch_all(sql: str, params=None) -> list[dict]:
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_one(sql: str, params=None) -> dict | None:
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def fetch_df(sql: str, params=None) -> pd.DataFrame:
    return pd.DataFrame(fetch_all(sql, params))


def execute(sql: str, params=None) -> int:
    with transaction() as cur:
        cur.execute(sql, params)
        return cur.rowcount


def run_schema() -> None:
    """執行 db/schema.sql：建立資料表並寫入預設產品資料 (可重複執行)。"""
    with transaction() as cur:
        cur.execute(SCHEMA_FILE.read_text(encoding="utf-8"))


def ensure_schema() -> None:
    """首次啟動時若資料表不存在則自動建立。"""
    row = fetch_one("select to_regclass('public.order_items') is not null as ok")
    if not row["ok"]:
        run_schema()
