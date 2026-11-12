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

When preparing a commit, refer to `.github/skills/commit-convention/SKILL.md` to ensure the commit message conforms to this standard.
