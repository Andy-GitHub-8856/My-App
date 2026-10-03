"""產品管理模組 (含類別、品牌維護)。"""
import streamlit as st

from db import execute, fetch_all, fetch_df
from modules.common import db_error_message, flash, next_code, show_flash


def load_products(keyword: str = "", category_id: int | None = None, active_only: bool = False):
    kw = f"%{keyword.strip()}%"
    return fetch_df(
        """
        select p.id, p.code as "產品編號", p.name as "品名", c.name as "類別", b.name as "品牌",
               p.spec as "規格", p.unit as "單位", p.unit_price as "單價", p.stock_qty as "庫存",
               p.is_active as "啟用", p.category_id, p.brand_id
          from products p
          join product_categories c on c.id = p.category_id
          join brands b on b.id = p.brand_id
         where (p.code ilike %s or p.name ilike %s or coalesce(p.spec,'') ilike %s or b.name ilike %s)
           and (%s::bigint is null or p.category_id = %s::bigint)
           and (not %s or p.is_active)
         order by p.code
        """,
        (kw, kw, kw, kw, category_id, category_id, active_only),
    )


def _options(table: str) -> dict[int, str]:
    return {r["id"]: r["name"] for r in fetch_all(f"select id, name from {table} order by name")}


def _product_form(key: str, data: dict | None = None):
    data = data or {}
    cats, brands = _options("product_categories"), _options("brands")
    if not cats or not brands:
        st.warning("請先至「類別 / 品牌維護」建立類別與品牌。")
        return None
    cat_ids, brand_ids = list(cats), list(brands)
    with st.form(key, clear_on_submit=data == {}):
        c1, c2, c3 = st.columns(3)
        code = c1.text_input("產品編號 *", value=data.get("code") or next_code("products", "P"))
        name = c2.text_input("品名 *", value=data.get("name") or "")
        spec = c3.text_input("規格", value=data.get("spec") or "")
        category_id = c1.selectbox(
            "類別 *", cat_ids, format_func=cats.get,
            index=cat_ids.index(data["category_id"]) if data.get("category_id") in cat_ids else 0,
        )
        brand_id = c2.selectbox(
            "品牌 *", brand_ids, format_func=brands.get,
            index=brand_ids.index(data["brand_id"]) if data.get("brand_id") in brand_ids else 0,
        )
        unit = c3.text_input("單位", value=data.get("unit") or "台")
        unit_price = c1.number_input("單價 *", min_value=0.0, step=100.0, value=float(data.get("unit_price") or 0))
        stock_qty = c2.number_input("庫存", min_value=0, step=1, value=int(data.get("stock_qty") or 0))
        is_active = c3.checkbox("啟用 (可被訂單選取)", value=data.get("is_active", True))
        submitted = st.form_submit_button("💾 儲存", type="primary")
    if submitted:
        if not code.strip() or not name.strip():
            st.error("產品編號與品名為必填。")
            return None
        return {
            "code": code.strip(), "name": name.strip(), "spec": spec.strip() or None,
            "category_id": int(category_id), "brand_id": int(brand_id), "unit": unit.strip() or "台",
            "unit_price": unit_price, "stock_qty": int(stock_qty), "is_active": is_active,
        }
    return None


