"""TEST 訂單管理系統 — Streamlit WebUI 主程式 (左側選單多模組)。

啟動：streamlit run app.py
"""
import streamlit as st

from db import ensure_schema, get_database_url
from modules import customers, dashboard, orders, products, settings

st.set_page_config(page_title="TEST 訂單管理系統", page_icon="📦", layout="wide")

if not get_database_url():
    st.error("尚未設定資料庫連線 DATABASE_URL")
    st.markdown(
        """
請在專案根目錄建立 `.env` (可複製 `.env.example`)，填入 Supabase 連線字串：

```
DATABASE_URL=postgresql://postgres.<project-ref>:<密碼>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

連線字串可在 Supabase 專案 **TEST** → 上方 **Connect** 按鈕 → **Session pooler** 取得。
"""
    )
    st.stop()

if not st.session_state.get("_schema_ok"):
    try:
        with st.spinner("檢查資料庫結構…"):
            ensure_schema()
        st.session_state["_schema_ok"] = True
    except Exception as e:
        st.error(f"無法連線或初始化資料庫：{e}")
        st.stop()

pages = {
    "總覽": [
        st.Page(dashboard.render, title="儀表板", icon="🏠", default=True),
    ],
    "基本資料": [
        st.Page(customers.render, title="客戶管理", icon="👥", url_path="customers"),
        st.Page(products.render, title="產品管理", icon="📦", url_path="products"),
    ],
    "交易作業": [
        st.Page(orders.render, title="訂單管理", icon="🧾", url_path="orders"),
    ],
    "系統": [
        st.Page(settings.render, title="系統設定", icon="⚙️", url_path="settings"),
    ],
}

with st.sidebar:
    st.markdown("## 📦 TEST 訂單管理系統")

st.navigation(pages, position="sidebar", expanded=True).run()
