# 管理员简短登录账号

管理员可使用 `admin` 登录；记录员继续使用原邮箱格式账号。登录框不再强制邮箱格式，后台仅接受 `admin` 或有效邮箱。账号前后空格及英文大小写统一处理，密码校验、登录限流和权限规则保持原样。

新安装的默认管理员账号为 `admin`。为兼容现有部署，配置变量仍叫 `ADMIN_EMAIL`，填 `admin` 即可；该配置仅用于空库初始化，不会重命名已有账号。

## 将已有默认管理员改为 admin

先部署支持 `admin` 登录的新版本，备份并验证现有数据库，再使用 Node.js 24 执行：

```bash
node --env-file=/path/to/app.env scripts/rename-admin.mjs admin@tongbanji.local
```

脚本仅支持唯一、固定 ID 为 `administrator` 的原始管理员，以及关联完整的班级和管理员成员。它在同一事务中将 `accounts.email` 和 `members.email` 改为 `admin`，保留密码、ID、角色、会话、学生、公约和积分记录。目标冲突或关联异常时拒绝执行，失败自动回滚，成功后可安全重跑。

迁移后以 `admin` 和原密码登录，原邮箱账号不再用于登录。可同步将服务器 `ADMIN_EMAIL` 设置为 `admin`，其余环境配置保持不变。
