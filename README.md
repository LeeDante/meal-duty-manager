# 長時工作訂餐管理－Cloudflare 外網版

此分支使用 Cloudflare Pages Functions、Workers 與 D1，NAS 版本不受影響。

## 結構

- `public/`：手機優先的點餐前台
- `functions/api/[[path]].js`：後端 API
- `migrations/`：D1 資料庫結構
- `wrangler.jsonc`：Cloudflare 設定

## 部署順序

1. 在 Cloudflare 建立 D1 資料庫 `meal-duty-db`。
2. 將資料庫 ID 寫入 `wrangler.jsonc`。
3. 執行 D1 migration。
4. 建立 Pages 專案並連接 GitHub `cloudflare-v2` 分支。
5. 在 Pages 設定加入 D1 binding，名稱必須是 `DB`。
6. 首次開啟網站，從管理者入口設定管理密碼。
7. 在管理後台匯入 NAS 系統診斷 JSON。

## 目前第一階段功能

- 姓名＋五碼工號登入
- 手機餐廳式點餐、數量加減與購物車確認
- 我的訂單
- D1 儲存與 Log
- 管理密碼首次設定
- NAS 診斷 JSON 完整匯入

後續將接續加入完整活動、店家、人員、採購、領餐與收費管理介面。
