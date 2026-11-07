# MAJU 先買後付分期 – 線上通路原型（XMART GO → MAJU）

對應《MAJU 完整系統需求規劃書》第 6.1 節的線上購物流程，並套用第 3、4、5、7、8.1 章的
會員等級、鑽石卡、定價引擎、共用額度與最低應繳規則。純 Node.js（18+），不需安裝任何套件。

## 啟動

```bash
node server.js
```

- XMART GO 示範頁（合作電商）：http://localhost:3000/partner/
- MAJU 確認頁：http://localhost:3000/maju/checkout?merchant=xmart_go&product_id=P001
- 右上角「示範會員」可切換 VIP1 / VIP3 / VIP7 / 鑽石卡 / 逾期停權會員，觀察不同結果。

## 流程

1. 顧客在 XMART GO 商品頁按「MAJU 分期付款」。
2. XMART GO 以網址把 `merchant`（商家代號）與 `product_id` 帶到 MAJU 確認頁。
3. MAJU 後端 `GET /api/quote` 即時呼叫 XMART GO 的商品 API（帶 `X-API-Key`），取回商品名稱、規格、圖片、原價、庫存。
4. MAJU 依登入會員類型計算 MAJU 售價、可用額度與分期方案，回傳給確認頁顯示。
5. 顧客確認後 `POST /api/orders`：後端**重新向合作電商取價**（不信任前端金額），再次檢核資格與額度，建立訂單、保存價格快照並保留額度。
6. 取消訂單 `POST /api/orders/:id/cancel` 釋放保留額度。

## 已實作的規劃書規則

| 規則 | 出處 | 實作位置 |
| --- | --- | --- |
| 一般 VIP 原價區間倍率：1–499 ×1.05、500–999 ×1.10、1,000–1,999 ×1.11，每增 NT$1,000 +0.01（50,000–50,999 = ×1.60） | 5.1 | `vipRate()` |
| 鑽石卡固定原價 ×1.05，不套 VIP 倍率 | 4.2 | `computeMajuPrice()` |
| 計算結果有小數一律無條件進位 | 4.2 / 5.1 | `Math.ceil` |
| VIP1–VIP7 卡別與基本額度 5,000–35,000 | 3.1 | `VIP_LEVELS` |
| 鑽石卡額度＝已入帳保證金 | 4.1 | `creditOf()` |
| 可用額度＝基本額度－未償還帳款－保留額度；超額阻擋 | 7.1 | `creditOf()` / `buildQuote()` |
| 超額：VIP 可申請單筆人工審核，鑽石卡須追加保證金 | 7.2 / 4.1 | `buildQuote().eligibility` |
| 各等級可選期數由後台設定（目前預設 3/6/9/12） | 5.2 | `SETTINGS.installmentTermsByLevel` |
| 鑽石卡不設固定期數，每月最低應繳 3,000 繳到清償 | 4.3 | `buildPlans()` |
| 每月最低應繳日 10 日、最低應繳 3,000 可後台調整 | 8.1 | `SETTINGS` |
| 任何逾期立即停止新交易 | 9.1 | `eligibility()` |
| 訂單保存當次價格與計算紀錄（價格快照） | 5.1 第 7 點 | `order.priceSnapshot` |
| 訂單建立保留額度、取消釋放額度 | 6.1 / 7.1 | `/api/orders`、`/cancel` |

## 與合作電商的 API 契約（MAJU 呼叫合作電商）

```
GET {apiBase}/products/{product_id}
Header: X-API-Key: <MAJU 核發給該商家的金鑰>

200 → { "id", "name", "brand", "spec", "price", "currency", "stock", "image" }
404 → 查無商品
```

合作電商只要提供上述端點，就能接入；商家代號、API 位址、金鑰集中在 `server.js` 的 `MERCHANTS`
（正式環境放資料庫，由後台「商家管理 / API 管理」維護）。

## 正式上線前要補的項目

- 會員改由 MAJU 登入 session 取得（原型用網址 `member=` 參數方便示範，正式環境不可如此）。
- KYC 狀態、逾期天數、升降級由會員／逾期模組提供；此處僅以假資料示意。
- 跳轉參數加上簽章（HMAC）與時效，防止偽造商家代號。
- 付款確認回寫 XMART GO（訂單狀態、取消／退款同步，6.1 第 11–12 點）。
- 分期計算方式、各等級可用期數、倍率延伸設定改為後台維護並保留歷史版本。
