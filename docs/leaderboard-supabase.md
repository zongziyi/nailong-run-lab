# 备用方案：Supabase 排行榜

本项目当前默认使用阿里云 uniCloud，见 [主要配置说明](leaderboard-setup.md)。下面保留原 Supabase 方案；两种后端的身份和数据独立，不会自动迁移。在本地使用此方案时，将 `src/leaderboard-config.js` 的 `provider` 设为 `supabase`，填写 `url` 与 `publishableKey`；在线构建可使用下述 Supabase 变量，并清空 `UNICLOUD_ENDPOINT`。

排行榜代码与建表 SQL 已包含在项目中。完成下面的云端配置后，玩家才能看到同一份真实榜单。没有配置时会显示“排行榜尚未启用”，游戏仍能正常游玩；昵称输入框可用，点击“暂存昵称”会只保存在当前浏览器，不代表已经上榜。启用云端后，再点击“保存昵称”即可参与排行。

## 1. 创建免费项目

打开 [Supabase 控制台](https://supabase.com/dashboard)，注册或登录，创建一个 **Free** 项目。地区优先选择靠近玩家的亚洲地区。数据库密码仅用于项目管理，不要填进网页或发到聊天中。

在项目的 Authentication 设置中开启 **Anonymous Sign-Ins（匿名登录）**。玩家无需填写邮箱或密码。保留服务默认的匿名登录限流；若学校或同一 Wi-Fi 下短时间有多人首次参与，可能遇到限流，稍后再试即可。朋友娱乐版未加入验证码；公开大量推广时可再配置 Supabase 支持的 CAPTCHA。

## 2. 安装数据库结构

打开项目的 **SQL Editor → New query**，复制本仓库 `supabase/leaderboard.sql` 的全部内容，点击 Run。脚本使用事务，可以重复执行；只安装本游戏专用的表和函数。

数据库根据匿名会话识别玩家，不使用昵称作身份。公开查询只返回昵称、公开玩家编号、米数和排名；写入函数从认证会话取玩家身份，普通浏览器不能直接修改底表。

## 3. 配置 GitHub Pages

在 Supabase 项目的 **Connect** 或 **Settings → API Keys** 找到：

- Project URL：形如 `https://你的项目.supabase.co`。
- Publishable key：以 `sb_publishable_` 开头。这是允许放在浏览器中的公开密钥。

在 GitHub 仓库的 **Settings → Secrets and variables → Actions → Variables** 创建两个 Repository variables：

| 名称 | 值 |
| --- | --- |
| `SUPABASE_URL` | 项目的 HTTPS 地址 |
| `SUPABASE_PUBLISHABLE_KEY` | 以 `sb_publishable_` 开头的公开密钥 |

不要填写 `sb_secret_`、`service_role` 或数据库密码。构建会拒绝错误的密钥格式。变量会被写入公开网页，因此它们不是服务端秘密。

提交代码并发布后，在仓库 **Actions** 重新运行 **Deploy game to GitHub Pages**；仅修改 Variables 不会自动触发部署。游戏地址仍为 [现有试玩链接](https://zongziyi.github.io/nailong-run-lab/)。

本地联调：在 `src/leaderboard-config.js` 中填入同样的两个公开值，运行 `npm ci`、`npm start`。未填写时本地只检查未启用状态。线上构建优先使用 Actions 的两个变量；若变量为空，使用该配置文件的值。填写其中一个而漏掉另一个会使构建失败。

## 4. 确认真的共享

1. 用两个独立浏览器（或普通窗口与无痕窗口）打开同一个游戏链接。
2. 各跑完一局，点击结算页“查看排行榜 / 设置昵称”，填写不同昵称并保存。
3. 双方点击刷新，应看到两个人的真实纪录；自己的纪录有“我”的标记。
4. 同一浏览器再跑一个较低成绩，确认最高纪录不下降；切换生命模式，确认是另一个榜。
5. 刷新页面，确认身份和纪录保留；在浏览器离线时结算，检查暂存提示，恢复连接后确认同步。

未完成这些在线检查前，不能把本地测试结果当成云端已上线的证据。

## 排行规则与身份

- 以正常生命耗尽时的整米数排名，不计算金币；中途重置、退出或刷新不提交当前局。
- 一条命、三条命分榜；每个玩家每种模式最多一条最高纪录。相同米数并列，例如 1、1、3；并列时按服务器首次收到该最高纪录的时间排序。离线暂存的成绩以成功同步的时间为准。
- 昵称 1–16 个字，允许重名，可以修改。昵称按文字显示，不会执行 HTML。公开玩家编号帮助区分同名玩家。
- 首次可直接玩，结算后再设置昵称；关闭排行榜即可暂不参与。设置昵称后，结算自动同步。打开排行榜和恢复网络也会重试暂存成绩。
- 身份和待同步纪录保存在当前浏览器。关闭正常窗口后可继续；清除数据、使用无痕窗口或换设备会成为新玩家。身份丢失时，不会把旧玩家的待同步纪录转交给新身份。浏览器禁用存储时，本次页面仍可参与，但关闭后不能保证恢复。
- 这是朋友娱乐榜，只做身份、模式、数值和数据库权限校验。客户端伪造成绩仍可能发生。没有把历史版本的成绩导入排行榜。

## 暂停、故障与维护

Supabase Free 项目连续一周活跃度低时可能自动暂停。在控制台选择对应项目并点击 **Restore / Resume**，恢复后再刷新排行榜。网络故障、项目暂停或额度限制都不会影响游戏本身；已命名玩家的最高待同步纪录会留在浏览器，成功后才清除。

删除匿名账号会同时删除该玩家的纪录，请勿直接套用批量清理匿名账号的 SQL。免费方案不包含自动备份，重要纪录可由项目管理员定期在控制台导出。

参考：[匿名登录](https://supabase.com/docs/guides/auth/auth-anonymous)、[公开密钥](https://supabase.com/docs/guides/getting-started/api-keys)、[免费方案](https://supabase.com/pricing)、[项目暂停](https://supabase.com/docs/guides/platform/free-project-pausing)。
