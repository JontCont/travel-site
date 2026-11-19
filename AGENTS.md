# Agent Guidelines & Commit Rules

## Git Commit Convention

All Git commit messages in this repository must strictly adhere to the following format:

```text
[類別] 修改說明
```

### Format Requirements
- **Must start with `[category]`**, followed by a single space and a concise description.
- **Example**: `[bug] 版型跑版調整共用 scrollbar`

### Supported Categories:
- `[feat]` - New feature or enhancement
- `[bug]` / `[fix]` - Bug fix, layout/styling bug correction
- `[style]` - Pure style/CSS formatting without logic change
- `[refactor]` - Code refactoring that neither fixes a bug nor adds a feature
- `[chore]` - Build, CI/CD, dependencies, or configuration updates
- `[docs]` - Documentation updates
- `[test]` - Adding or updating tests

When preparing a commit, refer to `.agents/skills/commit-convention/SKILL.md` to ensure the commit message conforms to this standard.

## README & 公開文件規範（嚴格遵守）

為避免將內部商業邏輯或敏感架構細節公開至 GitHub，撰寫或修改 `README.md` 及其他公開 Markdown 文件時，**必須嚴格遵守**以下規範：

- **禁止寫入商業邏輯與業務規則**：不得在 `README.md` 中描述詳細的欄位驗證規則、狀態判定條件、角色權限細則、通行碼撤銷/過期機制或內部業務流程。
- **禁止暴露內部架構與安全細節**：不得公開資料庫 Schema（`CREATE TABLE`）、加密與雜湊實作細節（如金鑰儲存位置、Session 有效期）、反向代理 IP 標頭解析順序、私有 NAS 拓撲或容器內部 UID/GID 等敏感資訊。
- **保持簡潔概覽（如 n8n 等開源專案風格）**：`README.md` 僅能包含專案簡介、高層次功能特色、技術棧、基本安裝與啟動指令（開發/Docker 啟動方式）。

