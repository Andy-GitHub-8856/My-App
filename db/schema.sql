-- =====================================================================
--  TEST 專案資料庫結構 (Supabase / PostgreSQL)
--  可重複執行 (idempotent)：可直接貼到 Supabase「SQL Editor」執行，
--  或由 `python init_db.py` / WebUI「系統設定」自動執行。
-- =====================================================================

-- ---------------------------------------------------------------------
-- 客戶主檔
-- ---------------------------------------------------------------------
create table if not exists customers (
    id          bigint generated always as identity primary key,
    code        varchar(20)  not null unique,          -- 客戶編號
    name        varchar(100) not null,                 -- 客戶名稱
    contact     varchar(50),                           -- 聯絡人
    phone       varchar(30),
    email       varchar(100),
    address     varchar(200),
    note        text,
    created_at  timestamptz  not null default now(),
    updated_at  timestamptz  not null default now()
);

-- ---------------------------------------------------------------------
-- 產品主檔 (正規化：類別、品牌獨立成表)
-- ---------------------------------------------------------------------
create table if not exists product_categories (
    id    bigint generated always as identity primary key,
    name  varchar(50) not null unique
);

create table if not exists brands (
    id    bigint generated always as identity primary key,
    name  varchar(50) not null unique
);

create table if not exists products (
    id           bigint generated always as identity primary key,
    code         varchar(20)   not null unique,        -- 產品編號
    name         varchar(100)  not null,               -- 品名
    category_id  bigint        not null references product_categories(id),
    brand_id     bigint        not null references brands(id),
    spec         varchar(200),                         -- 規格
    unit         varchar(10)   not null default '台',
    unit_price   numeric(12,2) not null check (unit_price >= 0),
    stock_qty    integer       not null default 0 check (stock_qty >= 0),
    is_active    boolean       not null default true,
    created_at   timestamptz   not null default now(),
    updated_at   timestamptz   not null default now()
);
create index if not exists idx_products_category on products(category_id);
create index if not exists idx_products_brand    on products(brand_id);

-- ---------------------------------------------------------------------
-- 訂單 單頭
-- ---------------------------------------------------------------------
create table if not exists orders (
    id           bigint generated always as identity primary key,
    order_no     varchar(20)  not null unique,         -- 訂單編號 SOyyyymmdd###
    customer_id  bigint       not null references customers(id),
    order_date   date         not null default current_date,
    status       varchar(10)  not null default '草稿'
                 check (status in ('草稿', '已確認', '已出貨', '已取消')),
    note         text,
    created_at   timestamptz  not null default now(),
    updated_at   timestamptz  not null default now()
);
create index if not exists idx_orders_customer on orders(customer_id);

-- ---------------------------------------------------------------------
-- 訂單 單身
-- ---------------------------------------------------------------------
create table if not exists order_items (
    id          bigint generated always as identity primary key,
    order_id    bigint        not null references orders(id) on delete cascade,
    line_no     integer       not null,
    product_id  bigint        not null references products(id),
    quantity    integer       not null check (quantity > 0),
    unit_price  numeric(12,2) not null check (unit_price >= 0),  -- 成交單價 (下單當下快照)
    amount      numeric(14,2) generated always as (quantity * unit_price) stored,
    unique (order_id, line_no)
);
create index if not exists idx_order_items_product on order_items(product_id);

-- ---------------------------------------------------------------------
-- 檢視表：訂單彙總 (單頭 + 客戶 + 合計)
-- ---------------------------------------------------------------------
-- security_invoker：以查詢者權限執行，避免繞過 RLS 經由 REST API 外洩
create or replace view v_order_summary with (security_invoker = true) as
select o.id,
       o.order_no,
       o.order_date,
       o.status,
       o.customer_id,
       c.code  as customer_code,
       c.name  as customer_name,
       coalesce(count(i.id), 0)      as item_count,
       coalesce(sum(i.amount), 0)    as total_amount,
       o.note,
       o.created_at
  from orders o
  join customers c on c.id = o.customer_id
  left join order_items i on i.order_id = o.id
 group by o.id, c.id;

-- ---------------------------------------------------------------------
-- 啟用 RLS：阻擋 Supabase 公開 REST API (anon key) 直接存取，
-- 本系統透過資料庫連線 (postgres 角色) 存取，不受影響。
-- ---------------------------------------------------------------------
alter table customers          enable row level security;
alter table product_categories enable row level security;
alter table brands             enable row level security;
alter table products           enable row level security;
alter table orders             enable row level security;
alter table order_items        enable row level security;

