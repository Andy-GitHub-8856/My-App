# TEST 訂單管理系統 (Supabase + Python Streamlit)

使用左側選單的多模組 WebUI：

| 模組 | 功能 |
|---|---|
| 🏠 儀表板 | 客戶數、產品數、訂單數、訂單總額、最近訂單、產品銷售排行 |
| 👥 客戶管理 | 客戶資料查詢 / 新增 / 修改 / 刪除 (已有訂單的客戶無法刪除) |
| 📦 產品管理 | 產品查詢 / 新增 / 修改 / 刪除，產品類別與品牌維護 |
| 🧾 訂單管理 | 訂單單頭 + 單身；**彈出視窗挑選客戶與產品**，可直接在表格修改數量、單價或勾選移除 |
| ⚙️ 系統設定 | 連線資訊、各資料表筆數、重新執行資料庫初始化 |

## 資料庫結構 (`db/schema.sql`)

```
customers ─┐
           └─< orders (單頭) ─< order_items (單身) >─ products >─ product_categories
                                                              >─ brands
```

- `products` 正規化：類別 `product_categories`、品牌 `brands` 獨立成表
- `order_items.unit_price` 保存下單當下的成交單價，`amount` 為自動計算欄位
- `v_order_summary` 檢視表：訂單單頭 + 客戶 + 項數 + 總金額
- 訂單編號自動產生：`SO` + 訂單日期 + 3 碼流水號，例如 `SO20261003001`
- 預設建立 7 個類別、5 個品牌、**20 筆虛擬電子產品** (P0001 ~ P0020)
- 所有資料表都啟用 RLS，阻擋 Supabase 公開 REST API (anon key) 存取；本系統以資料庫連線存取不受影響

## 安裝與啟動

### 1. 在 Supabase 建立專案 TEST

1. 登入 <https://supabase.com/dashboard> → **New project**
2. Project name 填 **TEST**，設定資料庫密碼 (請記住)，選擇區域 (建議 Northeast Asia (Tokyo) 或 Southeast Asia (Singapore))
3. 專案建立完成後，按上方 **Connect** → 選 **Session pooler**，複製連線字串
   (格式：`postgresql://postgres.<project-ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`)

### 2. 設定連線

```bash
cp .env.example .env
# 編輯 .env，貼上連線字串並把 [YOUR-PASSWORD] 換成資料庫密碼
```

(也可改寫在 `.streamlit/secrets.toml`：`DATABASE_URL = "postgresql://..."`)

### 3. 安裝套件並啟動

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
streamlit run app.py
```

瀏覽器開啟 <http://localhost:8501>。**第一次啟動會自動建立所有資料表並寫入 20 筆產品**；
也可以手動執行 `python init_db.py`，或把 `db/schema.sql` 貼到 Supabase 的 **SQL Editor** 執行 (可重複執行，不會覆蓋既有資料)。

## 操作說明：建立訂單

1. 左側選單 → **訂單管理** → **🆕 新增訂單**
2. 單頭：選訂單日期、狀態，按 **🔍 選擇客戶…** 開啟視窗，搜尋並勾選客戶後按「確定選擇」
3. 單身：按 **➕ 加入產品…** 開啟視窗，可搜尋、設定數量並一次勾選多個產品加入
4. 在單身表格直接修改「數量」、「單價」，或勾選「移除」刪除該列，合計即時更新
5. 按 **💾 儲存訂單**；之後可在訂單列表勾選訂單檢視明細、編輯或刪除

## 專案結構

```
app.py               主程式：左側選單 (st.navigation) 與模組註冊
db.py                資料庫連線池與共用查詢函式
init_db.py           命令列初始化資料庫
db/schema.sql        資料表、檢視表、RLS 與預設資料
modules/
  dashboard.py       儀表板
  customers.py       客戶管理
  products.py        產品管理 (含類別 / 品牌)
  orders.py          訂單管理 (單頭單身、挑選視窗)
  settings.py        系統設定
  common.py          共用工具
```

新增模組：在 `modules/` 新增一個含 `render()` 的檔案，再到 `app.py` 的 `pages` 加入一行 `st.Page(...)` 即可出現在左側選單。
