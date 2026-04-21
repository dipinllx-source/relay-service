#!/usr/bin/env bash
# Relay Service 一键安装脚本 (Node + Redis + systemd)
# 适用: Ubuntu / Debian / CentOS / RHEL / Rocky / AlmaLinux / Alibaba Cloud Linux
# 用法: sudo bash install.sh [安装目录] [端口]
#   例: sudo bash install.sh /opt/relay-service 3000

set -euo pipefail

INSTALL_DIR="${1:-/opt/relay-service}"
PORT="${2:-3000}"
NODE_MAJOR=20
SERVICE_USER="relay-service"
SERVICE_NAME="relay-service"
REPO_URL="https://github.com/dipinllx-source/relay-service.git"

# ---------- 颜色/打印 ----------
BLUE=$'\033[0;34m'; GREEN=$'\033[0;32m'; YELLOW=$'\033[1;33m'; RED=$'\033[0;31m'
CYAN=$'\033[0;36m'; BOLD=$'\033[1m'; DIM=$'\033[2m'; NC=$'\033[0m'
log()  { echo -e "${BLUE}[*]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

# ---------- 启动图标 (取自 favicon.svg 配色: #F5F5F7 / #D1D5DB + 强调蓝) ----------
show_logo() {
  local W=$'\033[38;2;245;245;247m'   # 亮白
  local G=$'\033[38;2;209;213;219m'   # 浅灰
  local A=$'\033[38;2;88;166;255m'    # 强调蓝
  local D=$'\033[38;2;100;100;110m'   # 暗灰
  local R=$'\033[0m'
  printf '\n'
  printf '  %s██████╗ ███████╗██╗      █████╗ ██╗   ██╗%s\n' "$W" "$R"
  printf '  %s██╔══██╗██╔════╝██║     ██╔══██╗╚██╗ ██╔╝%s\n' "$W" "$R"
  printf '  %s██████╔╝█████╗  ██║     ███████║ ╚████╔╝ %s\n' "$W" "$R"
  printf '  %s██╔══██╗██╔══╝  ██║     ██╔══██║  ╚██╔╝  %s\n' "$G" "$R"
  printf '  %s██║  ██║███████╗███████╗██║  ██║   ██║   %s\n' "$G" "$R"
  printf '  %s╚═╝  ╚═╝╚══════╝╚══════╝╚═╝  ╚═╝   ╚═╝   %s\n' "$D" "$R"
  printf '\n  %sRelay Service%s %s·%s %s一键安装向导%s\n\n' "$A$BOLD" "$R" "$DIM" "$R" "$A" "$R"
}

# ---------- 交互菜单 (↑↓ + Enter) ----------
menu() {
  # menu <title> <opt1> <opt2> ...  —— 将选择写入全局 MENU_CHOICE (0-based)
  local title=$1; shift
  local -a options=("$@")
  local n=${#options[@]} sel=0 i key rest
  if [[ ! -r /dev/tty || ! -w /dev/tty ]]; then MENU_CHOICE=0; return; fi

  printf '\n%s%s%s  %s(↑↓ 选择, Enter 确认)%s\n' "$BOLD" "$title" "$NC" "$DIM" "$NC" >/dev/tty
  for ((i=0; i<n; i++)); do
    if (( i==sel )); then printf '  %s▸ %s%s\n' "$CYAN" "${options[$i]}" "$NC" >/dev/tty
    else printf '    %s\n' "${options[$i]}" >/dev/tty; fi
  done
  while :; do
    IFS= read -rsn1 key </dev/tty || key=""
    if [[ $key == $'\e' ]]; then
      IFS= read -rsn2 -t 0.1 rest </dev/tty || rest=""
      # 注意: `(( sel++ ))` 表达式值为 0 时返回退出码 1, 叠加 set -e 会杀脚本,
      # 所以用赋值形式规避
      case $rest in
        '[A') (( sel > 0 )) && sel=$((sel - 1)) || : ;;
        '[B') (( sel < n-1 )) && sel=$((sel + 1)) || : ;;
      esac
    elif [[ -z $key ]]; then
      break
    fi
    printf '\033[%dA' "$n" >/dev/tty
    for ((i=0; i<n; i++)); do
      printf '\r\033[K' >/dev/tty
      if (( i==sel )); then printf '  %s▸ %s%s\n' "$CYAN" "${options[$i]}" "$NC" >/dev/tty
      else printf '    %s\n' "${options[$i]}" >/dev/tty; fi
    done
  done
  MENU_CHOICE=$sel
}

