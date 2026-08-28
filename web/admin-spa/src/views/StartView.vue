<template>
  <div class="apple-landing start-page">
    <!-- Nav -->
    <nav class="apple-nav" :class="{ 'apple-nav--scrolled': scrolled }">
      <div class="apple-nav__inner">
        <router-link class="apple-nav__brand" to="/">
          <svg
            aria-hidden="true"
            class="apple-nav__logo"
            fill="none"
            viewBox="0 0 512 512"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient
                id="sBg"
                gradientUnits="userSpaceOnUse"
                x1="96"
                x2="416"
                y1="64"
                y2="448"
              >
                <stop stop-color="#1C1C1E" />
                <stop offset="1" stop-color="#0F0F10" />
              </linearGradient>
            </defs>
            <rect fill="url(#sBg)" height="336" rx="80" width="336" x="88" y="88" />
            <path
              d="M214 170C171.03 170 136 205.03 136 248C136 290.97 171.03 326 214 326H251V296H216C189.49 296 168 274.51 168 248C168 221.49 189.49 200 216 200H251V170H214Z"
              fill="#F5F5F7"
            />
            <rect fill="#FFFFFF" height="224" rx="15" width="30" x="240" y="144" />
            <path
              d="M270 170H298C340.97 170 376 205.03 376 248C376 290.97 340.97 326 298 326H270V296H296C322.51 296 344 274.51 344 248C344 221.49 322.51 200 296 200H270V170Z"
              fill="#D1D5DB"
            />
          </svg>
          <span>Relay</span>
        </router-link>
        <div class="apple-nav__links">
          <router-link to="/">首页</router-link>
          <a
            class="apple-nav__dropdown-trigger apple-nav__link--active"
            href="#"
            @click.prevent="toggleDropdown('start')"
            @mouseenter="openDropdown('start')"
          >
            开始使用
            <svg
              aria-hidden="true"
              class="apple-nav__caret"
              :class="{ 'apple-nav__caret--open': activeDropdown === 'start' }"
              viewBox="0 0 10 6"
            >
              <path
                d="M1 1l4 4 4-4"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.4"
              />
            </svg>
          </a>
          <a
            class="apple-nav__dropdown-trigger"
            href="#"
            @click.prevent="toggleDropdown('tutorial')"
            @mouseenter="openDropdown('tutorial')"
          >
            使用教程
            <svg
              aria-hidden="true"
              class="apple-nav__caret"
              :class="{ 'apple-nav__caret--open': activeDropdown === 'tutorial' }"
              viewBox="0 0 10 6"
            >
              <path
                d="M1 1l4 4 4-4"
                fill="none"
                stroke="currentColor"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.4"
              />
            </svg>
          </a>
        </div>
        <div class="apple-nav__cta">
          <router-link to="/login">控制台 →</router-link>
        </div>
      </div>
    </nav>

    <!-- Dropdown panel -->
    <div
      class="dropdown-panel"
      :class="{ 'dropdown-panel--open': activeDropdown === 'tutorial' }"
      @mouseleave="closeDropdown"
    >
      <div class="dropdown-panel__inner">
        <div class="dropdown-panel__section">
          <div class="dropdown-panel__label">使用教程</div>
          <router-link
            v-for="tool in cliTools"
            :key="tool.key"
            class="dropdown-panel__link"
            :to="{ path: '/tutorial', query: { tool: tool.key } }"
            @click="closeDropdown"
          >
            <i :class="tool.icon" />
            <span>{{ tool.name }}</span>
          </router-link>
        </div>
        <div class="dropdown-panel__section dropdown-panel__section--aside">
          <div class="dropdown-panel__label">快捷入口</div>
          <router-link class="dropdown-panel__link" to="/tutorial" @click="closeDropdown">
            <i class="fas fa-book-open" />
            <span>全部教程</span>
          </router-link>
          <router-link class="dropdown-panel__link" to="/api-stats" @click="closeDropdown">
            <i class="fas fa-chart-bar" />
            <span>实时数据</span>
          </router-link>
        </div>
      </div>
    </div>
    <div
      class="dropdown-backdrop"
      :class="{ 'dropdown-backdrop--open': !!activeDropdown }"
      @click="closeDropdown"
    ></div>

    <!-- Start dropdown panel -->
    <div
      class="dropdown-panel"
      :class="{ 'dropdown-panel--open': activeDropdown === 'start' }"
      @mouseleave="closeDropdown"
    >
      <div class="dropdown-panel__inner">
        <div class="dropdown-panel__section">
          <div class="dropdown-panel__label">开始使用</div>
          <router-link class="dropdown-panel__link" to="/start" @click="closeDropdown">
            <i class="fas fa-rocket" />
            <span>快速开始</span>
          </router-link>
          <router-link class="dropdown-panel__link" to="/api-stats" @click="closeDropdown">
            <i class="fas fa-chart-bar" />
            <span>实时数据</span>
          </router-link>
        </div>
      </div>
    </div>

    <!-- Hero -->
    <section class="start-hero">
      <div class="start-hero__inner reveal">
        <p class="start-hero__eyebrow">快速开始</p>
        <h1 class="start-hero__title">几分钟内，接入所有主流 AI。</h1>
        <p class="start-hero__sub">按照以下步骤，在本地完成安装并开始使用 Relay Service。</p>
      </div>
    </section>

    <!-- Steps -->
    <section class="steps">
      <div class="steps__grid">
        <article v-for="(step, idx) in steps" :key="idx" class="step reveal">
          <div class="step__number">{{ idx + 1 }}</div>
          <h3 class="step__title">{{ step.title }}</h3>
          <p class="step__desc">{{ step.desc }}</p>
          <div v-if="step.code" class="step__code">
            <code>{{ step.code }}</code>
          </div>
          <router-link v-if="step.link" class="step__link" :to="step.link.to">
            {{ step.link.text }} ›
          </router-link>
        </article>
      </div>
    </section>

    <!-- Service management -->
    <section class="ops">
      <div class="ops__inner reveal">
        <p class="ops__eyebrow">部署与运维</p>
        <h2 class="ops__title">管理你的服务</h2>
        <p class="ops__sub">
          元数据默认持久化到 SQLite（<code>data/metadata.db</code>），Redis
          仅作缓存与热状态。按部署平台选择对应命令：
        </p>
        <div class="ops__tabs" role="tablist">
          <button
            v-for="p in platforms"
            :key="p.key"
            :aria-selected="activePlatform === p.key"
            class="ops__tab"
            :class="{ 'ops__tab--active': activePlatform === p.key }"
            role="tab"
            type="button"
            @click="activePlatform = p.key"
          >
            <i :class="p.icon" />
            <span>{{ p.label }}</span>
          </button>
        </div>
        <div class="ops__grid">
          <article v-for="cmd in serviceCommands[activePlatform]" :key="cmd.code" class="ops__card">
            <h3 class="ops__card-title">{{ cmd.title }}</h3>
            <p class="ops__card-desc">{{ cmd.desc }}</p>
            <div class="ops__code">
              <code>{{ cmd.code }}</code>
              <button
                :aria-label="copiedCode === cmd.code ? '已复制' : '复制命令'"
                class="ops__copy"
                :class="{ 'ops__copy--copied': copiedCode === cmd.code }"
                :title="copiedCode === cmd.code ? '已复制' : '复制命令'"
                type="button"
                @click="copyCommand(cmd.code)"
              >
                <i :class="copiedCode === cmd.code ? 'fas fa-check' : 'fas fa-copy'" />
              </button>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- Claude Code via GPT -->
    <section class="ops">
      <div class="ops__inner reveal">
        <p class="ops__eyebrow">进阶用法</p>
        <h2 class="ops__title">让 Claude Code 用上 GPT</h2>
        <p class="ops__sub">
          让 Claude Code（Anthropic 协议）由 GPT（OpenAI Chat Completions
          兼容端点）承载推理，无需改客户端。
        </p>
        <ol class="gpt-steps">
          <li>
            控制台 <strong>账号管理 → OpenAI Compatible</strong> 创建账号，填写 baseUrl / apiKey /
            默认模型 /（可选）模型映射。
          </li>
          <li>给要使用的 API Key 勾选 <code>openai</code> 权限。</li>
          <li>把 Claude Code 指向适配前缀：</li>
        </ol>
        <div class="ops__code">
          <code>{{ gptBaseUrlCmd }}</code>
          <button
            :aria-label="copiedCode === gptBaseUrlCmd ? '已复制' : '复制命令'"
            class="ops__copy"
            :class="{ 'ops__copy--copied': copiedCode === gptBaseUrlCmd }"
            :title="copiedCode === gptBaseUrlCmd ? '已复制' : '复制命令'"
            type="button"
            @click="copyCommand(gptBaseUrlCmd)"
          >
            <i :class="copiedCode === gptBaseUrlCmd ? 'fas fa-check' : 'fas fa-copy'" />
          </button>
        </div>
        <p class="gpt-note">
          目标模型解析顺序：请求头 <code>x-target-model</code> → 账号模型映射（支持 * 前缀）→
          默认模型；客户端的 claude-* 名不会透传给上游。
        </p>
      </div>
    </section>

    <!-- CTA -->
    <section class="start-cta">
      <div class="start-cta__inner reveal">
        <h2>准备好了？</h2>
        <p>进入控制台创建 API Key，开始使用。</p>
        <div class="start-cta__buttons">
          <router-link class="btn btn--primary btn--lg" to="/login">进入控制台</router-link>
          <router-link class="btn btn--ghost btn--lg" to="/api-stats">查看实时数据 ›</router-link>
        </div>
      </div>
    </section>

    <footer class="foot">
      <div class="foot__inner">
        <span>Relay Service</span>
        <span class="foot__sep">·</span>
        <span>多平台 AI API 中转</span>
      </div>
    </footer>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { copyText } from '@/utils/tools'

