"""系統設定：連線資訊與資料庫初始化。"""
from urllib.parse import urlparse

import streamlit as st

from db import fetch_all, get_database_url, run_schema
from modules.common import flash, show_flash


def render():
    st.title("⚙️ 系統設定")
    show_flash()

    url = urlparse(get_database_url())
    st.subheader("資料庫連線")
    st.write(f"主機：`{url.hostname}`　連接埠：`{url.port}`　資料庫：`{url.path.lstrip('/')}`　使用者：`{url.username}`")

    st.subheader("資料表筆數")
    rows = fetch_all(
        """select '客戶 customers' as "資料表", count(*) as "筆數" from customers
           union all select '產品類別 product_categories', count(*) from product_categories
           union all select '品牌 brands', count(*) from brands
           union all select '產品 products', count(*) from products
           union all select '訂單單頭 orders', count(*) from orders
           union all select '訂單單身 order_items', count(*) from order_items"""
    )
    st.dataframe(rows, hide_index=True, placeholder="")

    st.subheader("初始化資料庫")
    st.write("重新執行 `db/schema.sql`：補建缺少的資料表，並補回預設的類別、品牌與 20 筆電子產品 (不會覆蓋或刪除既有資料)。")
    if st.button("🛠️ 執行初始化"):
        run_schema()
        flash("資料庫初始化完成")
        st.rerun()
