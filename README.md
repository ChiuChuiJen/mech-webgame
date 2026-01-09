# 機甲：廢土升等掉寶 (V0.1.9)

## 直接部署到 GitHub Pages
1. 建立一個 GitHub repo（例如 `mech-webgame`）
2. 把此資料夾內所有檔案上傳到 repo root
3. GitHub → Settings → Pages → Build and deployment
   - Source: Deploy from a branch
   - Branch: `main` / root
4. 等 1~2 分鐘後就能用 Pages 網址開啟

## 內容
- `index.html` 主頁
- `styles.css` 樣式
- `main.js` 遊戲邏輯（純前端）
- `data/*.json` 武器/裝甲/核心/套裝/怪物/雜貨店設定

## 改平衡
直接改 `data/*.json` 的數值即可（不需改 JS）。

## V0.1.9 更新
- 增加探索 1F~10F（Boss 擊破解鎖下一層）
- 裝備部位擴充：頭/軀幹/手臂/腿/推進器/核心 + 雙持武器
- 修正 HP/EN/EXP 條未顯示（補上 `.fill` 背景）
- 新增 `data/equipment.json`（可對應你的 equipment_all 表匯入）
- 怪物表改為 `data/monsters.json`（含 floor、role：普通/菁英/MiniBoss/Boss）

## V0.1.9 更新
- 右上新增齒輪（設定）
- 設定面板整合：存檔/讀檔（localStorage）、匯入/匯出存檔 JSON、匯入/匯出 Base JSON

## V0.1.9 更新
- 修正齒輪⚙️按鈕顯示（改為 emoji icon）
- 新增戰鬥彈窗：敵我資訊、即時戰鬥歷程、戰鬥結算獎勵

## V0.1.9 更新
- 戰鬥彈窗 RPG 化：技能列表、狀態異常、回合數、自動戰鬥開關、戰鬥結束「繼續探索/離開」、逐項掉落卡片
- 武器/防具/配件（裝備）加入隨機屬性範圍（掉落/購買後生成），並給予評分 1~99
- 商店裝備：購買後才揭示隨機數值（顯示 ??）
- 背包物品顯示與已裝備比對箭頭（⬆️⬇️↔️）

## V0.1.9 熱修
- 修正 V0.1.4 造成 UI 無法操作的錯誤（缺少 slotName / rankRarity 函數別名）。

## V0.1.9 熱修
- 修正 main.js 末尾函式重複宣告導致整個 UI 無法操作（SyntaxError）。

## V0.1.9 熱修
- 修正資料載入鍵名：drop_and_shop.json 載入到 DB.drop_and_shop（避免 DB.drop_and_shop 為 undefined）。

## V0.1.9 熱修（衝突修正）
- 統一 drop/shop 資料鍵名：相容 DB.drop_and_shop 與 DB.drop_shop，避免 undefined 造成 UI 全掛。
- weightedPickRarity / rerollShop 具備缺資料保護，並相容舊/新 shop_base_by_floor 格式。
- 補齊 rankRarity（供背包排序/比對使用），避免 ReferenceError。

## V0.1.9 更新
- 修正背包「裝備」按鈕：改為自動判斷部位/左右手後裝備（equipInv → 轉呼叫 equip(slot, uid)）
- 戰鬥視窗技能欄改為「精簡技能按鈕列」，大幅縮小佔用空間（描述改成 hover 提示）
