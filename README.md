# My-App：英文對話練習

一個簡單的網頁程式：電腦會用英文和你聊天，如果你打的英文句子有文法、用字或拼字錯誤，會先用中文說明並給出正確寫法，再繼續對話。

使用 **Google Gemini API**（Google AI Studio 提供免費額度）。

## 使用方式

1. 到 [Google AI Studio](https://aistudio.google.com/apikey) 用 Google 帳號免費申請一組 API Key。
2. 用瀏覽器直接打開 `index.html`（雙擊即可，不需要安裝任何東西）。
   - 或在資料夾內執行 `python3 -m http.server 8000`，再開 http://localhost:8000
3. 在「設定」中貼上 API Key，按「儲存」。
4. 開始用英文打字聊天！

## 功能

- 🗣️ 與電腦進行英文對話（會延續上下文）
- ✏️ 自動檢查文法並以繁體中文解釋錯誤
- 🎯 可設定對話主題（例如 travel、ordering food、job interview）
- 🔊 可選擇讓瀏覽器朗讀電腦的回覆
- 🔁 可切換模型（預設 `gemini-2.5-flash`；若 Google 更新模型名稱，可在設定中改）

## 檔案

| 檔案 | 說明 |
| --- | --- |
| `index.html` | 頁面結構 |
| `style.css` | 樣式 |
| `app.js` | 對話邏輯與 Gemini API 呼叫 |

## 注意

- API Key 只存在你自己瀏覽器的 localStorage，不會上傳到其他地方，但請勿把含有 Key 的網頁分享給別人。
- 免費額度有每分鐘／每日的請求次數限制，若出現 429 錯誤，稍等一下再試即可。
