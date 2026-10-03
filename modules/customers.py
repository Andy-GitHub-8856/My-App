"""客戶管理模組。"""
import streamlit as st

from db import execute, fetch_df
from modules.common import db_error_message, flash, next_code, show_flash

FIELDS = [
    ("name", "客戶名稱 *"),
    ("contact", "聯絡人"),
    ("phone", "電話"),
    ("email", "Email"),
    ("address", "地址"),
]


def load_customers(keyword: str = ""):
    kw = f"%{keyword.strip()}%"
    return fetch_df(
        """
        select id, code as "客戶編號", name as "客戶名稱", contact as "聯絡人",
               phone as "電話", email as "Email", address as "地址", note as "備註"
          from customers
         where code ilike %s or name ilike %s
               or coalesce(contact,'') ilike %s or coalesce(phone,'') ilike %s
         order by code
        """,
        (kw, kw, kw, kw),
    )


def _customer_form(key: str, data: dict | None = None):
    data = data or {}
    with st.form(key, clear_on_submit=data == {}):
        c1, c2 = st.columns(2)
        code = c1.text_input("客戶編號 *", value=data.get("code") or next_code("customers", "C"))
        values = {"code": code}
        cols = [c2, c1, c2, c1, c2]
        for (field, label), col in zip(FIELDS, cols):
            values[field] = col.text_input(label, value=data.get(field) or "")
        values["note"] = st.text_area("備註", value=data.get("note") or "", height=80)
        submitted = st.form_submit_button("💾 儲存", type="primary")
    if submitted:
        if not values["code"].strip() or not values["name"].strip():
            st.error("客戶編號與客戶名稱為必填。")
            return None
        return {k: (v.strip() or None) for k, v in values.items()}
    return None


def render():
    st.title("👥 客戶管理")
    show_flash()
    tab_list, tab_new = st.tabs(["客戶列表", "新增客戶"])

    with tab_new:
        values = _customer_form("new_customer")
        if values:
            try:
                execute(
                    """insert into customers (code, name, contact, phone, email, address, note)
                       values (%(code)s, %(name)s, %(contact)s, %(phone)s, %(email)s, %(address)s, %(note)s)""",
                    values,
                )
                flash(f"已新增客戶 {values['code']} {values['name']}")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e))

    with tab_list:
        keyword = st.text_input("🔍 搜尋 (編號 / 名稱 / 聯絡人 / 電話)", key="cust_kw")
        df = load_customers(keyword)
        st.caption(f"共 {len(df)} 筆，點選左側勾選欄可編輯 / 刪除")
        if df.empty:
            st.info("尚無客戶資料，請至「新增客戶」頁籤建立。")
            return
        event = st.dataframe(
            df,
            hide_index=True, placeholder="",
            on_select="rerun",
            selection_mode="single-row",
            column_config={"id": None},
            key="cust_table",
        )
        if not event.selection.rows:
            return
        row = df.iloc[event.selection.rows[0]]
        st.divider()
        st.subheader(f"✏️ 編輯客戶：{row['客戶編號']} {row['客戶名稱']}")
        data = {
            "code": row["客戶編號"], "name": row["客戶名稱"], "contact": row["聯絡人"],
            "phone": row["電話"], "email": row["Email"], "address": row["地址"], "note": row["備註"],
        }
        values = _customer_form(f"edit_customer_{row['id']}", data)
        if values:
            try:
                execute(
                    """update customers set code=%(code)s, name=%(name)s, contact=%(contact)s,
                              phone=%(phone)s, email=%(email)s, address=%(address)s, note=%(note)s,
                              updated_at=now()
                        where id=%(id)s""",
                    {**values, "id": int(row["id"])},
                )
                flash(f"已更新客戶 {values['code']}")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e))
        if st.button("🗑️ 刪除此客戶", key=f"del_cust_{row['id']}"):
            try:
                execute("delete from customers where id=%s", (int(row["id"]),))
                flash(f"已刪除客戶 {row['客戶編號']}")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e))