-- =====================================================================
--  預設資料：產品類別、品牌、20 筆虛擬電子產品
-- =====================================================================
insert into product_categories (name) values
    ('智慧型手機'), ('筆記型電腦'), ('平板電腦'), ('穿戴裝置'),
    ('耳機音響'), ('電腦周邊'), ('顯示器')
on conflict (name) do nothing;

insert into brands (name) values
    ('NovaTech'), ('Zentro'), ('Pixelon'), ('Auralis'), ('Kyvo')
on conflict (name) do nothing;

insert into products (code, name, category_id, brand_id, spec, unit, unit_price, stock_qty)
select v.code, v.name, c.id, b.id, v.spec, v.unit, v.unit_price, v.stock_qty
  from (values
    ('P0001', 'Nova X1 智慧型手機',        '智慧型手機', 'NovaTech', '6.1吋 / 128GB / 5G',          '支', 21900, 35),
    ('P0002', 'Nova X1 Pro 智慧型手機',    '智慧型手機', 'NovaTech', '6.7吋 / 256GB / 三鏡頭',       '支', 32900, 20),
    ('P0003', 'Zentro Z5 智慧型手機',      '智慧型手機', 'Zentro',   '6.4吋 / 128GB / 雙卡',         '支', 12990, 50),
    ('P0004', 'Pixelon Book 14 筆電',      '筆記型電腦', 'Pixelon',  '14吋 / i5 / 16GB / 512GB SSD', '台', 28900, 15),
    ('P0005', 'Pixelon Book 16 Pro 筆電',  '筆記型電腦', 'Pixelon',  '16吋 / i7 / 32GB / 1TB / RTX', '台', 52900, 8),
    ('P0006', 'Kyvo AirLite 13 筆電',      '筆記型電腦', 'Kyvo',     '13.3吋 / R5 / 16GB / 512GB',   '台', 24500, 12),
    ('P0007', 'Nova Tab 11 平板',          '平板電腦',   'NovaTech', '11吋 / 128GB / Wi-Fi',         '台', 15900, 25),
    ('P0008', 'Zentro Pad Mini 平板',      '平板電腦',   'Zentro',   '8.7吋 / 64GB / LTE',           '台',  8990, 30),
    ('P0009', 'Auralis Watch S 智慧手錶',  '穿戴裝置',   'Auralis',  '1.4吋 AMOLED / 心率 / GPS',    '支',  7490, 40),
    ('P0010', 'Zentro Band 4 智慧手環',    '穿戴裝置',   'Zentro',   '血氧 / 14天續航',              '支',  1590, 80),
    ('P0011', 'Auralis Buds Pro 降噪耳機', '耳機音響',   'Auralis',  '真無線 / ANC / 30hr',          '副',  5990, 60),
    ('P0012', 'Auralis Studio 耳罩耳機',   '耳機音響',   'Auralis',  '頭戴式 / 藍牙5.3 / 40mm',      '副',  8990, 18),
    ('P0013', 'Kyvo Boom 藍牙喇叭',        '耳機音響',   'Kyvo',     '20W / IPX7 防水',              '台',  2490, 45),
    ('P0014', 'Kyvo K8 機械鍵盤',          '電腦周邊',   'Kyvo',     '87鍵 / 紅軸 / RGB',            '把',  2290, 70),
    ('P0015', 'Kyvo M3 無線滑鼠',          '電腦周邊',   'Kyvo',     '2.4G+藍牙 / 4000DPI',          '個',   890, 120),
    ('P0016', 'Pixelon 1080p 視訊鏡頭',    '電腦周邊',   'Pixelon',  '1080p / 雙麥克風',             '個',  1490, 55),
    ('P0017', 'NovaTech 65W 快充充電器',   '電腦周邊',   'NovaTech', 'GaN / USB-C x2 + USB-A',       '個',  1290, 150),
    ('P0018', 'Pixelon 24吋 IPS 顯示器',   '顯示器',     'Pixelon',  '24吋 / FHD / 75Hz',            '台',  3990, 22),
    ('P0019', 'Pixelon 27吋 2K 電競螢幕',  '顯示器',     'Pixelon',  '27吋 / QHD / 165Hz',           '台',  8990, 14),
    ('P0020', 'Zentro 32吋 4K 顯示器',     '顯示器',     'Zentro',   '32吋 / UHD / HDR400',          '台', 12900, 9)
  ) as v(code, name, category, brand, spec, unit, unit_price, stock_qty)
  join product_categories c on c.name = v.category
  join brands b on b.name = v.brand
 order by v.code
on conflict (code) do nothing;