const scrolled = ref(false)
const activeDropdown = ref(null)
const openDropdown = (name) => {
  activeDropdown.value = name
}
const toggleDropdown = (name) => {
  activeDropdown.value = activeDropdown.value === name ? null : name
}
const closeDropdown = () => {
  activeDropdown.value = null
}

const cliTools = [
  { key: 'claude-code', name: 'Claude Code', icon: 'fas fa-robot' },
  { key: 'codex', name: 'Codex', icon: 'fas fa-code' },
  { key: 'gemini-cli', name: 'Gemini CLI', icon: 'fab fa-google' },
  { key: 'droid-cli', name: 'Droid CLI', icon: 'fas fa-terminal' }
]

const steps = [
  {
    title: '获取 API Key',
    desc: '登录管理控制台，在 API Keys 页面创建你的专属 Key（以 cr_ 开头）。',
    link: { to: '/login', text: '前往控制台' }
  },
  {
    title: '获取接入 AI 账户',
    desc: '在控制台添加 Claude、Gemini、OpenAI 等平台的账户凭据，系统将自动管理和调度。',
    link: { to: '/login', text: '管理账户' }
  },
  {
    title: '选择 CLI 工具',
    desc: '支持 Claude Code、Codex、Gemini CLI、Droid CLI 等主流 CLI 工具。',
    link: { to: '/tutorial', text: '查看使用教程' }
  },
  {
    title: '开始对话',
    desc: '一切就绪。你的请求将被智能调度到最佳可用账户。',
    code: 'curl -X POST /api/v1/chat/completions ...'
  }
]

