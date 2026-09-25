#!/usr/bin/env bash
set -euo pipefail
cd "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
umask 077
if [[ $(id -u) -ne 0 ]]; then echo "请运行 sudo bash deploy.sh。"; exit 1; fi
if ! command -v docker >/dev/null 2>&1 || ! docker compose version >/dev/null 2>&1; then
  echo '请先安装 Docker Engine 和 Compose 插件。'
  echo '运行 cat /etc/os-release 查看系统，再按 README.md 的对应官方说明安装。'
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo '当前账号无法连接 Docker，请启动 Docker，或使用 sudo bash deploy.sh。'
  exit 1
fi
if [[ ! -f .env ]]; then
  read -r -p '服务器公网 IP（例如 123.45.67.89）：' server_ip
  if [[ ! "$server_ip" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then echo '请输入有效 IPv4 地址。'; exit 1; fi
  IFS=. read -r ip1 ip2 ip3 ip4 <<< "$server_ip"
  for octet in "$ip1" "$ip2" "$ip3" "$ip4"; do if (( 10#$octet > 255 )); then echo 'IP 地址无效。'; exit 1; fi; done
  read -r -p '管理员登录账号 [admin@tongbanji.local]：' admin_email
  admin_email=${admin_email:-admin@tongbanji.local}
  if [[ ! "$admin_email" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]; then echo '请使用邮箱格式的登录账号。'; exit 1; fi
  admin_password=$(LC_ALL=C od -An -N16 -tx1 /dev/urandom | tr -d ' \n')
  printf 'APP_URL=http://%s\nADMIN_EMAIL=%s\nADMIN_PASSWORD=%s\n' "$server_ip" "$admin_email" "$admin_password" > .env
  printf '首次管理员账号：%s\n首次管理员密码：%s\n请妥善保存，配置已写入仅当前用户可读的 .env。\n' "$admin_email" "$admin_password"
fi
install -d -o 1000 -g 1000 -m 700 data backups
if [[ -f data/classroom.sqlite ]] && docker compose ps --status running --services | grep -qx app; then
  echo '更新前备份积分数据…'
  docker compose exec -T app node scripts/backup.mjs
fi
docker compose up -d --build --wait --wait-timeout 180
printf '\n网站已启动。访问地址：'
sed -n 's/^APP_URL=//p' .env
printf '查看状态：docker compose ps\n查看日志：docker compose logs --tail=100\n'