def _lookup_editor(table: str, label: str):
    """類別 / 品牌 這類簡單代碼表的維護。"""
    st.markdown(f"**{label}**")
    with st.form(f"add_{table}", clear_on_submit=True):
        c1, c2 = st.columns([3, 1], vertical_alignment="bottom")
        name = c1.text_input(f"新增{label}名稱")
        if c2.form_submit_button("➕ 新增") and name.strip():
            try:
                execute(f"insert into {table} (name) values (%s)", (name.strip(),))
                flash(f"已新增{label}：{name.strip()}")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e))
    df = fetch_df(
        f"""select t.id, t.name as "名稱",
                   (select count(*) from products p where p.{'category_id' if table == 'product_categories' else 'brand_id'} = t.id) as "產品數"
              from {table} t order by t.name"""
    )
    event = st.dataframe(
        df, hide_index=True, placeholder="", on_select="rerun", selection_mode="single-row",
        column_config={"id": None}, key=f"tbl_{table}",
    )
    if event.selection.rows:
        row = df.iloc[event.selection.rows[0]]
        c1, c2, c3 = st.columns([3, 1, 1], vertical_alignment="bottom")
        new_name = c1.text_input("名稱", value=row["名稱"], key=f"rename_{table}_{row['id']}")
        if c2.button("更名", key=f"btn_rename_{table}"):
            try:
                execute(f"update {table} set name=%s where id=%s", (new_name.strip(), int(row["id"])))
                flash("已更新名稱")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e))
        if c3.button("刪除", key=f"btn_del_{table}"):
            try:
                execute(f"delete from {table} where id=%s", (int(row["id"]),))
                flash(f"已刪除{label}：{row['名稱']}")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e))


def render():
    st.title("📦 產品管理")
    show_flash()
    tab_list, tab_new, tab_lookup = st.tabs(["產品列表", "新增產品", "類別 / 品牌維護"])

    with tab_new:
        values = _product_form("new_product")
        if values:
            try:
                execute(
                    """insert into products (code, name, spec, category_id, brand_id, unit, unit_price, stock_qty, is_active)
                       values (%(code)s, %(name)s, %(spec)s, %(category_id)s, %(brand_id)s, %(unit)s,
                               %(unit_price)s, %(stock_qty)s, %(is_active)s)""",
                    values,
                )
                flash(f"已新增產品 {values['code']} {values['name']}")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e))

    with tab_lookup:
        c1, c2 = st.columns(2)
        with c1:
            _lookup_editor("product_categories", "產品類別")
        with c2:
            _lookup_editor("brands", "品牌")

    with tab_list:
        cats = _options("product_categories")
        c1, c2 = st.columns([3, 1])
        keyword = c1.text_input("🔍 搜尋 (編號 / 品名 / 規格 / 品牌)", key="prod_kw")
        category_id = c2.selectbox("類別", [None, *cats], format_func=lambda i: "全部" if i is None else cats[i])
        df = load_products(keyword, category_id)
        st.caption(f"共 {len(df)} 筆，點選左側勾選欄可編輯 / 刪除")
        event = st.dataframe(
            df,
            hide_index=True, placeholder="",
            on_select="rerun",
            selection_mode="single-row",
            column_config={
                "id": None, "category_id": None, "brand_id": None,
                "單價": st.column_config.NumberColumn(format="%,.0f"),
            },
            key="prod_table",
        )
        if df.empty or not event.selection.rows:
            return
        row = df.iloc[event.selection.rows[0]]
        st.divider()
        st.subheader(f"✏️ 編輯產品：{row['產品編號']} {row['品名']}")
        data = {
            "code": row["產品編號"], "name": row["品名"], "spec": row["規格"], "unit": row["單位"],
            "category_id": int(row["category_id"]), "brand_id": int(row["brand_id"]),
            "unit_price": row["單價"], "stock_qty": row["庫存"], "is_active": bool(row["啟用"]),
        }
        values = _product_form(f"edit_product_{row['id']}", data)
        if values:
            try:
                execute(
                    """update products set code=%(code)s, name=%(name)s, spec=%(spec)s,
                              category_id=%(category_id)s, brand_id=%(brand_id)s, unit=%(unit)s,
                              unit_price=%(unit_price)s, stock_qty=%(stock_qty)s, is_active=%(is_active)s,
                              updated_at=now()
                        where id=%(id)s""",
                    {**values, "id": int(row["id"])},
                )
                flash(f"已更新產品 {values['code']}")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e))
        if st.button("🗑️ 刪除此產品", key=f"del_prod_{row['id']}"):
            try:
                execute("delete from products where id=%s", (int(row["id"]),))
                flash(f"已刪除產品 {row['產品編號']}")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e) + " (可改為取消「啟用」)")
