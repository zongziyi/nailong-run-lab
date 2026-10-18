# 启用共享排行榜：阿里云 uniCloud

已选择的服务空间是 `mp-6e5e447f-183a-4a77-9646-2a9e9f68753d`，数据库结构、索引与 `nailong-leaderboard` 云函数已部署。控制台实际 HTTPS 地址已写入 `src/leaderboard-config.js`：

```text
https://fc-mp-6e5e447f-183a-4a77-9646-2a9e9f68753d.next.bspapp.com/nailong-leaderboard
```

更换空间时，Space ID 不能代替云函数 HTTP 地址；需部署后从新空间的控制台复制实际地址。

游戏继续放在 GitHub Pages。排行榜通过一个 uniCloud HTTP 云函数保存和读取共享数据；玩家不需要安装 HBuilderX，也不需要注册 DCloud 账号。HBuilderX 仅供开发者部署使用。这个方案不依赖 Supabase；国内实际可用性仍要用不经过代理的网络验收。GitHub Pages 的访问情况需要与排行榜接口分别检查。

## 1. 安装并登录 HBuilderX

从 [DCloud 官方下载页](https://dcloud.net.cn/hbuilderx.html) 下载 Windows 正式版的标准版 ZIP，解压到固定目录，运行 `HBuilderX.exe`。标准版即可；本游戏不需要 App 打包插件。使用创建该服务空间的同一个 DCloud 账号登录，密码只在软件里输入。

在 HBuilderX 新建一个空白 uni-app 项目作为云资源部署项目，取得该项目的 DCloud AppID；将本仓库 `uniCloud-aliyun` 内的 `cloudfunctions` 和 `database` 两个目录复制到该项目的阿里云目录。右键云目录选择 **关联云服务空间或项目**，选择阿里云，并核对上面的完整 Space ID。部署项目只用来上传云资源，游戏仍使用本仓库的网页。

本次已创建并关联的部署项目是 `D:\codex\奶龙快跑\.cache\nailong-cloud-deploy\nailong-cloud-deploy`，HBuilderX 中名称为 `nailong-cloud-deploy`。网页根目录直接关联曾返回“参数不正确”，改用该部署项目后关联成功。标准版若缺少 uniCloud 插件，先安装官方 `unicloud` 插件。以后更新云函数，先将仓库内的最新云资源复制到部署项目，再上传；不要仅改动缓存目录后忘记保留源码。

不要将其他空间的旧数据库初始化数据导入本空间。关联空间的操作依据见 [官方服务空间说明](https://doc.dcloud.net.cn/uniCloud/concepts/space.html)。

## 2. 上传数据库与云函数

部署文件均在 `uniCloud-aliyun/`：

| 文件 | 用途 |
| --- | --- |
| `database/nailong-players.schema.json` | 玩家、昵称和两个模式的最高纪录；禁止客户端直接读写集合 |
| `database/nailong-players.index.json` | 两个榜的米数、达到时间及公开编号排序索引 |
| `cloudfunctions/nailong-leaderboard/index.js` | 身份创建、昵称、最高分、分页及本人名次 |
| `cloudfunctions/nailong-leaderboard/package.json` | 256MB 内存、15 秒超时、HTTP 路径 `/nailong-leaderboard` |

在部署项目的 `database` 目录右键选择 **初始化云数据库**，或使用云服务空间初始化向导，只选择本项目的数据库结构、索引和云函数。仅上传 Schema 不等于已同步索引。没有初始化成绩文件，不需要清空或覆盖已有数据。若索引没有同步，在 uniCloud 控制台的 `nailong-players` 集合中手动建立以下两个普通、非唯一的复合索引：

1. `best_1.distance` 降序、`best_1.at` 升序、`player_code` 升序。
2. `best_3.distance` 降序、`best_3.at` 升序、`player_code` 升序。

右键 `cloudfunctions/nailong-leaderboard`，选择上传部署云函数。函数没有第三方 npm 依赖，使用平台提供的数据库 SDK 和 Node.js 内置加密库；运行环境需支持 Node.js 16 或更高版本。看到部署成功后再继续，不能以本地运行成功替代云端部署。

## 3. 获取真实 HTTP 地址

打开 [uniCloud 控制台](https://unicloud.dcloud.net.cn/)，进入该阿里云空间，在 **云函数 → nailong-leaderboard → 详情** 检查 HTTP 访问路径为 `/nailong-leaderboard`，复制控制台显示的完整 HTTPS 访问地址。不要根据 Space ID 自己拼域名。[官方 HTTP 配置说明](https://doc.dcloud.net.cn/uniCloud/http.html)

默认域名可先用于体验和测试。浏览器直接打开接口可能触发下载或得到“请使用 POST 请求”；接口应通过网页的 JSON 请求检查。长期使用自定义域名时，按官方要求完成阿里云接入备案与 HTTPS 配置；默认域名的实际跨域行为必须在线验证。

云函数已允许以下网页来源：

- `https://zongziyi.github.io`（GitHub Pages 项目路径不属于 Origin）
- `http://127.0.0.1:4173`
- `http://localhost:4173`
- `http://127.0.0.1:4188` 与 `http://localhost:4188`（当前另一个本地试玩端口）

更换网页域名时，修改云函数顶部的 `ORIGINS` 并重新部署。该白名单限制浏览器跨域，不是防作弊或管理员认证；不要开放集合的客户端读写权限。

## 4. 填写网页配置并发布

本地联调：只将拿到的完整 HTTPS 地址填入 `src/leaderboard-config.js` 的 `endpoint`，保留 `provider: 'unicloud'` 和当前 Space ID，然后沿用 `npm start` 或“启动试玩”。**HTTP 接口地址可公开，不需要把 clientSecret、数据库密码、管理令牌放进网页。**

GitHub 仓库 **Settings → Secrets and variables → Actions → Variables** 可以设置：

| 名称 | 值 |
| --- | --- |
| `UNICLOUD_SPACE_ID` | `mp-6e5e447f-183a-4a77-9646-2a9e9f68753d` |
| `UNICLOUD_ENDPOINT` | 控制台复制的完整 HTTPS 云函数地址 |

构建优先使用非空的 `UNICLOUD_ENDPOINT`；未设置时保留源码配置。原 Supabase 变量若已填写，应清空，避免误用备用后端。修改 Variables 后需重新运行 **Deploy game to GitHub Pages**；变量变化本身不会触发部署。

发布后入口仍是 [奶龙快跑](https://zongziyi.github.io/nailong-run-lab/)。云函数代码、数据库结构和开发工具不会包含在网页发布包中。配置为空时仍显示“排行榜尚未启用”；昵称可以暂存为本地草稿，暂存不代表上榜，未配置期间的游戏成绩不会自动补录。

## 5. 云端验收

1. 先在本机关闭代理，用普通窗口与另一浏览器或无痕窗口打开同一游戏地址；手机也用实际移动网络检查。
2. 两个窗口分别正常跑完一局，保存不同昵称；双方刷新后应看到同一份榜单，自己的纪录有“我”的标记。保存相同昵称也不能互相覆盖。
3. 同一身份提交更低或相同成绩，最高米数和达到时间不变；切换一条命、三条命，确认两个榜独立。
4. 刷新正常窗口，身份和纪录仍在；修改昵称后仍保留原纪录。
5. 已命名玩家断网后正常结算，显示待同步；重新联网或打开排行榜后成功同步。快速重开时，上一局提交不能丢掉新局更高的待同步成绩。
6. 分别检查电脑、窄屏和键盘操作：三个入口、模式切换、刷新、加载更多、Escape 关闭、关闭后焦点恢复，以及游戏原有跳跃、滑铲与暂停。

本地自动测试不代表已完成以上云端和浏览器验收。当前的检查记录见 `artifacts/VALIDATION-leaderboard.md`。

## 计费、身份与维护

阿里云开发者免费版适合先联调。**云函数有小时级最低消耗：某小时有调用，最低消耗 90GBs**，因此 1000GBs 不能理解为可以全天候持续调用；只按这个最低量估算约为 11 个发生调用的小时，实际还受请求数、数据库读写、出网流量等额度影响。已将排行与身份操作集中在一个函数中，未设置定时任务或自动轮询。具体额度、停服和付费规则以 [官方计费说明](https://doc.dcloud.net.cn/uniCloud/price.html) 及空间控制台为准。

发生额度用尽、欠费或平台异常时，先查看空间状态、用量和函数日志，按控制台提示恢复资源，再刷新排行榜。故障不阻止游戏；已配置期间的最高待同步成绩留在当前浏览器，成功后才清除。无需为了试用先开启超额扣费。

每位玩家使用服务器生成的随机令牌，令牌保存在自己的浏览器；数据库仅保存其 SHA-256 摘要。公开编号和昵称均不能作为修改他人成绩的凭据。清除浏览器数据、换设备或使用新的无痕窗口会成为新玩家；丢失的身份不会把待同步纪录转交给其他身份。不要分享自己的浏览器身份令牌。

昵称 1–16 个字，允许重名、支持修改，界面按纯文字显示。正常生命耗尽时取整米数；金币和中途重开不计入。相同米数并列，例如 1、1、3；先成功写入该最高分者显示在前，离线成绩按成功同步的时间计算。最高纪录通过数据库事务更新，低分、相同分数和重复请求不会降低纪录。这是朋友娱乐用途的基础校验，客户端伪造成绩仍可能发生。

备用 Supabase 方案保留在 [单独说明](leaderboard-supabase.md)，两个后端的数据与身份独立，不会自动迁移。
