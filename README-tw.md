# Facebook Messenger App

一個基於 Electron 開發的 [Facebook Messenger](https://www.facebook.com/messages/) 桌面應用程式。本專案將官方網頁版介面封裝為具有原生體驗的桌面軟體，並增強了多項功能。

[English Readme](README.md)

## 功能特色

*   **原生體驗**：獨立的桌面應用程式視窗，不再依賴瀏覽器分頁。
*   **多語言支援**：介面支援 **英文** 與 **繁體中文**（可於選單中切換）。
*   **自動更新**：自動檢查 GitHub Release 上的新版本並通知下載。
*   **桌面通知**：
    *   **通知模式**：在「檢視 → 通知模式」選擇「原始網頁通知」或「僅 Messenger（應用程式通知）」。後者會封鎖 Facebook 網頁通知，改由應用程式偵測並顯示原生通知。
    *   **新訊息偵測**：「僅 Messenger」模式支援 Facebook 一般與端對端加密（E2EE）對話列，會比對已知對話的預覽變化及未讀外觀（粗體預覽或藍點）；未讀徽章增加是備援訊號。頁面標題變化不會觸發通知。首次載入時已有的未讀、沒有近期預覽變化的手動標為未讀，以及尚未建立基準的新對話，不會單靠對話列觸發通知。相同訊號會合併；冷卻期間到達的不同訊息會延後通知，並可能合併顯示。
    *   **訊息預覽**：使用「檢視 → 在通知中顯示訊息預覽」控制是否顯示可讀取的訊息預覽（預設開啟）。只有徽章訊號或多則訊息合併時會顯示通用文字；預覽可能已被 Facebook 截斷。
    *   **Windows 工作列提示**：依成功掃描到的對話列藍點顯示未讀圖示；確認至少 1.5 秒都沒有藍點後清除。清單暫時無法使用時會保留前次狀態。「檢視 → 清除未讀提示」會清除工作列提示（圖示與閃爍），但不會取消已排程的通知預覽；在「僅 Messenger」模式下，藍點仍存在時若有新通知，或藍點確認消失後再次出現，提示可重新顯示。
    *   **限制與設定**：偵測依賴 Facebook 頁面結構；預覽連續相同或清單尚未載入時，仍可能漏報或誤報。兩種模式都受「檢視 → 啟用背景通知」總開關控制。
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
