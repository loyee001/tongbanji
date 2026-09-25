# 同班记 · 阿里云部署版

适合一台 Linux 服务器。保留活力拼贴界面、全班加减分、后五名排行榜、撤销和 Excel 导出。由 1–2 名学生记录员统一操作，每名同学从 0 分开始，可出现负分。

快速登记支持多人、多事项，每项独立设置 1–100 次；提交前可修改事项、单次分值、次数、同学与日期。提交结果不确定时锁定原批次重试，避免重复计分。详见 [快速登记说明](docs/quick-entry.md)。

班级公约支持查看、搜索、分类筛选和独立 Excel 导出。管理员可新增、修改、删除及恢复公约；学生记录员可查看、导出并用于登记。修改公约不改变历史积分，详见 [班级公约说明](docs/class-rules.md)。

可选择下方 Docker Compose 部署，或使用 [Node.js + systemd 独立部署](docs/linux-systemd.md)。仓库只包含程序和迁移，不包含任何生产环境凭据或学生数据。

采用 Docker Compose 管理网页服务和反向代理，积分保存在 `data/classroom.sqlite`。不需要另外安装 MySQL、Redis、Node.js，也不需要 ChatGPT 登录。

## 最短部署步骤

1. 服务器安装 Docker Engine 和 Compose 插件。
2. 上传本部署包并解压。
3. 在解压目录执行：

```bash
sudo bash deploy.sh
```

首次运行只需输入服务器公网 IP 和管理员账号。脚本生成随机密码，构建并启动网站。后续更新再次运行同一命令，会先备份运行中的数据库，再更新程序。

阿里云安全组需要允许 TCP 80 端口，随后用 `http://服务器公网IP` 打开。80 端口必须未被其他网站占用；如已有网站，先整合现有反向代理。

首次管理员账号默认 `admin@tongbanji.local`，它只是本地登录账号，不需要真实邮箱或收验证码。密码首次启动时显示，并保存在权限为 600 的 `.env` 中。密码不会进入镜像。

登录后点击“创建我的班级”并粘贴名单，全部积分从 0 开始。管理员在“班级设置 → 学生记录员”中设置最多 2 个账号及各自密码。填写已有账号的新密码会使其旧会话失效。

## 不确定 Linux 系统或 Docker 是否安装

先运行这些只读命令：

```bash
cat /etc/os-release
uname -m
docker --version
docker compose version
```

根据系统使用 Docker 官方安装步骤，不要把 Ubuntu 命令直接用于 Alibaba Cloud Linux：

- [Ubuntu 安装说明](https://docs.docker.com/engine/install/ubuntu/)
- [各 Linux 发行版安装说明](https://docs.docker.com/engine/install/)
- [Compose 插件安装说明](https://docs.docker.com/compose/install/linux/)

Docker 安装好后重新运行 `sudo bash deploy.sh`。构建需要访问 npm 和容器镜像仓库；若服务器拉取超时，需要检查该服务器的仓库网络连接。

## 常用维护命令

以下命令均在部署目录执行。

```bash
# 状态和日志
sudo docker compose ps
sudo docker compose logs --tail=100

# 手动备份，不中断网页使用
sudo docker compose exec -T app node scripts/backup.mjs

# 重启；积分不受影响
sudo docker compose restart

# 重置某个账号密码，并使该账号所有旧会话失效
sudo docker compose exec -T app node scripts/reset-password.mjs admin@tongbanji.local
```

备份放在宿主机 `backups/` 中，使用 SQLite 在线备份接口，可包含 WAL 中尚未合并的已提交记录。请定期复制到另一台机器保存。备份包含账号和积分，仅管理员可读。

**保留 `data/`、`backups/` 和 `.env`。** 更新时覆盖源代码即可，不要删除这些目录。`.env` 中的管理员密码只用于空数据库首次初始化；初始化后修改密码使用上面的重置命令。

运行中的数据库不能直接仅复制 `.sqlite` 文件充当备份。恢复时需停止应用、保留当前数据副本，再用选定的备份恢复整个数据库状态。

## 从 IP 试运行改为域名 HTTPS

先将域名解析到服务器，再编辑 `.env`：

```dotenv
APP_URL=https://你的域名
```

然后执行 `sudo docker compose up -d --force-recreate`。允许 TCP 80 和 443，Caddy 会为可验证的域名申请和续期证书；HTTPS 下登录 Cookie 自动启用 Secure。`APP_URL` 必须和浏览器实际访问地址一致，否则写入请求会被拒绝。

当前 IP 方案使用 HTTP，适合先检查功能；正式录入学生信息前应切换 HTTPS。

## 数据迁移边界

本部署包包含程序和空库迁移结构，**不包含 Sites 在线版里的真实班级数据**。在线版不会因本包而被修改。如果已经在那里录入真实数据，应先单独迁移，再正式切换；Excel 周报不包含完整账号、撤销审计和全部历史，不能作为完整数据库恢复文件。

## 开发及验证

开发使用 Node.js 24。配置 `APP_URL`、`ADMIN_EMAIL`、`ADMIN_PASSWORD` 和可选 `DATA_DIR` 后运行 `npm run dev`。

```bash
npm ci
npm test
npx tsc --noEmit
npm run build
```

`next build` 生成 standalone 输出，Docker 镜像显式包含 `.next/static`、`public`、`drizzle` 和备份脚本。首次运行自动执行带摘要检查的数据库迁移，更新不会重新创建已有表或清空数据。

参考：[Next.js 自托管](https://nextjs.org/docs/app/guides/self-hosting)、[Docker 的 Next.js 部署示例](https://docs.docker.com/guides/nextjs/)、[Node SQLite](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)。