const platforms = [
  { key: 'linux', label: 'Linux', icon: 'fab fa-linux' },
  { key: 'mac', label: 'macOS', icon: 'fab fa-apple' }
]
const activePlatform = ref('linux')

// Claude Code → GPT 适配的客户端配置命令
const gptBaseUrlCmd = 'export ANTHROPIC_BASE_URL=http://<host>:<port>/claude/openai'

// Linux: 跨平台进程管理脚本 scripts/manage.js（PID + nohup）
// macOS: launchd KeepAlive 代理 com.relay-service.app
const serviceCommands = {
  linux: [
    {
      title: '启动',
      desc: '在后台启动服务进程，终端可安全关闭。',
      code: 'npm run service:start:daemon'
    },
    {
      title: '停止',
      desc: '优雅停止服务，超时后自动强制结束。',
      code: 'npm run service:stop'
    },
    {
      title: '重启',
      desc: '停止后重新启动，加载最新配置。',
      code: 'npm run service:restart'
    },
    {
      title: '状态',
      desc: '查看服务运行状态与进程信息。',
      code: 'npm run service:status'
    },
    {
      title: '更新',
      desc: '拉取最新代码 → 安装依赖 → 构建前端 → 自动后台重启。',
      code: 'npm run service:update'
    }
  ],
  mac: [
    {
      title: '启动',
      desc: '加载并启动 launchd 服务（KeepAlive 自动守护）。',
      code: 'launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.relay-service.app.plist'
    },
    {
      title: '停止',
      desc: '卸载 launchd 服务（停止并取消守护）。',
      code: 'launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.relay-service.app.plist'
    },
    {
      title: '重启',
      desc: '原地重启 launchd 服务，加载最新代码。',
      code: 'launchctl kickstart -k gui/$(id -u)/com.relay-service.app'
    },
    {
      title: '状态',
      desc: '查看 launchd 服务状态、PID 与配置。',
      code: 'launchctl print gui/$(id -u)/com.relay-service.app'
    },
    {
      title: '更新',
      desc: '拉取最新代码 → 安装依赖 → 构建前端 → 重启 launchd 服务。',
      code: 'git pull && npm install && npm run install:web && npm run build:web && launchctl kickstart -k gui/$(id -u)/com.relay-service.app'
    }
  ]
}

