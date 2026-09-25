# Linux 独立部署与维护

此说明使用通用路径 `/opt/tongbanji` 和服务名 `tongbanji.service`，不对应特定服务器。部署前按实际路径调整 [服务模板](../deploy/tongbanji.service)。

## 配置

将源码放入独立目录，在该目录准备 Node.js 24 的 `runtime/bin/node`，并使用该 runtime 的 npm 安装依赖、构建。环境配置保存在 `app.env`，权限设为 600，至少包含以下字段；所有示例值均需按实际环境填写。

```dotenv
APP_URL=http://服务器公网IP:18080
ADMIN_EMAIL=admin@tongbanji.local
ADMIN_PASSWORD=请替换为至少10位的随机密码
DATA_DIR=/opt/tongbanji/data
BACKUP_DIR=/opt/tongbanji/backups
HOSTNAME=0.0.0.0
PORT=18080
NODE_ENV=production
NEXT_TELEMETRY_DISABLED=1
```

`APP_URL` 必须与浏览器实际访问地址一致。管理员邮箱是本地登录账号，不需要接收邮件。初始密码仅用于空库首次初始化。不要提交真实 `app.env`、`.env`、数据库或备份。

## 构建与启动

```bash
export PATH=/opt/tongbanji/runtime/bin:$PATH
cd /opt/tongbanji
npm ci
npm run build
```

检查生成的 standalone `server.js` 实际位置；多目录项目可能输出嵌套路径。将 `public`、`drizzle` 复制到实际 `server.js` 同级，将 `.next/static` 复制到其 `.next/static`，并建立该位置的 `.next/cache`。相应调整服务模板的 `WorkingDirectory`、`ExecStart` 和缓存 `ReadWritePaths`。

在基础目录创建 `data/`、`backups/` 和保持为空的 `sandbox-empty/`。确认配置中的路径都存在，再检查并安装服务：

```bash
systemd-analyze verify /opt/tongbanji/deploy/tongbanji.service
systemctl enable --now /opt/tongbanji/deploy/tongbanji.service
systemctl status tongbanji.service --no-pager
curl http://127.0.0.1:18080/api/health
```

先检查已有服务，避免占用其端口；服务器防火墙与云安全组开放该网站所需端口。访问网站登录后创建班级、导入名单。

## 隔离与维护

服务模板将应用代码设为只读，数据、备份和应用缓存可写。空目录覆盖应用进程可见的 `/root`、`/home`、`/run/user`，仅改变应用进程的挂载视图，不改写宿主机原文件。启用后验证服务状态及实际挂载视图。

```bash
journalctl -u tongbanji.service -n 80 --no-pager
systemctl restart tongbanji.service
/opt/tongbanji/runtime/bin/node --env-file=/opt/tongbanji/app.env /opt/tongbanji/scripts/backup.mjs
/opt/tongbanji/runtime/bin/node --env-file=/opt/tongbanji/app.env /opt/tongbanji/scripts/reset-password.mjs '需要重置的账号邮箱'
```

备份脚本使用 SQLite 在线备份接口，保留 WAL 中已提交记录；不要直接复制运行中的单个 `.sqlite` 文件作为完整备份。密码重置会使该账号旧会话失效。

## 更新与回退

更新前做在线备份，保留 `app.env`、`data/`、`backups/`，在新版本目录构建后切换本应用服务。只运行一个使用该端口的服务。

数据库迁移按文件名与摘要校验；新版本应用迁移后，旧版本缺失相应迁移时会拒绝启动。回退应验证程序和迁移兼容性，不能只切换到缺失新迁移的旧运行目录，也不能在有新数据时直接用旧备份覆盖。
