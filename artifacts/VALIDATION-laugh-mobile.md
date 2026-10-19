# iPhone 微信偶发大笑无声：播放路径修正

2026-10-19。

## 依据与边界

用户报告在 iPhone 微信内置浏览器中，大笑有时无声或延迟，金币声仍正常、背景音乐似乎也在播放。

代码中金币使用 AudioContext，大笑却单独调用 HTMLAudioElement.play()。该媒体调用可能等待加载或受播放策略限制；如果开始播放前动作已经结束，原有安全清理会取消请求。这是代码与延迟测试可确认的漏播路径，不等于已经在 iPhone 微信真机复现。

参考：WebKit 的[媒体手势策略说明](https://webkit.org/blog/6784/new-video-policies-for-ios/)；MDN 的 [iOS AudioContext interrupted 恢复说明](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/state)。不以修改浏览器标识或缩小桌面窗口替代真机验证。

## 修改

- 页面加载时主动 fetch 短 WAV，不依赖移动浏览器是否执行媒体 preload。
- 开始/继续/操作手势启用既有金币 AudioContext，解码一次并缓存 AudioBuffer；每次大笑用新的 BufferSourceNode 播放缓存，音量仍为 60%。
- 大笑触发时不再等待 HTML 播放器缓冲、寻址和播放承诺；重复动作不重取资源、不叠加播放，旧结束回调不会停止新一次短笑。
- 同时恢复 `suspended` 和 `interrupted`；后台中断停止正在播放的短笑，恢复后不补播。缓冲、恢复、解码的迟到结果只缓存，不恢复过期动作。
- Web Audio 无法使用或解码失败时，保留后续真实手势触发的媒体回退。背景音乐、音效开关及动作链保持原接口。
- 更新启动脚本、入口模块及音效模块的资源版本参数，降低微信继续使用旧脚本缓存的可能。

## 验证

- 新增 9 项缓冲播放回归，模拟 HTML 播放一直不开始、慢获取、迟到解码、连续触发、旧结束回调、iPhone interrupted、暂停/静音、关闭上下文和解码失败。
- 完整测试 164 / 164，通过；项目检查通过。
- 使用真实浏览器和实际 WAV 的 `laugh-audio-check.html`：缓存就绪、AudioContext 为 running，连续播放 20 次仅 fetch 1 次，HTML 播放器调用为 0，无错误。
- 暂停停止短笑，无等待请求或恢复补播；390 × 844 窗口继续检查同一缓冲路径。截图为 `laugh-buffer-desktop.png`、`laugh-buffer-mobile.png`。
- iPhone 微信真机与实际听感尚需用户复测；桌面浏览器状态、窄屏截图及模拟回归不能证明特定 iOS/微信版本完全无故障。
