# Facebook Messenger App

一個基於 Electron 開發的 [Facebook Messenger](https://www.facebook.com/messages/) 桌面應用程式。本專案將官方網頁版介面封裝為具有原生體驗的桌面軟體，並增強了多項功能。

[English Readme](README.md)

## 功能特色

*   **原生體驗**：獨立的桌面應用程式視窗，不再依賴瀏覽器分頁。
*   **多語言支援**：介面支援 **英文** 與 **繁體中文**（可於選單中切換）。
*   **自動更新**：自動檢查 GitHub Release 上的新版本並通知下載。
*   **桌面通知**：可在「檢視 → 通知模式」選擇「原始網頁通知」或「僅 Messenger（應用程式通知）」。後者會封鎖 Facebook 網頁通知，優先比較 Messenger 對話列表中的已知對話、最後訊息預覽及未讀外觀；未讀徽章增加或 Messenger 頁面標題變化作為備援。可用「檢視 → 在通知中顯示訊息預覽」控制是否在應用程式通知中顯示可讀取的預覽；只有徽章或標題訊號、或多則訊息合併時仍顯示通用文字。預覽可能被 Facebook 截斷；預設開啟，設定會被記住。收到通知後，Windows 工作列會保留未讀提示；同一訊息的重複訊號會被合併，但之後的新訊息仍可再通知（短時間內的多則訊息可能合併為一次）。確認對話已讀或可靠的未讀數歸零時會清除提示。如果網頁未提供足夠狀態，可用「檢視 → 清除未讀提示」手動清除。首次載入的既有未讀、手動標為未讀及新出現但未建立基準的對話不會觸發列表訊號。偵測不依賴訊息語言，但 Facebook 頁面改版或未提供足夠結構時可能漏報，標題備援仍有誤報風險。兩種模式都受「啟用背景通知」總開關控制。
*   **強化的右鍵選單**：
    *   **編輯區**：復原、重做、剪下、複製、貼上、全選。
    *   **訊息瀏覽**：複製整則訊息、複製圖片、在瀏覽器中開啟連結。
*   **安全隱私**：外部連結與 Facebook 追蹤網址會自動在您的預設瀏覽器中開啟，確保安全。
*   **視窗狀態記憶**：自動記憶上次關閉時的視窗大小與位置。

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