[[ $EUID -eq 0 ]] || die "请使用 root 或 sudo 运行"

show_logo

# ---------- 0. 交互式配置 ----------
ADMIN_USERNAME_USER=""; ADMIN_PASSWORD_USER=""
REDIS_MODE=""
REDIS_HOST_USER=""; REDIS_PORT_USER=""; REDIS_PASSWORD_USER=""

if [[ -r /dev/tty && -w /dev/tty ]]; then
  {
    echo "════════════════════════════════════════════════════════"
    echo "  交互式配置 (回车使用默认 / 自动生成)"
    echo "════════════════════════════════════════════════════════"
  } >/dev/tty

  # 服务端口
  while :; do
    printf '服务端口 [%s]: ' "$PORT" >/dev/tty
    read -r _in </dev/tty || _in=""
    [[ -z $_in ]] && break
    if [[ $_in =~ ^[0-9]+$ ]] && (( _in >= 1 && _in <= 65535 )); then PORT=$_in; break; fi
    echo "  × 端口必须是 1-65535 的整数" >/dev/tty
  done

  # 管理员用户名
  printf '管理员用户名 (回车自动生成): ' >/dev/tty
  read -r ADMIN_USERNAME_USER </dev/tty || ADMIN_USERNAME_USER=""

  # 管理员密码 + 二次确认
  while :; do
    printf '管理员密码 (>=8 字符, 回车自动生成): ' >/dev/tty
    read -rs _pw1 </dev/tty || _pw1=""
    echo >/dev/tty
    if [[ -z $_pw1 ]]; then ADMIN_PASSWORD_USER=""; break; fi
    if (( ${#_pw1} < 8 )); then echo "  × 密码至少 8 字符" >/dev/tty; continue; fi
    printf '再次输入确认密码:                    ' >/dev/tty
    read -rs _pw2 </dev/tty || _pw2=""
    echo >/dev/tty
    if [[ $_pw1 == "$_pw2" ]]; then ADMIN_PASSWORD_USER=$_pw1; break; fi
    echo "  × 两次输入不一致, 请重新输入" >/dev/tty
  done

  # Redis 选择
  menu "选择 Redis 部署方式" "使用已有 Redis 实例" "新启动 Redis 实例 (仅本地访问)"
  if [[ $MENU_CHOICE == 0 ]]; then
    REDIS_MODE=existing
    printf 'Redis 地址 [127.0.0.1]: ' >/dev/tty
    read -r REDIS_HOST_USER </dev/tty || REDIS_HOST_USER=""
    [[ -z $REDIS_HOST_USER ]] && REDIS_HOST_USER=127.0.0.1
    while :; do
      printf 'Redis 端口 [6379]: ' >/dev/tty
      read -r _in </dev/tty || _in=""
      if [[ -z $_in ]]; then REDIS_PORT_USER=6379; break; fi
      if [[ $_in =~ ^[0-9]+$ ]] && (( _in >= 1 && _in <= 65535 )); then REDIS_PORT_USER=$_in; break; fi
      echo "  × 端口必须是 1-65535 的整数" >/dev/tty
    done
    printf 'Redis 密码 (回车表示无密码): ' >/dev/tty
    read -rs REDIS_PASSWORD_USER </dev/tty || REDIS_PASSWORD_USER=""
    echo >/dev/tty
  else
    REDIS_MODE=new
  fi
  echo >/dev/tty
else
  warn "非交互式终端, 使用默认值 (自动选择: 新启动 Redis 实例)"
  REDIS_MODE=new
fi

# ---------- 1. 识别发行版 ----------
. /etc/os-release 2>/dev/null || die "无法识别操作系统"
OS_ID="${ID:-}"; OS_FAMILY="${ID_LIKE:-$OS_ID}"
log "检测到系统: $OS_ID"
case "$OS_FAMILY" in
  *debian*|*ubuntu*) PKG="apt" ;;
  *rhel*|*centos*|*fedora*) PKG=$(command -v dnf >/dev/null && echo dnf || echo yum) ;;
  *) die "不支持的发行版: $OS_FAMILY" ;;
