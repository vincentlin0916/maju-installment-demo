# MAJU 先買後付 – 線上通路原型（XMART GO → MAJU）

顧客在合作電商選「MAJU 分期付款」後跳轉到 MAJU，MAJU 即時向合作電商的 API 取回商品，
依會員資格計算 MAJU 商城售價，並判斷額度夠不夠。純 Node.js（18+），不需安裝任何套件。

規則依 2026-11-07 需求規劃書，並套用 2026-11-13 會議的修正：**不再選期數**，
只看額度；每月最低應繳 NT$3,000；額度不足可申請單筆人工審核。

線上示範（單檔、資料只在瀏覽器內）：https://vincentlin0916.github.io/maju-installment-demo/

## 啟動

```bash
node server.js
```

- XMART GO 示範頁（合作電商）：http://localhost:3000/partner/
- MAJU 確認頁：http://localhost:3000/maju/checkout?merchant=xmart_go&product_id=P001
- 右上角「示範會員」可切換新會員、VIP3、VIP7、鑽石卡、逾期 3 天、逾期 9 天、逾期 35 天。

## 流程

1. 顧客在 XMART GO 商品頁按「MAJU 分期付款」，網址帶 `merchant` 與 `product_id` 到 MAJU 確認頁。
2. MAJU 後端 `GET /api/quote` 即時呼叫 XMART GO 的商品 API（帶 `X-API-Key`）取回商品。
3. MAJU 計算 MAJU 商城售價、可用額度與繳款試算。**原價、倍率與計算方式不回傳給顧客端**。
4. 額度足夠：`POST /api/orders` 建立訂單並保留額度。後端會重新向合作電商取價，不信任前端金額。
5. 額度不足：符合條件者可 `POST /api/over-limit-requests` 申請人工審核。
   後台核准（`.../approve`）後訂單才成立；駁回（`.../reject`）則不成立。
6. 取消訂單 `POST /api/orders/:id/cancel` 釋放保留額度。

## 目前實作的規則

| 規則 | 設定或函式（`lib/core.js`） |
| --- | --- |
| 一般 VIP 原價區間倍率：1–499 ×1.05、500–999 ×1.10、1,000 起每滿 1,000 再 +0.01（50,000–50,999 = ×1.60） | `vipRatePct()` |
| 鑽石卡固定原價 ×1.05 | `SETTINGS.diamondRatePct` |
| 小數一律無條件進位（以整數百分比計算，避免浮點誤差） | `computeMajuPrice()` |
| VIP1–VIP7 等級額度 5,000–35,000，每級 +5,000；鑽石卡額度＝已入帳保證金 | `VIP_LEVELS`、`creditOf()` |
| 可用額度＝等級額度－未償還帳款－保留額度，最低為 0 | `creditOf()` |
| 不分期數：每月 10 日前最低應繳 3,000，帳款不足 3,000 時繳清餘額 | `repaymentOf()` |
| 會員自填繳款金額：最低應繳 ≤ 金額 ≤ 帳款，不能預繳 | `validatePayment()` |
| 額度不足可申請單筆人工審核：最多比等級額度多 10,000、至少繳過 1 期、沒有逾期 | `overLimitOf()` |
| 人工審核多給的部分要先還完：帳款高於等級額度時可用額度為 0，也不能再申請 | `creditOf()`、`overLimitOf()` |
| 鑽石卡額度不足須追加保證金，不適用人工審核 | `overLimitOf()` |
| 逾期 1–6 天：提醒，仍可消費；逾期達 7 天：暫停新消費、VIP 降一級；逾期達 30 天：停止所有交易並進入法律程序 | `standing()` |
| 訂單保存當次價格與計算紀錄（價格快照） | `createStore().makeOrder` |

## 已定案

- **逾期達 7 天才停止新消費**（2026-11-13 確認，`overdueLockDays`）。逾期 1–6 天只提醒、仍可消費。
  規劃書第 9 章「任何逾期立即停權」以此為準更新。
- **逾期達一個月提告並永久停止交易**（2026-11-13 確認，`overdueLegalDays` 以 30 天計）。
- **額度以 MAJU 商城售價占用**（2026-11-13 確認）。欠款與已用額度是同一個數字。
  正式系統 V2.6 目前以商品價占用，整合時要改。

## 尚待確認（目前以設定值暫定）

- **每月應繳日**：目前用規劃書的每月 10 日。

## 檔案

| 檔案 | 用途 |
| --- | --- |
| `lib/core.js` | 計價、額度、逾期、繳款與人工審核規則。伺服器與單檔示範頁共用 |
| `server.js` | 原型伺服器：模擬合作電商商品 API、MAJU API、靜態頁 |
| `public/shared/maju-ui.js` | MAJU 確認頁的畫面邏輯，只顯示 API 回傳的結果 |
| `src/` | 樣式、畫面骨架與兩種版本的進入點 |
| `build.js` | 由上述檔案產生 `public/maju/checkout.html`、`index.html` 與 `share/` 內的單檔示範頁 |

修改 `src/`、`lib/core.js` 或 `public/shared/maju-ui.js` 後執行：

```bash
node build.js
```

## 與合作電商的 API 契約（MAJU 呼叫合作電商）

```
GET {apiBase}/products/{product_id}
Header: X-API-Key: <MAJU 核發給該商家的金鑰>

200 → { "id", "name", "brand", "spec", "price", "currency", "stock", "image" }
404 → 查無商品
```

商家代號、API 位址、金鑰集中在 `server.js` 的 `MERCHANTS`
（正式環境放資料庫，由後台「廠商管理」維護）。

## 正式上線前要補的項目

- 會員改由 MAJU 登入 session 取得（原型用網址 `member=` 參數方便示範，正式環境不可如此）。
- 人工審核的核准與駁回要在管理後台進行，需員工登入、權限與稽核紀錄。原型用頁面上的示範按鈕代替。
- KYC 狀態、逾期天數、升降級由會員與催收模組提供；此處僅以假資料示意。
- 跳轉參數加上簽章（HMAC）與時效，防止偽造商家代號。
- 付款確認回寫 XMART GO（訂單狀態、取消與退款同步）。
- 倍率表、最低應繳、人工審核上限與逾期天數改為後台維護並保留歷史版本。
- 單檔示範頁沒有後端，計價規則在頁面原始碼裡看得到；正式環境的規則只能留在伺服器。
