"""訂單管理模組：訂單單頭 / 單身，客戶與產品以彈出視窗挑選。"""
from datetime import date

import pandas as pd
import streamlit as st

from db import execute, fetch_all, fetch_df, fetch_one, transaction
from modules.common import db_error_message, flash, money, show_flash
from modules.customers import load_customers
from modules.products import load_products

STATUSES = ["草稿", "已確認", "已出貨", "已取消"]
FORM = "order_form"


# ---------------------------------------------------------------------------
# 編輯中訂單的暫存 (session_state)
# ---------------------------------------------------------------------------
def _uid() -> int:
    """每次開啟編輯畫面給一個新代號，讓單頭欄位的 widget key 不與上一張訂單共用。"""
    st.session_state["_order_uid"] = st.session_state.get("_order_uid", 0) + 1
    return st.session_state["_order_uid"]


def _new_form() -> dict:
    return {"id": None, "order_no": None, "order_date": date.today(), "status": "草稿",
            "note": "", "customer": None, "items": [], "ver": 0, "uid": _uid()}


def _load_form(order_id: int) -> dict:
    h = fetch_one(
        """select o.*, c.code as customer_code, c.name as customer_name
             from orders o join customers c on c.id = o.customer_id where o.id=%s""",
        (order_id,),
    )
    items = fetch_all(
        """select i.product_id, p.code, p.name, p.unit, i.quantity, i.unit_price
             from order_items i join products p on p.id = i.product_id
            where i.order_id=%s order by i.line_no""",
        (order_id,),
    )
    return {
        "id": h["id"], "order_no": h["order_no"], "order_date": h["order_date"], "status": h["status"],
        "note": h["note"] or "", "ver": 0, "uid": _uid(),
        "customer": {"id": h["customer_id"], "code": h["customer_code"], "name": h["customer_name"]},
        "items": [{**it, "quantity": int(it["quantity"]), "unit_price": float(it["unit_price"])} for it in items],
    }


# ---------------------------------------------------------------------------
# 彈出視窗：挑選客戶 / 挑選產品
# ---------------------------------------------------------------------------
@st.dialog("選擇客戶", width="large")
def customer_picker():
    kw = st.text_input("🔍 搜尋客戶 (編號 / 名稱 / 聯絡人 / 電話)", key="pick_cust_kw")
    df = load_customers(kw)
    if df.empty:
        st.info("查無客戶，請先至「客戶管理」新增。")
        return
    event = st.dataframe(
        df[["id", "客戶編號", "客戶名稱", "聯絡人", "電話", "地址"]],
        hide_index=True, placeholder="", on_select="rerun", selection_mode="single-row",
        column_config={"id": None}, height=380, key="pick_cust_table",
    )
    rows = event.selection.rows
    if st.button("✅ 確定選擇", type="primary", disabled=not rows):
        r = df.iloc[rows[0]]
        st.session_state[FORM]["customer"] = {"id": int(r["id"]), "code": r["客戶編號"], "name": r["客戶名稱"]}
        st.rerun()


@st.dialog("選擇產品", width="large")
def product_picker():
    c1, c2 = st.columns([3, 1], vertical_alignment="bottom")
    kw = c1.text_input("🔍 搜尋產品 (編號 / 品名 / 規格 / 品牌)", key="pick_prod_kw")
    qty = c2.number_input("數量", min_value=1, value=1, step=1, key="pick_prod_qty")
    df = load_products(kw, active_only=True)
    if df.empty:
        st.info("查無可用產品。")
        return
    event = st.dataframe(
        df[["id", "產品編號", "品名", "類別", "品牌", "規格", "單位", "單價", "庫存"]],
        hide_index=True, placeholder="", on_select="rerun", selection_mode="multi-row",
        column_config={"id": None, "單價": st.column_config.NumberColumn(format="%,.0f")},
        height=380, key="pick_prod_table",
    )
    rows = event.selection.rows
    if st.button(f"➕ 加入選取的產品 ({len(rows)})", type="primary", disabled=not rows):
        items = st.session_state[FORM]["items"]
        for i in rows:
            r = df.iloc[i]
            existing = next((it for it in items if it["product_id"] == int(r["id"])), None)
            if existing:  # 同產品已存在則累加數量
                existing["quantity"] += int(qty)
            else:
                items.append({
                    "product_id": int(r["id"]), "code": r["產品編號"], "name": r["品名"],
                    "unit": r["單位"], "quantity": int(qty), "unit_price": float(r["單價"]),
                })
        st.session_state[FORM]["ver"] += 1
        st.rerun()


# ---------------------------------------------------------------------------
# 單身編輯
# ---------------------------------------------------------------------------
def _editor_key(form: dict) -> str:
    return f"items_editor_{form['ver']}"


