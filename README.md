# 禁言恢复插件

非本人解除禁言时自动恢复剩余时间禁言。

## 功能说明

当群成员被禁言后，插件会记录禁言时长和第一次禁言的操作者。当该成员被解除禁言时：
- 如果解除禁言的人**不是第一次禁言的操作者**，插件会**自动恢复剩余禁言时长**
- 如果解除禁言的人**是第一次禁言的操作者**，则**不恢复禁言**（可根据配置调整）

### 核心特性

- **记录禁言信息**：记录禁言时长、操作者、第一次禁言的操作者
- **自动恢复禁言**：非原操作者解除时，自动恢复剩余禁言时间
- **发言时检查**：用户发言时自动检查并恢复禁言
- **退群/进群追踪**：用户退群后保留禁言记录，重新进群时自动恢复
- **灵活配置**：支持开关控制是否允许原操作者解除禁言
- **持久化存储**：禁言记录保存在配置文件中，重启不丢失

## 使用场景

1. **防止恶意解除禁言**：其他管理员提前解除禁言时，自动恢复剩余时间
2. **退群逃避禁言**：用户退群后重新进群，自动恢复剩余禁言
3. **发言触发恢复**：被解除禁言的用户发言时，自动恢复禁言

## 📦 安装方式

### 方式一：插件商店安装（推荐）

1. 打开 NapCat 终端，执行以下命令替换插件源地址：
   ```bash
   sed -i 's/NapNeko\/napcat-plugin-index/HolyFoxTeam\/napcat-plugin-community-index/g' ./napcat/napcat.mjs
   ```

2. 重启 NapCat 容器：
   ```bash
   docker restart napcat
   # 或
   systemctl restart napcat
   ```

3. 打开 NapCat WebUI，进入插件商店，搜索 **"自动同意加群"** 即可安装

### 方式二：手动安装

1. 从 [Releases](https://github.com/XingYunStar/napcat-plugin-mute-recover/releases) 下载最新版本的 `.zip` 文件
2. 解压到 NapCat 的 `plugins` 目录
3. 重启 NapCat

## 配置说明

### 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| enablePlugin | boolean | true | 插件总开关 |
| enableAutoReBan | boolean | true | 是否自动恢复禁言 |
| enableLogDetails | boolean | true | 是否记录详细日志 |
| clearRecordOnFullUnban | boolean | true | 禁言完整结束后是否清除记录 |
| trackOnLeave | boolean | true | 退群时是否保留禁言记录 |
| trackOnMessage | boolean | true | 发言时是否检查并恢复禁言 |
| allowOperatorUnban | boolean | false | 允许禁言操作者解除禁言 |

### allowOperatorUnban 说明

| 设置 | 行为 |
|------|------|
| false **(默认)** | 任何人解除禁言都会立即恢复剩余时间 |
| true | 只有第一次禁言的操作者解除时才不恢复，其他人解除会立即恢复 |

## 工作流程

第一次禁言
    ↓
记录: 用户A被操作者B禁言600秒
    ↓
originalOperatorId = B

解除禁言场景:

场景1: 操作者B解除禁言 (allowOperatorUnban = true)
    ↓
清除记录，不恢复

场景2: 操作者C解除禁言 (allowOperatorUnban = true)
    ↓
计算剩余时间(如595秒) → 立即恢复禁言

场景3: 任何人解除禁言 (allowOperatorUnban = false)
    ↓
计算剩余时间 → 立即恢复禁言

其他触发恢复:

用户发言 → 检查记录 → 恢复禁言
用户退群后进群 → 检查记录 → 恢复禁言

## 日志示例

[INFO] 记录禁言: 群 123456, 用户 789012, 时长 600秒, 操作者 111111, 原操作者: 111111
[INFO] 解除禁言事件: 群 123456, 用户 789012, 操作者 222222, 原操作者 111111
[INFO] 解除禁言（非原操作者），剩余 595秒，立即恢复禁言...
[INFO] 执行恢复禁言: 群 123456, 用户 789012, 时长 595秒
[INFO] 恢复禁言成功: 群 123456, 用户 789012, 时长 595秒

## 注意事项

1. **机器人权限**：机器人需要有禁言权限才能恢复禁言
2. **API响应**：即使 set_group_ban 返回 "No data returned"，操作通常已成功执行
3. **时间精度**：禁言时间计算存在几秒误差，属于正常情况
4. **重启恢复**：插件重启后会加载之前的禁言记录

## 更新日志

### v1.0.0
- 初始版本发布
- 支持禁言记录和自动恢复
- 支持退群/进群追踪
- 支持发言触发恢复
- 支持原操作者判断配置

## 👤 作者

**星陨** (XingYunStar)

- GitHub: [@XingYunStar](https://github.com/XingYunStar)

## 许可证

MIT License

---

### 插件 ID
```
napcat-plugin-mute-recover
```

### 支持的 NapCat 版本
- NapCat v4.14.0 及以上

### 依赖的 API

插件使用以下 NapCat API 实现功能：

| API 名称 | 用途 | 调用时机 |
|----------|------|----------|
| `get_group_member_info` | 获取群成员当前禁言状态 | 检查用户是否已被禁言 |
| `set_group_ban` | 执行禁言操作 | 恢复禁言时调用 |

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## ⭐ Star

如果这个插件对你有帮助，欢迎给个 Star ⭐