const copiedCode = ref('')
let copyResetTimer = null
const copyCommand = async (code) => {
  const ok = await copyText(code, '命令已复制')
  if (!ok) {
    return
  }
  copiedCode.value = code
  if (copyResetTimer) {
    clearTimeout(copyResetTimer)
  }
  copyResetTimer = setTimeout(() => {
    copiedCode.value = ''
  }, 1600)
}

let onScroll
let observer

onMounted(() => {
  onScroll = () => {
    scrolled.value = window.scrollY > 8
  }
  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('reveal--in')
          observer.unobserve(entry.target)
        }
      })
    },
    { threshold: 0.12 }
  )
  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))
})

onBeforeUnmount(() => {
  window.removeEventListener('scroll', onScroll)
  observer && observer.disconnect()
  if (copyResetTimer) {
    clearTimeout(copyResetTimer)
  }
})
</script>

<style scoped>
.start-page {
  font-family:
    -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue',
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  background: #fbfbfd;
  color: #1d1d1f;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.015em;
  min-height: 100vh;
}

/* Reveal */
.reveal {
  opacity: 0;
  transform: translateY(30px);
  transition:
    opacity 0.9s cubic-bezier(0.16, 1, 0.3, 1),
    transform 0.9s cubic-bezier(0.16, 1, 0.3, 1);
}
.reveal--in {
  opacity: 1;
  transform: translateY(0);
}

