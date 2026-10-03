"""各模組共用工具。"""
import streamlit as st

from db import fetch_one


def next_code(table: str, prefix: str, width: int = 4) -> str:
    """依現有最大編號產生下一個編號，如 C0001、P0021。"""
    row = fetch_one(
        f"select max(code) as m from {table} where code ~ %s",
        (f"^{prefix}[0-9]{{{width}}}$",),
    )
    n = int(row["m"][len(prefix):]) + 1 if row and row["m"] else 1
    return f"{prefix}{n:0{width}d}"


def flash(msg: str, kind: str = "success") -> None:
    """設定一則訊息，於下一次畫面重繪時顯示 (搭配 st.rerun 使用)。"""
    st.session_state["_flash"] = (kind, msg)


def show_flash() -> None:
    item = st.session_state.pop("_flash", None)
    if item:
        kind, msg = item
        getattr(st, kind)(msg)


def money(v) -> str:
    return f"NT$ {float(v or 0):,.0f}"


def db_error_message(e: Exception) -> str:
    text = str(e)
    if "foreign key" in text or "violates foreign key" in text:
        return "此資料已被其他資料引用 (例如已有訂單)，無法刪除。"
    if "duplicate key" in text:
        return "編號或名稱重複，請改用其他值。"
    return f"資料庫錯誤：{text}"