esac

pkg_install() {
  if [[ $PKG == apt ]]; then DEBIAN_FRONTEND=noninteractive apt-get install -y "$@"
  else $PKG install -y "$@"; fi
}

[[ $PKG == apt ]] && { log "更新软件源"; apt-get update -y >/dev/null || true; }
log "安装基础工具"
pkg_install git curl openssl ca-certificates build-essential 2>/dev/null \
  || pkg_install git curl openssl ca-certificates gcc-c++ make

# ---------- 2. Node.js ----------
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  CUR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
  (( CUR >= 18 )) && NEED_NODE=0 && ok "Node 已存在: $(node -v)"
fi
if (( NEED_NODE )); then
  log "安装 Node.js ${NODE_MAJOR}.x (NodeSource)"
  if [[ $PKG == apt ]]; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_MAJOR}.x | bash -
    apt-get install -y nodejs
  else
    curl -fsSL https://rpm.nodesource.com/setup_${NODE_MAJOR}.x | bash -
    $PKG install -y nodejs
  fi
  ok "Node $(node -v)"
fi

# ---------- 3. Redis ----------
# 找一个未被监听的端口 (从 6380 起)
find_free_port() {
  local p=${1:-6380}
  while (: </dev/tcp/127.0.0.1/$p) 2>/dev/null; do ((p++)); done
  echo "$p"
}

setup_redis_new() {
  command -v redis-server >/dev/null 2>&1 || {
    log "安装 Redis"
    if [[ $PKG == apt ]]; then pkg_install redis-server
    else pkg_install redis || pkg_install redis6 || die "Redis 安装失败"; fi
  }
  REDIS_HOST_USER=127.0.0.1
  REDIS_PORT_USER=$(find_free_port 6380)
  REDIS_PASSWORD_USER=$(openssl rand -hex 16)
  log "新建独立 Redis 实例 (127.0.0.1:${REDIS_PORT_USER})"

  local RU=redis
  id redis >/dev/null 2>&1 || RU=nobody

  install -d -m 0755 /etc/relay-redis
  install -d -m 0750 -o "$RU" -g "$RU" /var/lib/relay-redis 2>/dev/null \
    || { install -d -m 0750 /var/lib/relay-redis; chown "$RU" /var/lib/relay-redis; }

  cat >/etc/relay-redis/redis.conf <<EOF
bind 127.0.0.1
protected-mode yes
port ${REDIS_PORT_USER}
requirepass ${REDIS_PASSWORD_USER}
dir /var/lib/relay-redis
appendonly yes
appendfsync everysec
logfile /var/log/relay-redis.log
pidfile /var/run/relay-redis.pid
daemonize no
EOF
  chown "root:${RU}" /etc/relay-redis/redis.conf
  chmod 640 /etc/relay-redis/redis.conf
  : >/var/log/relay-redis.log
  chown "${RU}:${RU}" /var/log/relay-redis.log 2>/dev/null || true

  cat >/etc/systemd/system/relay-redis.service <<EOF
[Unit]
Description=Relay Service dedicated Redis instance
After=network.target

[Service]
Type=simple
User=${RU}
Group=${RU}
ExecStart=/usr/bin/redis-server /etc/relay-redis/redis.conf
Restart=on-failure
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now relay-redis
  sleep 2
  local PONG
  PONG=$(redis-cli -h 127.0.0.1 -p "$REDIS_PORT_USER" -a "$REDIS_PASSWORD_USER" --no-auth-warning ping 2>/dev/null || true)
  [[ $PONG == PONG ]] \
    && ok "Relay Redis 就绪 (127.0.0.1:${REDIS_PORT_USER})" \
    || die "Relay Redis 启动失败, 查看: journalctl -u relay-redis -e"
}

