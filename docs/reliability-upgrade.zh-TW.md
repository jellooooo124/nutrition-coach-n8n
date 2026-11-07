# 可靠性升級：安裝與驗收

這次保留 Google Sheets 作為教練審核介面，讓新增草稿改走HTTPS FastAPI + PostgreSQL 寫入服務。只處理 `TEST-` 虛構學員；不是正式醫療系統。現有 Google/Gemini 憑證仍留在 n8n，服務新增一個僅能存取測試試算表的 Google service account。

## 這三個改進如何運作

| 情境 | 新行為 | 要看到的證據 |
| --- | --- | --- |
| 兩個流程同時處理同一餐 | PostgreSQL `(kind,id)` 主鍵及交易只授權一個寫入者；其他請求回傳已完成或 409 | 同一 ID 在 Sheets 只有一列；人工修改不變 |
| Sheets 已寫成功，但回應斷線 | 記錄 `REVIEW_REQUIRED`；不直接重送 append。核對找到相同 ID 後標記完成 | 核對不增加列、不修改內容 |
| 寫入前讀取 Sheets 就失敗 | 記錄 `RETRYABLE`；修正權限或連線後可重送 | 沒有做過 append，重送後只有一列 |
| n8n 錯過日報／週報時間 | 日報掃描最近 7 個已結束日期；週報掃描最近 14 天內到期的完整週 | 只補缺少 ID，最多第 8 週，不建立今天未完成的日報 |
| 一次積壓很多報表 | 每個日報／週報 workflow 每次最多 5 份 | 多次執行逐批補齊；已有列不再送模型 |
| Gemini 回傳錯誤型別／缺欄位／截斷 | 輸出驗證直接停止該次執行，不送入寫入服務 | n8n 顯示穩定的 `AI_RESPONSE_REJECTED` 原因，不顯示原始回傳內容 |

補跑使用 Sheets 已完成 ID 作為持久完成紀錄，服務保留自己的寫入狀態；它不是完整的排程任務資料庫。超過時間窗口的缺漏需人工評估後調整 `BACKFILL_DAYS`。先估算模型成本；每份報表的現有 Gemini 節點最多嘗試 3 次，所以 5 份報表最多可能發出 15 次請求。`PREVIEW_ONLY` 仍只控制寫入，並非免費離線模式。

## 第一步：先準備獨立測試環境

1. 停用舊版四個 workflow 的排程／輪詢，匯出備份。不要讓舊版直接 Sheets append 與新版並行。
2. 使用獨立測試試算表，確認四個輸出分頁的欄名與 `service/columns.json` 完全一致、ID 欄沒有重複。保留所有教練編輯。
3. 在你自己的 Google Cloud 專案啟用 Google Sheets API，建立 service account。只將**這一份測試試算表**分享給該帳號 email，權限為編輯者。不必分享私人照片，也不要設為公開。
4. 由你下載 service account JSON，放在專案 `.local/service-account.json` 或其他不受 Git 追蹤的位置。不要貼到聊天或匯入 workflow JSON。

此服務只使用 Sheets scope；Drive 圖片下載仍由既有 n8n OAuth 憑證處理。若組織政策禁止 service account key，不要繞過政策：需改接核准的 OAuth／工作負載身分流程，不能直接套用此安裝方式。

## 第二步：部署 n8n Cloud 能連線的服務

建議使用 Vercel Python 服務與獨立 PostgreSQL（例如 Neon）。尚未替你的帳號建立資源或部署；先確認所在地區與帳號費用。n8n Cloud 不可使用 localhost。

1. 在 PostgreSQL 的 SQL 編輯器執行 `service/schema.sql` 一次，取得 TLS 連線字串。使用獨立測試資料庫，不要連正式資料庫。
2. 在 Vercel 匯入本 repo 的升級分支，Root Directory 設為 **service**，Framework 選 Other；不要設定前端 build/output 指令。入口由 `pyproject.toml` 指定。
3. 在 Vercel 專案環境變數設定以下五項，值只在平台的秘密設定欄位輸入，不貼到聊天、Git 或 workflow JSON：

| 名稱 | 值 |
| --- | --- |
| `NUTRITION_DATABASE_URL` | PostgreSQL TLS 連線字串 |
| `NUTRITION_GATEWAY_KEY` | 至少 32 字元的隨機密鑰；n8n Header Auth 使用相同值 |
| `NUTRITION_ENCRYPTION_KEY` | Fernet 金鑰；所有部署共用並妥善備份，不可每次重新產生 |
| `NUTRITION_SPREADSHEET_ID` | 獨立測試試算表 ID |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | 完整 service account JSON，作為單一秘密值 |

可用本機 `scripts/init-gateway.py` 產生兩個金鑰，從忽略且權限受限的 `.local/gateway.env` 複製到平台；它不會列印密鑰。其本機資料庫路徑不要填到雲端。所有部署須共用同一 PostgreSQL 與加密金鑰。

4. 部署後打開 `https://你的服務網址/health`，應回傳 `ok: true`。這只驗證啟動，不代表 Google 或資料庫讀寫已驗收。
5. n8n 必須能連到該 HTTPS 網址。若平台另有登入保護，需設定適用此 API 的存取政策；不要將平台繞過密鑰寫進匯出檔。API 本身始終要求 `X-Nutrition-Key`。