/* Nav */
.apple-nav {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 50;
  height: 48px;
  transition:
    background 0.4s ease,
    backdrop-filter 0.4s ease;
}
.apple-nav--scrolled {
  background: rgba(251, 251, 253, 0.72);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.apple-nav__inner {
  max-width: 1024px;
  margin: 0 auto;
  height: 100%;
  padding: 0 22px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 14px;
}
.apple-nav__brand {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #1d1d1f;
  text-decoration: none;
  font-weight: 600;
}
.apple-nav__logo {
  width: 26px;
  height: 26px;
  display: block;
}
.apple-nav__links {
  display: flex;
  gap: 28px;
}
.apple-nav__links a {
  color: #1d1d1f;
  text-decoration: none;
  opacity: 0.85;
  transition: opacity 0.2s;
}
.apple-nav__links a:hover {
  opacity: 1;
}
.apple-nav__link--active {
  opacity: 1;
  font-weight: 600;
}
.apple-nav__cta a {
  color: #0071e3;
  text-decoration: none;
  font-weight: 500;
}
/* Dropdown trigger */
.apple-nav__dropdown-trigger {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #1d1d1f;
  text-decoration: none;
  opacity: 0.85;
  transition: opacity 0.2s;
  cursor: pointer;
}
.apple-nav__dropdown-trigger:hover {
  opacity: 1;
}
.apple-nav__caret {
  width: 10px;
  height: 6px;
  transition: transform 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  opacity: 0.5;
}
.apple-nav__caret--open {
  transform: rotate(180deg);
}

/* Dropdown panel */
.dropdown-panel {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  z-index: 48;
  background: rgba(251, 251, 253, 0.98);
  backdrop-filter: saturate(180%) blur(40px);
  -webkit-backdrop-filter: saturate(180%) blur(40px);
  border-bottom: 1px solid rgba(0, 0, 0, 0.06);
  transform: scaleY(0);
  transform-origin: top center;
  opacity: 0;
  visibility: hidden;
  will-change: transform, opacity;
  transition:
    transform 0.38s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.28s ease,
    visibility 0s 0.38s;
}
.dropdown-panel--open {
  transform: scaleY(1);
  opacity: 1;
  visibility: visible;
  transition:
    transform 0.42s cubic-bezier(0.32, 0.72, 0, 1),
    opacity 0.22s ease,
    visibility 0s 0s;
}
.dropdown-panel__inner {
  max-width: 980px;
  margin: 0 auto;
  padding: 36px 22px 44px;
  display: flex;
  gap: 60px;
}
.dropdown-panel__section {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 220px;
}
.dropdown-panel__section--aside {
  padding-left: 60px;
  border-left: 1px solid rgba(0, 0, 0, 0.06);
}
.dropdown-panel__label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: #86868b;
  padding: 0 0 12px;
  opacity: 0;
  transform: translateY(6px);
  will-change: transform, opacity;
  transition:
    opacity 0.3s ease,
    transform 0.3s ease;
  transition-delay: 0s;
}
.dropdown-panel--open .dropdown-panel__label {
  opacity: 1;
  transform: translateY(0);
  transition-delay: 0.06s;
}
.dropdown-panel__link {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 0;
  text-decoration: none;
  color: #424245;
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.015em;
  opacity: 0;
  transform: translateY(8px);
  will-change: transform, opacity;
  transition:
    color 0.15s ease,
    opacity 0.35s cubic-bezier(0.32, 0.72, 0, 1),
    transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
  transition-delay: 0s;
}
.dropdown-panel--open .dropdown-panel__link:nth-child(2) {
  transition-delay: 0.05s;
}
.dropdown-panel--open .dropdown-panel__link:nth-child(3) {
  transition-delay: 0.1s;
}
.dropdown-panel--open .dropdown-panel__link:nth-child(4) {
  transition-delay: 0.15s;
}
.dropdown-panel--open .dropdown-panel__link:nth-child(5) {
  transition-delay: 0.2s;
}
.dropdown-panel--open .dropdown-panel__link {
  opacity: 1;
  transform: translateY(0);
}
.dropdown-panel__link:hover {
  color: #0071e3;
}
.dropdown-panel__link i {
  width: 28px;
  font-size: 20px;
  color: #86868b;
  transition: color 0.15s ease;
}
.dropdown-panel__link:hover i {
  color: #0071e3;
}
.dropdown-panel__section--aside .dropdown-panel__link {
  font-size: 17px;
  font-weight: 500;
  color: #6e6e73;
}
.dropdown-panel__section--aside .dropdown-panel__link:hover {
  color: #0071e3;
}
.dropdown-panel__section--aside .dropdown-panel__link i {
  font-size: 16px;
  width: 22px;
}

/* Backdrop */
.dropdown-backdrop {
  position: fixed;
  top: 48px;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 47;
  background: rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  opacity: 0;
  visibility: hidden;
  will-change: opacity;
  transition:
    opacity 0.35s ease,
    visibility 0s 0.35s;
}
.dropdown-backdrop--open {
  opacity: 1;
  visibility: visible;
  transition:
    opacity 0.3s ease,
    visibility 0s 0s;
}

@media (max-width: 720px) {
  .apple-nav__links {
    display: none;
  }
  .dropdown-panel__inner {
    flex-direction: column;
    gap: 24px;
    padding: 24px 22px 32px;
  }
  .dropdown-panel__section--aside {
    padding-left: 0;
    border-left: none;
    border-top: 1px solid rgba(0, 0, 0, 0.06);
    padding-top: 16px;
  }
  .dropdown-panel__link {
    font-size: 20px;
  }
}