def _apply_item_edits():
    """data_editor 變動時，把修改寫回暫存單身並重建編輯器 (金額即時更新)。"""
    form = st.session_state[FORM]
    changes = st.session_state[_editor_key(form)]["edited_rows"]
    removed = set()
    for idx, ch in changes.items():
        item = form["items"][int(idx)]
        if ch.get("移除"):
            removed.add(int(idx))
            continue
        if ch.get("數量") is not None:
            item["quantity"] = max(1, int(ch["數量"]))
        if ch.get("單價") is not None:
            item["unit_price"] = max(0.0, float(ch["單價"]))
    form["items"] = [it for i, it in enumerate(form["items"]) if i not in removed]
    form["ver"] += 1


def _items_df(items: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(
        [{"項次": n, "產品編號": it["code"], "品名": it["name"], "單位": it["unit"],
          "數量": it["quantity"], "單價": it["unit_price"], "金額": it["quantity"] * it["unit_price"],
          "移除": False} for n, it in enumerate(items, start=1)],
        columns=["項次", "產品編號", "品名", "單位", "數量", "單價", "金額", "移除"],
    )


# ---------------------------------------------------------------------------
# 儲存
# ---------------------------------------------------------------------------
def _save(form: dict) -> str:
    with transaction() as cur:
        params = {"customer_id": form["customer"]["id"], "order_date": form["order_date"],
                  "status": form["status"], "note": form["note"].strip() or None}
        if form["id"] is None:
            # 以交易鎖避免同時建立訂單時產生重複單號
            cur.execute("select pg_advisory_xact_lock(hashtext('orders.order_no'))")
            prefix = f"SO{form['order_date']:%Y%m%d}"
            cur.execute("select max(order_no) as m from orders where order_no like %s", (prefix + "%",))
            last = cur.fetchone()["m"]
            order_no = f"{prefix}{(int(last[-3:]) + 1) if last else 1:03d}"
            cur.execute(
                """insert into orders (order_no, customer_id, order_date, status, note)
                   values (%(order_no)s, %(customer_id)s, %(order_date)s, %(status)s, %(note)s) returning id""",
                {**params, "order_no": order_no},
            )
            order_id = cur.fetchone()["id"]
        else:
            order_id, order_no = form["id"], form["order_no"]
            cur.execute(
                """update orders set customer_id=%(customer_id)s, order_date=%(order_date)s, status=%(status)s,
                          note=%(note)s, updated_at=now() where id=%(id)s""",
                {**params, "id": order_id},
            )
            cur.execute("delete from order_items where order_id=%s", (order_id,))
        cur.executemany(
            """insert into order_items (order_id, line_no, product_id, quantity, unit_price)
               values (%s, %s, %s, %s, %s)""",
            [(order_id, n, it["product_id"], it["quantity"], it["unit_price"])
             for n, it in enumerate(form["items"], start=1)],
        )
    return order_no


# ---------------------------------------------------------------------------
# 畫面：訂單編輯
# ---------------------------------------------------------------------------
def render_editor():
    form = st.session_state[FORM]
    uid = form["uid"]
    st.subheader("🆕 新增訂單" if form["id"] is None else f"✏️ 編輯訂單 {form['order_no']}")

    with st.container(border=True):
        st.markdown("**單頭**")
        c1, c2, c3 = st.columns(3)
        c1.text_input("訂單編號", value=form["order_no"] or "(儲存後自動產生)", disabled=True)
        form["order_date"] = c2.date_input("訂單日期", value=form["order_date"], format="YYYY-MM-DD",
                                           key=f"of_date_{uid}")
        form["status"] = c3.selectbox("狀態", STATUSES, index=STATUSES.index(form["status"]),
                                      key=f"of_status_{uid}")

        c1, c2 = st.columns([3, 1], vertical_alignment="bottom")
        cust = form["customer"]
        c1.text_input("客戶 *", value=f"{cust['code']}  {cust['name']}" if cust else "", disabled=True,
                      placeholder="請按右側按鈕選擇客戶", key=f"of_cust_{uid}_{cust['id'] if cust else 0}")
        if c2.button("🔍 選擇客戶…", width="stretch"):
            customer_picker()
        form["note"] = st.text_area("備註", value=form["note"], height=68, key=f"of_note_{uid}")

    with st.container(border=True):
        c1, c2 = st.columns([3, 1], vertical_alignment="center")
        c1.markdown("**單身**")
        if c2.button("➕ 加入產品…", width="stretch"):
            product_picker()
        if form["items"]:
            st.data_editor(
                _items_df(form["items"]),
                key=_editor_key(form),
                on_change=_apply_item_edits,
                hide_index=True, placeholder="",
                disabled=["項次", "產品編號", "品名", "單位", "金額"],
                column_config={
                    "數量": st.column_config.NumberColumn(min_value=1, step=1, required=True),
                    "單價": st.column_config.NumberColumn(min_value=0, step=1, format="%,.0f", required=True),
                    "金額": st.column_config.NumberColumn(format="%,.0f"),
                    "移除": st.column_config.CheckboxColumn(help="勾選即移除此列"),
                },
            )
        else:
            st.info("尚未加入任何產品，請按「➕ 加入產品…」挑選。")
        total = sum(it["quantity"] * it["unit_price"] for it in form["items"])
        st.markdown(f"#### 合計：{money(total)}　({len(form['items'])} 項)")

    c1, c2, _ = st.columns([1, 1, 4])
    if c1.button("💾 儲存訂單", type="primary", width="stretch"):
        if not form["customer"]:
            st.error("請選擇客戶。")
        elif not form["items"]:
            st.error("訂單至少需要一筆單身。")
        else:
            try:
                order_no = _save(form)
                del st.session_state[FORM]
                flash(f"訂單 {order_no} 已儲存")
                st.rerun()
            except Exception as e:
                st.error(db_error_message(e))
    if c2.button("取消", width="stretch"):
        del st.session_state[FORM]
        st.rerun()


# ---------------------------------------------------------------------------
# 畫面：訂單列表 / 明細
# ---------------------------------------------------------------------------
def render_list():
    c1, c2, c3 = st.columns([3, 2, 1], vertical_alignment="bottom")
    kw = c1.text_input("🔍 搜尋 (訂單編號 / 客戶)", key="order_kw")
    statuses = c2.multiselect("狀態", STATUSES, key="order_status", placeholder="全部")
    if c3.button("🆕 新增訂單", type="primary", width="stretch"):
        st.session_state[FORM] = _new_form()
        st.rerun()

    like = f"%{kw.strip()}%"
    df = fetch_df(
        """select id, order_no as "訂單編號", order_date as "訂單日期", status as "狀態",
                  customer_code as "客戶編號", customer_name as "客戶名稱",
                  item_count as "項數", total_amount as "總金額", note as "備註"
             from v_order_summary
            where (order_no ilike %s or customer_code ilike %s or customer_name ilike %s)
              and (cardinality(%s::text[]) = 0 or status = any(%s::text[]))
            order by order_date desc, order_no desc""",
        (like, like, like, statuses, statuses),
    )
    st.caption(f"共 {len(df)} 筆，點選左側勾選欄可檢視明細 / 編輯 / 刪除")
    if df.empty:
        st.info("目前沒有訂單。")
        return
    event = st.dataframe(
        df, hide_index=True, placeholder="", on_select="rerun", selection_mode="single-row", key="order_table",
        column_config={"id": None, "總金額": st.column_config.NumberColumn(format="%,.0f")},
    )
    if not event.selection.rows:
        return

    row = df.iloc[event.selection.rows[0]]
    order_id = int(row["id"])
    st.divider()
    st.subheader(f"📄 訂單明細：{row['訂單編號']}")
    c1, c2, c3, c4 = st.columns(4)
    c1.metric("客戶", f"{row['客戶名稱']}")
    c2.metric("訂單日期", f"{row['訂單日期']}")
    c3.metric("狀態", row["狀態"])
    c4.metric("總金額", money(row["總金額"]))
    items = fetch_df(
        """select i.line_no as "項次", p.code as "產品編號", p.name as "品名", c.name as "類別",
                  p.unit as "單位", i.quantity as "數量", i.unit_price as "單價", i.amount as "金額"
             from order_items i
             join products p on p.id = i.product_id
             join product_categories c on c.id = p.category_id
            where i.order_id=%s order by i.line_no""",
        (order_id,),
    )
    st.dataframe(items, hide_index=True, placeholder="", column_config={
        "單價": st.column_config.NumberColumn(format="%,.0f"),
        "金額": st.column_config.NumberColumn(format="%,.0f"),
    })
    c1, c2, _ = st.columns([1, 1, 4])
    if c1.button("✏️ 編輯訂單", width="stretch"):
        st.session_state[FORM] = _load_form(order_id)
        st.rerun()
    if c2.button("🗑️ 刪除訂單", width="stretch"):
        st.session_state["confirm_delete_order"] = order_id
    if st.session_state.get("confirm_delete_order") == order_id:
        st.warning(f"確定要刪除訂單 {row['訂單編號']} (含單身) 嗎？")
        d1, d2, _ = st.columns([1, 1, 4])
        if d1.button("確定刪除", type="primary"):
            try:
                execute("delete from orders where id=%s", (order_id,))
                flash(f"已刪除訂單 {row['訂單編號']}")
            except Exception as e:
                flash(db_error_message(e), "error")
            st.session_state.pop("confirm_delete_order", None)
            st.rerun()
        if d2.button("取消刪除"):
            st.session_state.pop("confirm_delete_order", None)
            st.rerun()


def render():
    st.title("🧾 訂單管理")
    show_flash()
    if FORM in st.session_state:
        render_editor()
    else:
        render_list()