官方部署參考：[Vercel FastAPI](https://vercel.com/docs/frameworks/backend/fastapi)。SQLite 只保留給本機測試，Vercel 缺少 PostgreSQL 設定會拒絕啟動。

本機測試（Python 3.12+）：

```sh
python3 -m venv .venv
. .venv/bin/activate
pip install -r service/requirements.txt pytest==9.1.1
python scripts/init-gateway.py YOUR_SPREADSHEET_ID /absolute/path/to/service-account.json
pytest -q service/tests
```

## 第三步：匯入並綁定新版

1. 執行原本 `npm run configure -- SPREADSHEET_ID INTAKE_GID https://YOUR_DEPLOYED_HOST`，匯入 `.local/workflows/` 的四份新副本，暫時不發布。
2. Google Sheets **讀取**節點、Drive 與 Gemini 沿用原本憑證。
3. 在 n8n 建立一組 **Header Auth** 憑證：Header 名稱 `X-Nutrition-Key`；值從你本機 `.local/gateway.env` 的 `NUTRITION_GATEWAY_KEY` 取得。不要把引號一起貼入。
4. 在四個原本「新增…」節點選擇這組憑證。它們現在是 HTTP Request，網址為 `https://YOUR_DEPLOYED_HOST/v1/drafts/對應分頁`。
5. 保留 `PREVIEW_ONLY=true` 先檢查設定。準備進行允許付費的合成資料驗收後，再手動執行；預覽會呼叫 Gemini。
6. 準備寫入時，只在自己的副本改為 `PREVIEW_ONLY=false`。所有草稿仍固定待教練審核，沒有自動發訊。

## 第四步：依序驗收，逐項勾選

- [ ] **模型格式防線（離線）**：`npm test`。確認缺欄位、物件冒充字串、空白草稿、超長輸出、MAX_TOKENS／SAFETY 都失敗。
- [ ] **並行與斷線（離線）**：`pytest -q service/tests`。模擬 24 個競爭請求，驗證一筆寫入；模擬寫入成功但回應丟失，驗證核對不覆寫人工編輯。
- [ ] **Google 連線（真實）**：用一筆 `TEST-` 文字餐點跑新版，確認 `Meals` 只有一列；這會使用 Gemini，須先確認可接受費用。
- [ ] **保護人工內容（真實）**：修改該列 `coach_approved_text`，再執行同 ID。確認列數不變、修改仍在。
- [ ] **補跑（真實）**：測試學員缺兩天日報、已有一天日報；執行 WF02，確認只補缺少的日子。WF03 用錯過滿週日的學員驗證，不需真的等待一週。
- [ ] **重新啟動（真實）**：服務停止再啟動，保留同一個 DB 與加密金鑰，重跑相同 ID，不新增列。
- [ ] **錯誤權限（真實）**：使用錯誤 gateway key，只得到 401；不新增列。測試後恢復正確憑證。
- [ ] 所有檢查完成後才發布新版，確認沒有舊版同時寫入。

不要用真實病患資料驗收。離線測試使用記憶體中的 Sheets 替身，沒有證明你帳號的 OAuth／service account 權限、Google 可用性或 Gemini 輸出品質；n8n 匯入 CI 也不是完整 live 執行證據。

## 發生錯誤時

可在 n8n 建立手動 HTTP Request，使用同一組 Header Auth：

- `GET https://YOUR_DEPLOYED_HOST/v1/jobs`：查看最近 100 筆 ID／狀態，不會回傳草稿內容。
- `POST https://YOUR_DEPLOYED_HOST/v1/reconcile/Meals/FORM-TEST-001`：核對指定 ID 是否已在 Sheets。其他分頁用對應名稱，ID 的 `|` 等字元須做 URL 編碼。

`DELIVERED` 表示找到既有列或 append 已確認，並不代表人工審核或發送完成。`RETRYABLE` 表示失敗發生在 append 之前。`RESERVED`／`WRITING`／`REVIEW_REQUIRED` 表示不要盲目重送：先讓原執行結束並核對。核對找不到資料時，服務**不會自動解鎖重寫**，因為舊請求可能延遲完成；先停止所有寫入者、調查 Google 執行狀態，確定沒有在途請求後再由維護者處理該筆紀錄。不要刪 DB「解除去重」。

## 能力範圍與回復

- 雲端競爭請求必須共享同一 PostgreSQL；SQLite 僅限本機單檔測試，不可使用 serverless 暫存磁碟。資料庫整合測試在 CI 使用一次性 PostgreSQL 17，Google 寫入仍用替身。
- Sheets 與資料庫 不是分散式交易，因此採保守的「不確定就停止」策略；不是 exactly-once 的跨系統保證。
- 不能阻止人手或舊 workflow 直接往 Sheets 新增重複 ID。必須停用舊寫入路徑；服務不覆寫已存在列，也不自動修復既有重複資料。
- 去重保護的是草稿寫入。兩個同時開始的 workflow 仍可能各呼叫一次 Gemini；未宣稱模型請求 exactly-once，也未新增正式的錯誤通知／值班服務。
- 檢查 JSON schema 不等於確認營養資訊正確，既有保守文字檢查與人工審核仍必要。
- 回復時先停用新版排程，保留 DB、密鑰、Sheets 與 workflow 備份，再恢復舊版本；舊版原本的併發風險會重新出現，不要兩版並行。
