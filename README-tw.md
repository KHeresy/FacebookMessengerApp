# Facebook Messenger App

一個基於 Electron 開發的 [Facebook Messenger](https://www.messenger.com/) 桌面應用程式。本專案將官方網頁版介面封裝為具有原生體驗的桌面軟體，並增強了多項功能。

[English Readme](README.md)

## 功能特色

*   **原生體驗**：獨立的桌面應用程式視窗，不再依賴瀏覽器分頁。
*   **多語言支援**：介面支援 **英文** 與 **繁體中文**（可於選單中切換）。
*   **自動更新**：自動檢查 GitHub Release 上的新版本並通知下載。
*   **桌面通知**：收到新訊息時會顯示原生系統通知。
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