setup_redis_existing() {
  log "连接已有 Redis (${REDIS_HOST_USER}:${REDIS_PORT_USER})"
  command -v redis-cli >/dev/null 2>&1 || pkg_install redis-tools 2>/dev/null || pkg_install redis 2>/dev/null || true
  local -a args=(-h "$REDIS_HOST_USER" -p "$REDIS_PORT_USER")
  [[ -n $REDIS_PASSWORD_USER ]] && args+=(-a "$REDIS_PASSWORD_USER" --no-auth-warning)
  local PONG
  PONG=$(redis-cli "${args[@]}" ping 2>/dev/null || true)
  [[ $PONG == PONG ]] || die "无法连接 Redis, 请检查地址/端口/密码"
  ok "已有 Redis 连接成功"
}

if [[ $REDIS_MODE == new ]]; then setup_redis_new; else setup_redis_existing; fi

# ---------- 4. 系统用户 + 源码 ----------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  log "创建系统用户 $SERVICE_USER"
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" \
    || useradd -r -d "$INSTALL_DIR" -s /sbin/nologin "$SERVICE_USER"
fi

if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "更新源码"
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "克隆仓库到 $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
[[ -f config/config.js ]] || cp config/config.example.js config/config.js

# ---------- 5. 生成 .env ----------
if [[ ! -f .env ]]; then
  log "生成 .env (JWT_SECRET / ENCRYPTION_KEY 自动生成)"
  JWT_SECRET=$(openssl rand -hex 32)          # 64 字符
  ENCRYPTION_KEY=$(openssl rand -hex 16)       # 固定 32 字符 (AES-256)
  cat > .env <<EOF
# 由 install.sh 自动生成 — $(date -Iseconds)
NODE_ENV=production
HOST=0.0.0.0
PORT=${PORT}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
API_KEY_PREFIX=cr_
REDIS_HOST=${REDIS_HOST_USER}
REDIS_PORT=${REDIS_PORT_USER}
REDIS_PASSWORD=${REDIS_PASSWORD_USER}
REDIS_DB=0
TIMEZONE_OFFSET=8
LOG_LEVEL=info
TRUST_PROXY=true
ENABLE_CORS=true
EOF
  [[ -n $ADMIN_USERNAME_USER ]] && echo "ADMIN_USERNAME=${ADMIN_USERNAME_USER}" >> .env
  [[ -n $ADMIN_PASSWORD_USER ]] && echo "ADMIN_PASSWORD=${ADMIN_PASSWORD_USER}" >> .env
  chmod 600 .env
else
  warn ".env 已存在, 跳过生成 (交互输入被忽略)"
fi

mkdir -p logs data temp
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

# ---------- 6. 依赖 + 前端构建 + 管理员初始化 ----------
log "安装后端依赖 (可能需要几分钟)"
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && npm install --omit=dev --no-audit --no-fund"
log "安装并构建前端 SPA"
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && npm run install:web --silent && npm run build:web --silent" \
  || die "前端构建失败 — /admin-next/ 需要 dist 才能工作。修复后重跑 npm run build:web 再继续。"

