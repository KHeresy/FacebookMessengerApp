# Facebook Messenger App

一個基於 Electron 開發的 [Facebook Messenger](https://www.facebook.com/messages/) 桌面應用程式。本專案將官方網頁版介面封裝為具有原生體驗的桌面軟體，並增強了多項功能。

[English Readme](README.md)

## 功能特色

*   **原生體驗**：獨立的桌面應用程式視窗，不再依賴瀏覽器分頁。
*   **多語言支援**：介面支援 **英文** 與 **繁體中文**（可於選單中切換）。
*   **自動更新**：自動檢查 GitHub Release 上的新版本並通知下載。
*   **桌面通知**：可在「檢視 → 通知模式」選擇「原始網頁通知」或「僅 Messenger（應用程式通知）」。後者會封鎖 Facebook 網頁通知，比較已知對話的最後訊息預覽及未讀外觀，也會確認預覽更新後稍晚才出現的未讀外觀；未讀徽章增加或 Messenger 頁面標題變化作為備援。可用「檢視 → 在通知中顯示訊息預覽」控制可讀取的預覽（預設開啟）；只有徽章或標題訊號、或多則訊息合併時顯示通用文字，預覽可能被 Facebook 截斷。同一訊息的重複訊號會合併；通知冷卻期內不同的對話／徽章新訊號會延後送出，也可能合併。未讀數下降並穩定後會更新通知基準。Windows 工作列上已確認對話的提示會保留到已讀；無法識別對話的標題／徽章提醒，會在回到 Messenger 並重新掃描後視為已查看。可靠的零未讀會清除提示及待送通知，殘留的網頁徽章不會重新點亮已清除的應用程式提示。找不到或無法識別徽章代表未知；曾識別數字的控制項必須持續空白一段時間才能回報零，且可見未讀對話會優先阻止誤清除。若無法確認已讀，可用「檢視 → 清除未讀提示」。首次載入的既有未讀、沒有近期預覽變化的手動標為未讀，以及尚無基準的新出現對話不會觸發列表訊號。偵測依賴 Facebook 頁面結構；相同內容連續到達且無其他訊號時仍可能漏報，標題備援仍可能誤報。兩種模式都受「啟用背景通知」總開關控制。
*   **強化的右鍵選單**：
    *   **編輯區**：復原、重做、剪下、複製、貼上、全選。
    *   **訊息瀏覽**：複製整則訊息、複製圖片、在瀏覽器中開啟連結。
*   **安全隱私**：外部連結與 Facebook 追蹤網址會自動在您的預設瀏覽器中開啟，確保安全。
*   **視窗狀態記憶**：自動記憶上次關閉時的視窗大小與位置。

「僅 Messenger」的未讀偵測支援粗體預覽，以及對話列末端的小型藍色未讀圓點，會排除頭像上的上線狀態圓點。仍需近期預覽變更才能區分新訊息與手動標為未讀。

## 安裝

請至 [Releases](https://github.com/KHeresy/FacebookMessengerApp/releases) 頁面下載適用於您作業系統的最新安裝檔。

## 開發

### 前置需求

*   Node.js (建議使用 LTS 版本)
*   npm

### 設定

```bash
# 複製專案
git clone https://github.com/KHeresy/FacebookMessengerApp.git

# 進入目錄
cd FacebookMessengerApp

# 安裝依賴
npm install
```

### 本地執行

```bash
npm start
```

### 建置安裝檔

#### Windows

```bash
npm run build
# 安裝檔位於： dist\Facebook Messenger.exe
```

#### macOS

```bash
npm run build -- --mac
# DMG/App 檔案位於： dist/
```

## 疑難排解

### macOS: "App is damaged and can't be opened" (應用程式已損毀，無法開啟)

由於本應用程式未經過 Apple 開發者憑證簽章，macOS Gatekeeper 可能會阻擋執行。解決方法如下：

1.  開啟 **終端機 (Terminal)**。
2.  執行以下指令：
    ```bash
    sudo xattr -cr /Applications/Facebook\ Messenger.app
    ```
    *(若您的安裝路徑不同，請自行調整)*
3.  現在您應該可以順利開啟應用程式了。
