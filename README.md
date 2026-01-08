# 機甲：廢土升等掉寶 (V0.1.0)

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