# build 必须产出 dist/index.html, 否则服务启动时会 skip /admin-next 路由
[[ -f "${INSTALL_DIR}/web/admin-spa/dist/index.html" ]] \
  || die "web/admin-spa/dist/index.html 缺失, 前端构建不完整, 中止安装"
log "运行 setup 初始化管理员凭据"
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && npm run setup" || warn "setup 异常, 首次启动时会重试"

# ---------- 7. systemd 单元 ----------
log "写入 systemd 服务 ${SERVICE_NAME}"
cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Relay Service
After=network.target relay-redis.service redis-server.service redis.service
Wants=relay-redis.service

[Service]
Type=simple
User=${SERVICE_USER}
Group=${SERVICE_USER}
WorkingDirectory=${INSTALL_DIR}
EnvironmentFile=${INSTALL_DIR}/.env
ExecStart=/usr/bin/node ${INSTALL_DIR}/src/app.js
Restart=always
RestartSec=5
StandardOutput=append:${INSTALL_DIR}/logs/stdout.log
StandardError=append:${INSTALL_DIR}/logs/stderr.log
LimitNOFILE=65535

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now ${SERVICE_NAME}

# ---------- 8. 等待就绪 (5 分钟倒计时) ----------
wait_for_service() {
  local timeout=300 start=$SECONDS elapsed remain
  while :; do
    elapsed=$(( SECONDS - start ))
    if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
      printf '\r\033[K'
      ok "服务已启动 (用时 $((elapsed/60))分$((elapsed%60))秒)"
      return 0
    fi
    if (( elapsed >= timeout )); then
      printf '\r\033[K'
      warn "健康检查 5 分钟超时; 查看: journalctl -u ${SERVICE_NAME} -e"
      return 1
    fi
    remain=$(( timeout - elapsed ))
    printf '\r\033[K%s[*]%s 等待服务就绪 · 已用 %d:%02d · 剩余 %d:%02d' \
      "$BLUE" "$NC" $((elapsed/60)) $((elapsed%60)) $((remain/60)) $((remain%60))
    sleep 2
  done
}
wait_for_service || true

# ---------- 9. 收尾 ----------
echo
echo "════════════════════════════════════════════════════════"
ok "Relay Service 安装完成"
echo "════════════════════════════════════════════════════════"
IP=$(curl -fsS --max-time 3 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo "  管理面板:   http://${IP}:${PORT}/admin-next/"
echo "  健康检查:   http://${IP}:${PORT}/health"
echo "  API 端点:   http://${IP}:${PORT}/api"
echo "  Redis:     ${REDIS_HOST_USER}:${REDIS_PORT_USER}"
echo
if [[ -f data/init.json ]]; then
  echo "  管理员凭据 (data/init.json):"
  sed 's/^/    /' data/init.json
else
  warn "首次初始化未完成, 请稍候: cat ${INSTALL_DIR}/data/init.json"
fi
echo
echo "  常用命令:"
echo "    systemctl status ${SERVICE_NAME}      # 状态"
echo "    systemctl restart ${SERVICE_NAME}     # 重启"
echo "    systemctl stop ${SERVICE_NAME}        # 停止"
echo "    journalctl -u ${SERVICE_NAME} -f      # 实时日志"
echo "    tail -f ${INSTALL_DIR}/logs/*.log     # 应用日志"
if [[ $REDIS_MODE == new ]]; then
  echo
  echo "  专用 Redis 实例:"
  echo "    systemctl status relay-redis"
  echo "    journalctl -u relay-redis -f"
  echo "    /etc/relay-redis/redis.conf"
fi
echo
echo "  升级:"
echo "    cd ${INSTALL_DIR} && sudo -u ${SERVICE_USER} git pull"
echo "    sudo -u ${SERVICE_USER} npm install --omit=dev"
echo "    sudo -u ${SERVICE_USER} npm run build:web"
echo "    systemctl restart ${SERVICE_NAME}"
echo "════════════════════════════════════════════════════════"
