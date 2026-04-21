#!/usr/bin/env bash
# Claude Relay Service 一键安装脚本 (Docker 方式)
# 适用: Ubuntu / Debian / CentOS / RHEL / Rocky / AlmaLinux
# 用法: sudo bash install.sh [安装目录] [端口]
#   例: sudo bash install.sh /opt/claude-relay 3000

set -euo pipefail

REPO_URL="https://github.com/dipinllx-source/claude-relay-service.git"
INSTALL_DIR="${1:-/opt/claude-relay-service}"
PORT="${2:-3000}"

BLUE='\033[0;34m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
log()  { echo -e "${BLUE}[*]${NC} $*"; }
ok()   { echo -e "${GREEN}[✓]${NC} $*"; }
warn() { echo -e "${YELLOW}[!]${NC} $*"; }
die()  { echo -e "${RED}[✗]${NC} $*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "请使用 root 或 sudo 运行"

# ---------- 1. 识别发行版 ----------
if [[ -f /etc/os-release ]]; then
  . /etc/os-release
  OS_ID="${ID:-}"
  OS_FAMILY="${ID_LIKE:-$OS_ID}"
else
  die "无法识别操作系统 (缺少 /etc/os-release)"
fi
log "检测到系统: $OS_ID"

# ---------- 2. 安装基础工具 ----------
install_pkgs() {
  case "$OS_FAMILY" in
    *debian*|*ubuntu*) apt-get update -y && apt-get install -y "$@" ;;
    *rhel*|*centos*|*fedora*) (command -v dnf >/dev/null && dnf install -y "$@") || yum install -y "$@" ;;
    *) die "不支持的发行版: $OS_FAMILY" ;;
  esac
}

log "安装基础依赖 (git/curl/openssl)"
install_pkgs git curl openssl ca-certificates >/dev/null

# ---------- 3. 安装 Docker ----------
if ! command -v docker >/dev/null 2>&1; then
  log "未检测到 Docker,使用官方脚本安装"
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
else
  ok "Docker 已存在: $(docker --version)"
fi

# docker compose 插件检测
if ! docker compose version >/dev/null 2>&1; then
  log "安装 docker compose 插件"
  case "$OS_FAMILY" in
    *debian*|*ubuntu*) apt-get install -y docker-compose-plugin ;;
    *rhel*|*centos*|*fedora*) (command -v dnf >/dev/null && dnf install -y docker-compose-plugin) || yum install -y docker-compose-plugin ;;
  esac
fi
ok "$(docker compose version)"

# ---------- 4. 克隆/更新源码 ----------
if [[ -d "$INSTALL_DIR/.git" ]]; then
  log "目录已存在,拉取最新代码"
  git -C "$INSTALL_DIR" pull --ff-only
else
  log "克隆仓库到 $INSTALL_DIR"
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ---------- 5. 生成 .env ----------
if [[ ! -f .env ]]; then
  log "生成随机密钥并写入 .env"
  JWT_SECRET=$(openssl rand -hex 32)               # 64 字符
  ENCRYPTION_KEY=$(openssl rand -hex 16)           # 固定 32 字符,符合 AES-256 要求
  REDIS_PASSWORD=$(openssl rand -hex 16)

  cat > .env <<EOF
# 由 install.sh 自动生成 — $(date -Iseconds)
BIND_HOST=0.0.0.0
PORT=${PORT}
JWT_SECRET=${JWT_SECRET}
ENCRYPTION_KEY=${ENCRYPTION_KEY}
REDIS_PASSWORD=${REDIS_PASSWORD}
API_KEY_PREFIX=cr_
TIMEZONE_OFFSET=8
LOG_LEVEL=info
TRUST_PROXY=true
ENABLE_CORS=true
EOF
  chmod 600 .env
  ok ".env 已生成 (权限 600)"
else
  warn ".env 已存在,跳过生成"
fi

# ---------- 6. 启动 ----------
mkdir -p logs data redis_data
log "拉取镜像并启动容器 (首次构建可能需要几分钟)"
docker compose up -d --build

# ---------- 7. 等待健康检查 ----------
log "等待服务就绪 ..."
for i in {1..60}; do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then
    ok "服务已启动"; break
  fi
  sleep 2
  [[ $i -eq 60 ]] && warn "健康检查超时,请查看: docker compose logs -f claude-relay"
done

# ---------- 8. 输出登录信息 ----------
echo
echo "════════════════════════════════════════════════════════"
ok "Claude Relay Service 安装完成"
echo "════════════════════════════════════════════════════════"
IP=$(curl -fsS --max-time 3 ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
echo "  管理面板:   http://${IP}:${PORT}/admin-next/"
echo "  健康检查:   http://${IP}:${PORT}/health"
echo "  API 端点:   http://${IP}:${PORT}/api"
echo
if [[ -f data/init.json ]]; then
  echo "  管理员凭据 (来自 data/init.json):"
  cat data/init.json | sed 's/^/    /'
else
  warn "首次初始化尚未完成,凭据稍后写入 data/init.json"
  echo "      可通过  docker compose logs claude-relay | grep -i admin  查看"
fi
echo
echo "  常用命令 (在 $INSTALL_DIR 目录下执行):"
echo "    docker compose logs -f claude-relay   # 查看日志"
echo "    docker compose restart                # 重启"
echo "    docker compose down                   # 停止"
echo "    docker compose pull && docker compose up -d   # 升级"
echo "════════════════════════════════════════════════════════"
