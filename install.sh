#!/usr/bin/env bash
# Claude Relay Service 一键安装脚本 (原生方式, 无 Docker)
# 适用: Ubuntu / Debian / CentOS / RHEL / Rocky / AlmaLinux
# 用法: sudo bash install-native.sh [安装目录] [端口]
#   例: sudo bash install-native.sh /opt/claude-relay 3000

set -euo pipefail

REPO_URL="https://github.com/dipinllx-source/claude-relay-service.git"
INSTALL_DIR="${1:-/opt/claude-relay-service}"
PORT="${2:-3000}"
NODE_MAJOR=20                       # Node 18/20 均可, 20 是当前 LTS
SERVICE_USER="claude-relay"
SERVICE_NAME="claude-relay"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${BLUE}[*]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请使用 root 或 sudo 运行"

# ---------- 0. 交互式配置 ----------
# 通过 /dev/tty 读取, 兼容 `curl | bash` 场景
JWT_SECRET_USER=""; ADMIN_USERNAME_USER=""; ADMIN_PASSWORD_USER=""
if [[ -r /dev/tty && -w /dev/tty ]]; then
  {
    echo
    echo "════════════════════════════════════════════════════════"
    echo "  Claude Relay Service 交互式配置 (回车使用默认/自动生成)"
    echo "════════════════════════════════════════════════════════"
  } >/dev/tty

  # 服务端口
  while :; do
    printf "服务端口 [%s]: " "$PORT" >/dev/tty
    read -r _in </dev/tty || _in=""
    [[ -z $_in ]] && break
    if [[ $_in =~ ^[0-9]+$ ]] && (( _in >= 1 && _in <= 65535 )); then PORT=$_in; break; fi
    echo "  × 端口必须是 1-65535 的整数" >/dev/tty
  done

  # JWT_SECRET
  while :; do
    printf "JWT_SECRET (>=32 字符, 回车自动生成): " >/dev/tty
    read -r _in </dev/tty || _in=""
    if [[ -z $_in ]]; then JWT_SECRET_USER=""; break; fi
    if (( ${#_in} >= 32 )); then JWT_SECRET_USER=$_in; break; fi
    echo "  × JWT_SECRET 至少 32 字符" >/dev/tty
  done

  # 管理员用户名
  printf "管理员用户名 (回车自动生成): " >/dev/tty
  read -r ADMIN_USERNAME_USER </dev/tty || ADMIN_USERNAME_USER=""

  # 管理员密码 + 二次确认
  while :; do
    printf "管理员密码 (>=8 字符, 回车自动生成): " >/dev/tty
    read -rs _pw1 </dev/tty || _pw1=""
    echo >/dev/tty
    if [[ -z $_pw1 ]]; then ADMIN_PASSWORD_USER=""; break; fi
    if (( ${#_pw1} < 8 )); then echo "  × 密码至少 8 字符" >/dev/tty; continue; fi
    printf "再次输入确认密码:                    " >/dev/tty
    read -rs _pw2 </dev/tty || _pw2=""
    echo >/dev/tty
    if [[ $_pw1 == "$_pw2" ]]; then ADMIN_PASSWORD_USER=$_pw1; break; fi
    echo "  × 两次输入不一致, 请重新输入" >/dev/tty
  done
  echo >/dev/tty
else
  warn "非交互式终端, 跳过交互 (将使用默认/随机值)"
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

log "更新软件源"
[[ $PKG == apt ]] && apt-get update -y >/dev/null || true

log "安装基础工具"
pkg_install git curl openssl ca-certificates build-essential 2>/dev/null \
  || pkg_install git curl openssl ca-certificates gcc-c++ make

# ---------- 2. 安装 Node.js ----------
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
  ok "Node $(node -v) / npm $(npm -v)"
fi

# ---------- 3. 安装 Redis ----------
if ! command -v redis-server >/dev/null 2>&1; then
  log "安装 Redis"
  if [[ $PKG == apt ]]; then pkg_install redis-server
  else pkg_install redis || pkg_install redis6 || die "Redis 安装失败,请手动安装"; fi
fi
# 生成 Redis 密码并写入配置
REDIS_PASSWORD=$(openssl rand -hex 16)
REDIS_CONF=""
for f in /etc/redis/redis.conf /etc/redis.conf; do
  [[ -f $f ]] && REDIS_CONF=$f && break
done
if [[ -n "$REDIS_CONF" ]]; then
  log "配置 Redis 密码和持久化 ($REDIS_CONF)"
  cp -n "$REDIS_CONF" "${REDIS_CONF}.bak.$(date +%s)" || true
  sed -i -E "s|^#?\s*requirepass\s+.*|requirepass ${REDIS_PASSWORD}|" "$REDIS_CONF"
  grep -q '^requirepass ' "$REDIS_CONF" || echo "requirepass ${REDIS_PASSWORD}" >> "$REDIS_CONF"
  sed -i -E "s|^#?\s*appendonly\s+.*|appendonly yes|" "$REDIS_CONF"
else
  warn "未找到 redis.conf, 跳过密码配置 (将使用空密码)"
  REDIS_PASSWORD=""
fi
# enable 并重启以应用配置
# 用 `systemctl cat` 探测, 避免 `list-unit-files | grep -q` 被 SIGPIPE 误判
REDIS_SVC=""
for s in redis-server redis redis6; do
  if systemctl cat "${s}.service" >/dev/null 2>&1; then REDIS_SVC=$s; break; fi
done
[[ -n "$REDIS_SVC" ]] || die "未识别到 Redis systemd 服务"
systemctl enable "$REDIS_SVC" 2>/dev/null || true
systemctl restart "$REDIS_SVC"
sleep 1
if [[ -n "$REDIS_PASSWORD" ]]; then
  PONG=$(redis-cli -a "$REDIS_PASSWORD" --no-auth-warning ping 2>/dev/null || true)
  [[ $PONG == PONG ]] \
    && ok "Redis 已运行 (带密码, 服务: $REDIS_SVC)" \
    || warn "Redis 密码校验失败, 请检查 $REDIS_CONF"
else
  PONG=$(redis-cli ping 2>/dev/null || true)
  [[ $PONG == PONG ]] \
    && ok "Redis 已运行 (无密码, 服务: $REDIS_SVC)" \
    || warn "Redis 无法连通"
fi

# ---------- 4. 建立系统用户 ----------
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  log "创建系统用户 $SERVICE_USER"
  useradd --system --home "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER" \
    || useradd -r -d "$INSTALL_DIR" -s /sbin/nologin "$SERVICE_USER"
fi

# ---------- 5. 克隆/更新源码 ----------
if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "目录已存在,拉取最新代码"
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "克隆仓库到 $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

# ---------- 6. 生成 .env 和 config.js ----------
cd "$INSTALL_DIR"
[[ -f config/config.js ]] || cp config/config.example.js config/config.js

if [[ ! -f .env ]]; then
  log "生成 .env"
  JWT_SECRET="${JWT_SECRET_USER:-$(openssl rand -hex 32)}"   # 用户填写 或 64 字符随机
  ENCRYPTION_KEY=$(openssl rand -hex 16)                      # 固定 32 字符, 符合 AES-256
  cat > .env <<EOF
# 由 install-native.sh 自动生成 — $(date -Iseconds)
NODE_ENV=production
HOST=0.0.0.0
PORT=${PORT}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
API_KEY_PREFIX=cr_
REDIS_HOST=127.0.0.1
REDIS_PORT=6379
REDIS_PASSWORD=${REDIS_PASSWORD}
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

# ---------- 7. 安装依赖 & 构建前端 ----------
log "安装后端依赖 (可能需要几分钟)"
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && npm install --omit=dev --no-audit --no-fund"

log "安装并构建前端 SPA"
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && npm run install:web --silent && npm run build:web --silent" \
  || warn "前端构建失败, /admin-next/ 可能无法访问 — 可稍后执行: npm run build:web"

log "运行初始化 (生成管理员凭据 data/init.json)"
sudo -u "$SERVICE_USER" bash -lc "cd '$INSTALL_DIR' && npm run setup" || warn "setup 异常, 首次启动时会重试"

# ---------- 8. 生成 systemd 单元 ----------
log "写入 systemd 服务 $SERVICE_NAME"
cat >/etc/systemd/system/${SERVICE_NAME}.service <<EOF
[Unit]
Description=Claude Relay Service
After=network.target redis-server.service redis.service
Wants=redis-server.service redis.service

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

# ---------- 9. 等待就绪 ----------
log "等待服务就绪 ..."
for i in {1..45}; do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    ok "服务已启动"; break
  fi
  sleep 2
  [[ $i -eq 45 ]] && warn "健康检查超时, 请查看: journalctl -u ${SERVICE_NAME} -e"
done

# ---------- 10. 输出登录信息 ----------
echo
echo "════════════════════════════════════════════════════════"
ok "Claude Relay Service 安装完成 (原生部署)"
echo "════════════════════════════════════════════════════════"
IP=$(curl -fsS --max-time 3 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo "  管理面板:   http://${IP}:${PORT}/admin-next/"
echo "  健康检查:   http://${IP}:${PORT}/health"
echo "  API 端点:   http://${IP}:${PORT}/api"
echo
if [[ -f data/init.json ]]; then
  echo "  管理员凭据 (data/init.json):"
  cat data/init.json | sed 's/^/    /'
else
  warn "首次初始化尚未完成, 请稍候: cat $INSTALL_DIR/data/init.json"
fi
echo
echo "  常用命令:"
echo "    systemctl status ${SERVICE_NAME}      # 状态"
echo "    systemctl restart ${SERVICE_NAME}     # 重启"
echo "    systemctl stop ${SERVICE_NAME}        # 停止"
echo "    journalctl -u ${SERVICE_NAME} -f      # 实时日志"
echo "    tail -f ${INSTALL_DIR}/logs/*.log     # 应用日志"
echo
echo "  升级:"
echo "    cd ${INSTALL_DIR} && sudo -u ${SERVICE_USER} git pull"
echo "    sudo -u ${SERVICE_USER} npm install --omit=dev"
echo "    sudo -u ${SERVICE_USER} npm run build:web"
echo "    systemctl restart ${SERVICE_NAME}"
echo "════════════════════════════════════════════════════════"
