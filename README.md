# GitHub README Wiki

一个本地 Chrome / Edge 浏览器插件，用 DeepWiki 风格阅读 GitHub 仓库里的 README 和 Markdown 文件。

插件会在 GitHub 仓库页面添加入口按钮，点击后用独立阅读器打开当前仓库文档。阅读器会自动接管 repo 内部链接，例如 `README.md`、`docs/intro.md`、GitHub `blob/tree` 链接和页面锚点，让阅读过程尽量保持在同一个界面里。

## 功能

- DeepWiki 风格的文档阅读界面。
- 支持打开仓库 README、子目录 README、Markdown 文件和普通文本文件。
- GitHub 仓库页面顶部提供图标入口，README 区域提供 `Open README Wiki` 入口。
- repo 内部链接会自动跳转到插件阅读器。
- 无构建步骤，无 npm 依赖，直接加载 unpacked extension。

## 安装

在 `chrome://extensions` 或 `edge://extensions` 开启 Developer mode，点击 `Load unpacked`，选择：

```text
/Users/linn/Desktop/dev/github-readme-wiki
```

修改插件文件后，在扩展管理页点击 reload 并刷新 GitHub 页面。
# ReadWiki