/* Hero */
.start-hero {
  padding: 130px 22px 60px;
  text-align: center;
  max-width: 980px;
  margin: 0 auto;
}
.start-hero__eyebrow {
  font-size: 17px;
  font-weight: 500;
  color: #0071e3;
  margin: 0 0 8px;
}
.start-hero__title {
  font-size: clamp(36px, 5vw, 56px);
  font-weight: 700;
  letter-spacing: -0.03em;
  line-height: 1.08;
  margin: 0 0 16px;
  background: linear-gradient(180deg, #1d1d1f 0%, #2d2d33 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.start-hero__sub {
  font-size: 19px;
  color: #6e6e73;
  margin: 0;
}

/* Steps */
.steps {
  max-width: 1100px;
  margin: 0 auto;
  padding: 40px 22px 100px;
}
.steps__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.step {
  background: #fff;
  border-radius: 22px;
  padding: 36px;
  border: 1px solid rgba(0, 0, 0, 0.04);
  transition: transform 0.3s ease;
}
.step:hover {
  transform: translateY(-2px);
}
.step__number {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: #1d1d1f;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  margin-bottom: 16px;
}
.step__title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.02em;
  margin: 0 0 10px;
  color: #1d1d1f;
}
.step__desc {
  font-size: 15px;
  color: #6e6e73;
  line-height: 1.5;
  margin: 0 0 16px;
}
.step__code {
  padding: 12px 16px;
  background: #f5f5f7;
  border-radius: 10px;
  margin-bottom: 12px;
}
.step__code code {
  font-size: 14px;
  color: #1d1d1f;
  font-family: 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
}
.step__link {
  font-size: 15px;
  color: #0071e3;
  text-decoration: none;
  font-weight: 500;
}
.step__link:hover {
  text-decoration: underline;
}
@media (max-width: 720px) {
  .steps__grid {
    grid-template-columns: 1fr;
  }
}

