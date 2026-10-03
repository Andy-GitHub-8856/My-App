"""首頁儀表板。"""
import streamlit as st

from db import fetch_df, fetch_one
from modules.common import money


def render():
    st.title("🏠 儀表板")
    s = fetch_one(
        """select (select count(*) from customers) as customers,
                  (select count(*) from products where is_active) as products,
                  (select count(*) from orders where status <> '已取消') as orders,
                  (select coalesce(sum(total_amount), 0) from v_order_summary where status <> '已取消') as sales"""
    )
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("客戶數", s["customers"], border=True)
    c2.metric("啟用產品數", s["products"], border=True)
    c3.metric("有效訂單數", s["orders"], border=True)
    c4.metric("訂單總額", money(s["sales"]), border=True)

    left, right = st.columns(2)
    with left:
        st.subheader("最近訂單")
        st.dataframe(
            fetch_df(
                """select order_no as "訂單編號", order_date as "日期", customer_name as "客戶",
                          status as "狀態", total_amount as "總金額"
                     from v_order_summary order by created_at desc limit 10"""
            ),
            hide_index=True, placeholder="",
            column_config={"總金額": st.column_config.NumberColumn(format="%,.0f")},
        )
    with right:
        st.subheader("產品銷售排行")
        st.dataframe(
            fetch_df(
                """select p.code as "產品編號", p.name as "品名",
                          sum(i.quantity) as "銷售數量", sum(i.amount) as "銷售金額"
                     from order_items i
                     join orders o on o.id = i.order_id and o.status <> '已取消'
                     join products p on p.id = i.product_id
                    group by p.id order by 4 desc limit 10"""
            ),
            hide_index=True, placeholder="",
            column_config={"銷售金額": st.column_config.NumberColumn(format="%,.0f")},
        )
    st.caption("請使用左側選單切換「客戶管理」、「產品管理」、「訂單管理」等模組。")