/* Service management */
.ops {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 22px 100px;
}
.ops__eyebrow {
  font-size: 15px;
  font-weight: 600;
  color: #0071e3;
  margin: 0 0 8px;
}
.ops__title {
  font-size: clamp(28px, 4vw, 40px);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: #1d1d1f;
  margin: 0 0 12px;
}
.ops__sub {
  font-size: 17px;
  color: #6e6e73;
  line-height: 1.5;
  margin: 0 0 28px;
  max-width: 720px;
}
.ops__sub code {
  font-family: 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 14px;
  background: #f5f5f7;
  padding: 2px 6px;
  border-radius: 6px;
}
.ops__tabs {
  display: inline-flex;
  gap: 6px;
  padding: 4px;
  background: #f5f5f7;
  border-radius: 12px;
  margin-bottom: 24px;
}
.ops__tab {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  color: #6e6e73;
  font-size: 15px;
  font-weight: 500;
  padding: 8px 18px;
  border-radius: 9px;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease,
    box-shadow 0.2s ease;
}
.ops__tab--active {
  background: #fff;
  color: #1d1d1f;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.ops__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}
.ops__card {
  background: #fff;
  border-radius: 22px;
  padding: 28px;
  border: 1px solid rgba(0, 0, 0, 0.04);
}
.ops__card-title {
  font-size: 19px;
  font-weight: 700;
  color: #1d1d1f;
  margin: 0 0 8px;
}
.ops__card-desc {
  font-size: 15px;
  color: #6e6e73;
  line-height: 1.5;
  margin: 0 0 14px;
}
.ops__code {
  position: relative;
  padding: 12px 48px 12px 16px;
  background: #f5f5f7;
  border-radius: 10px;
}
.ops__code code {
  display: block;
  font-size: 14px;
  color: #1d1d1f;
  font-family: 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.5;
  word-break: break-all;
}
.ops__copy {
  position: absolute;
  top: 8px;
  right: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: rgba(0, 0, 0, 0.05);
  color: #6e6e73;
  font-size: 13px;
  cursor: pointer;
  transition:
    background 0.2s ease,
    color 0.2s ease;
}
.ops__copy:hover {
  background: rgba(0, 0, 0, 0.1);
  color: #1d1d1f;
}
.ops__copy--copied {
  background: #34c759;
  color: #fff;
}
.gpt-steps {
  margin: 0 0 20px;
  padding-left: 22px;
  max-width: 720px;
  color: #1d1d1f;
  font-size: 16px;
  line-height: 1.7;
}
.gpt-steps li {
  margin-bottom: 8px;
}
.gpt-steps code,
.gpt-note code {
  font-family: 'SF Mono', SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 13px;
  background: #f5f5f7;
  padding: 2px 6px;
  border-radius: 6px;
}
.gpt-note {
  margin: 16px 0 0;
  max-width: 720px;
  font-size: 14px;
  color: #6e6e73;
  line-height: 1.6;
}
@media (max-width: 720px) {
  .ops__grid {
    grid-template-columns: 1fr;
  }
}

/* CTA */
.start-cta {
  padding: 100px 22px;
  text-align: center;
  background: linear-gradient(180deg, #fbfbfd 0%, #f5f5f7 100%);
}
.start-cta__inner h2 {
  font-size: clamp(36px, 5vw, 56px);
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0 0 12px;
  line-height: 1.1;
}
.start-cta__inner p {
  font-size: 19px;
  color: #6e6e73;
  margin: 0 0 32px;
}
.start-cta__buttons {
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 12px 22px;
  border-radius: 980px;
  font-size: 17px;
  font-weight: 400;
  text-decoration: none;
  transition: all 0.2s ease;
  cursor: pointer;
  border: none;
}
.btn--primary {
  background: #0071e3;
  color: #fff;
}
.btn--primary:hover {
  background: #0077ed;
  transform: scale(1.02);
}
.btn--ghost {
  background: transparent;
  color: #0071e3;
}
.btn--ghost:hover {
  text-decoration: underline;
}
.btn--lg {
  padding: 14px 28px;
  font-size: 19px;
}

/* Footer */
.foot {
  background: #f5f5f7;
  border-top: 1px solid #d2d2d7;
  padding: 28px 22px;
}
.foot__inner {
  max-width: 1100px;
  margin: 0 auto;
  font-size: 12px;
  color: #6e6e73;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.foot__sep {
  opacity: 0.5;
}
/* ---------- 暗色变体 ----------
 * 本页原无任何暗色规则，深色模式下整页为浅底。仅覆盖表面、文字与边框；
 * .step__number 与 .btn--primary 为刻意的深色/品牌色块，保持不变。
 */
.dark .start-page {
  background: #0b1220;
  color: #f3f4f6;
}
.dark .apple-nav--scrolled {
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.dark .apple-nav__brand,
.dark .apple-nav__links a,
.dark .apple-nav__dropdown-trigger {
  color: #e5e7eb;
}
.dark .dropdown-panel {
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}
.dark .dropdown-panel__label,
.dark .dropdown-panel__link i,
.dark .dropdown-panel__section--aside .dropdown-panel__link {
  color: #9ca3af;
}
.dark .dropdown-panel__section--aside {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}
.dark .start-hero__title {
  background: linear-gradient(180deg, #f9fafb 0%, #d1d5db 100%);
  -webkit-background-clip: text;
  background-clip: text;
}
.dark .start-hero__sub,
.dark .step__desc,
.dark .ops__sub,
.dark .ops__card-desc,
.dark .ops__tab,
.dark .gpt-note,
.dark .start-cta__inner p,
.dark .foot__inner {
  color: #9ca3af;
}
.dark .step,
.dark .ops__card {
  background: #1f2937;
  border: 1px solid rgba(255, 255, 255, 0.08);
}
.dark .step__title,
.dark .ops__title,
.dark .ops__card-title,
.dark .gpt-steps,
.dark .ops__tab--active {
  color: #f3f4f6;
}
.dark .step__code,
.dark .ops__code,
.dark .ops__sub code,
.dark .gpt-note code,
.dark .ops__tabs {
  background: #111827;
}
.dark .step__code code,
.dark .ops__code code {
  color: #e5e7eb;
}
.dark .ops__tab--active {
  background: #1f2937;
}
.dark .ops__copy {
  background: rgba(255, 255, 255, 0.08);
  color: #9ca3af;
}
.dark .ops__copy:hover {
  color: #f3f4f6;
}
.dark .start-cta {
  background: linear-gradient(180deg, #0b1220 0%, #111827 100%);
}
.dark .foot {
  background: #0b1220;
  border-top: 1px solid #374151;
}
</style>
