<template>
  <div class="apple-landing">
    <!-- Sticky translucent nav -->
    <nav class="apple-nav" :class="{ 'apple-nav--scrolled': scrolled }">
      <div class="apple-nav__inner">
        <a class="apple-nav__brand" href="#top">
          <svg
            aria-hidden="true"
            class="apple-nav__logo"
            fill="none"
            viewBox="0 0 512 512"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <linearGradient
                id="relayBg"
                gradientUnits="userSpaceOnUse"
                x1="96"
                x2="416"
                y1="64"
                y2="448"
              >
                <stop stop-color="#1C1C1E" />
                <stop offset="1" stop-color="#0F0F10" />
              </linearGradient>
              <linearGradient
                id="relayGloss"
                gradientUnits="userSpaceOnUse"
                x1="128"
                x2="384"
                y1="96"
                y2="416"
              >
                <stop stop-color="white" stop-opacity="0.16" />
                <stop offset="1" stop-color="white" stop-opacity="0.02" />
              </linearGradient>
            </defs>
            <rect fill="url(#relayBg)" height="336" rx="80" width="336" x="88" y="88" />
            <rect
              height="334"
              rx="79"
              stroke="white"
              stroke-opacity="0.08"
              stroke-width="2"
              width="334"
              x="89"
              y="89"
            />
            <path
              d="M214 170C171.03 170 136 205.03 136 248C136 290.97 171.03 326 214 326H251V296H216C189.49 296 168 274.51 168 248C168 221.49 189.49 200 216 200H251V170H214Z"
              fill="#F5F5F7"
            />
            <rect fill="#FFFFFF" height="224" rx="15" width="30" x="240" y="144" />
            <path
              d="M270 170H298C340.97 170 376 205.03 376 248C376 290.97 340.97 326 298 326H270V296H296C322.51 296 344 274.51 344 248C344 221.49 322.51 200 296 200H270V170Z"
              fill="#D1D5DB"
            />
            <path
              d="M126 136C126 124.954 134.954 116 146 116H366C377.046 116 386 124.954 386 136V142C386 130.954 377.046 122 366 122H146C134.954 122 126 130.954 126 142V136Z"
              fill="url(#relayGloss)"
            />
            <rect fill="white" fill-opacity="0.10" height="190" rx="7" width="14" x="248" y="158" />
          </svg>
          <span>Relay</span>
        </a>
        <div class="apple-nav__links">
          <a href="#top">首页</a>
          <a
            class="apple-nav__dropdown-trigger"
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

    <!-- Full-width dropdown panel (Apple-style) -->
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
    <section id="top" class="hero">
      <div class="hero__inner reveal">
        <p class="hero__eyebrow">Relay Service</p>
        <h1 class="hero__title">一个简易模型中转服务</h1>
        <p class="hero__sub">
          统一调度 Claude、Gemini、OpenAI、Bedrock、Azure 与更多平台。<br />
          为个人打造的全方面、可观测的 AI API 中转。
        </p>
        <div class="hero__visual">
          <div class="orb orb--a"></div>
          <div class="orb orb--b"></div>
          <div class="orb orb--c"></div>

          <!-- Cloud → Relay → MacBook illustration -->
          <svg class="hero__illust" viewBox="0 0 640 520" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="cloudGrad" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stop-color="#e3e9f2" />
                <stop offset="1" stop-color="#d1d9e7" />
              </linearGradient>
              <linearGradient id="relayGrad" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0" stop-color="#0a84ff" />
                <stop offset="1" stop-color="#0071e3" />
              </linearGradient>
              <linearGradient id="macScreenGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stop-color="#1d1d1f" />
                <stop offset="1" stop-color="#2d2d33" />
              </linearGradient>
              <linearGradient id="macBodyGrad" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0" stop-color="#d8d8dd" />
                <stop offset="1" stop-color="#a8a8af" />
              </linearGradient>
              <filter id="softShadow" height="140%" width="140%" x="-20%" y="-20%">
                <feGaussianBlur stdDeviation="8" />
              </filter>
            </defs>

            <!-- 1) Cloud area with 4 provider chips -->
            <g class="hero__cloud">
              <!-- Cloud backdrop shape -->
              <path
                d="M155 80 Q125 80 115 110 Q80 120 80 150 Q80 185 118 185 L500 185 Q530 185 530 160 Q530 135 510 128 Q510 95 475 90 Q465 65 430 65 Q400 65 390 88 Q375 70 355 75 Q340 50 305 50 Q270 50 258 78 Q240 65 215 72 Q185 60 155 80 Z"
                fill="url(#cloudGrad)"
                opacity="0.9"
              />
              <!-- Provider chips floating on cloud -->
              <g transform="translate(165 105)">
                <rect fill="#d97757" height="54" rx="13" width="54" />
                <text
                  fill="#fff"
                  font-family="'SF Pro Display',-apple-system,sans-serif"
                  font-size="22"
                  font-weight="700"
                  text-anchor="middle"
                  x="27"
                  y="36"
                >
                  C
                </text>
              </g>
              <g transform="translate(240 90)">
                <rect fill="#10a37f" height="54" rx="13" width="54" />
                <text
                  fill="#fff"
                  font-family="'SF Pro Display',-apple-system,sans-serif"
                  font-size="22"
                  font-weight="700"
                  text-anchor="middle"
                  x="27"
                  y="36"
                >
                  O
                </text>
              </g>
              <g transform="translate(320 98)">
                <rect fill="#4285f4" height="54" rx="13" width="54" />
                <text
                  fill="#fff"
                  font-family="'SF Pro Display',-apple-system,sans-serif"
                  font-size="22"
                  font-weight="700"
                  text-anchor="middle"
                  x="27"
                  y="36"
                >
                  G
                </text>
              </g>
              <g transform="translate(398 108)">
                <rect fill="#ff9900" height="54" rx="13" width="54" />
                <text
                  fill="#fff"
                  font-family="'SF Pro Display',-apple-system,sans-serif"
                  font-size="22"
                  font-weight="700"
                  text-anchor="middle"
                  x="27"
                  y="36"
                >
                  B
                </text>
              </g>
            </g>

            <!-- 2) Connection lines cloud → relay (animated flow) -->
            <g class="hero__flow" fill="none" opacity="0.35" stroke="#0071e3" stroke-width="2">
              <path d="M195 155 Q200 200 260 240" stroke-dasharray="5 5" />
              <path d="M270 155 Q275 195 305 235" stroke-dasharray="5 5" />
              <path d="M350 155 Q340 195 325 235" stroke-dasharray="5 5" />
              <path d="M425 155 Q420 200 365 240" stroke-dasharray="5 5" />
            </g>

            <!-- 3) Relay service (central gateway) -->
            <g class="hero__relay" transform="translate(210 230)">
              <rect fill="url(#relayGrad)" height="80" rx="18" width="220" />
              <rect
                fill="none"
                height="72"
                rx="14"
                stroke="#ffffff"
                stroke-opacity="0.2"
                stroke-width="1"
                width="212"
                x="4"
                y="4"
              />
              <!-- Relay icon (transit) -->
              <g fill="#fff" transform="translate(20 20)">
                <circle cx="20" cy="20" fill="rgba(255,255,255,0.18)" r="18" />
                <path
                  d="M10 20h12l-3-3m0 6l3-3M30 15v10"
                  fill="none"
                  stroke="#fff"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                />
              </g>
              <text
                fill="#fff"
                font-family="'SF Pro Display',-apple-system,sans-serif"
                font-size="16"
                font-weight="600"
                x="80"
                y="38"
              >
                Relay Service
              </text>
              <text
                fill="#ffffff"
                font-family="'SF Pro Text',-apple-system,sans-serif"
                font-size="11"
                opacity="0.75"
                x="80"
                y="58"
              >
                调度 · 加密 · 观测
              </text>
            </g>

            <!-- 4) Connection lines relay → MacBook -->
            <g fill="none" opacity="0.35" stroke="#0071e3" stroke-width="2">
              <path d="M320 320 L320 360" stroke-dasharray="5 5" />
            </g>

            <!-- 5) MacBook -->
            <g class="hero__mac" transform="translate(170 360)">
              <!-- Screen -->
              <rect fill="#1d1d1f" height="180" rx="10" width="300" x="0" y="0" />
              <rect fill="url(#macScreenGrad)" height="165" rx="6" width="288" x="6" y="6" />
              <!-- Camera notch dot -->
              <circle cx="150" cy="4" fill="#6e6e73" r="1.5" />
              <!-- Dashboard UI mockup -->
              <g transform="translate(20 22)">
                <!-- Top bar (traffic lights + title) -->
                <circle cx="8" cy="8" fill="#ff5f56" r="4" />
                <circle cx="22" cy="8" fill="#ffbd2e" r="4" />
                <circle cx="36" cy="8" fill="#27c93f" r="4" />
                <rect fill="rgba(255,255,255,0.15)" height="8" rx="4" width="80" x="90" y="4" />
                <!-- Content lines -->
                <rect fill="rgba(255,255,255,0.25)" height="10" rx="3" width="260" x="0" y="30" />
                <rect fill="rgba(255,255,255,0.15)" height="8" rx="3" width="190" x="0" y="48" />
                <rect fill="rgba(255,255,255,0.15)" height="8" rx="3" width="220" x="0" y="64" />
                <!-- Bar chart -->
                <g transform="translate(0 88)">
                  <rect fill="#0a84ff" height="22" rx="2" width="22" x="0" y="30" />
                  <rect fill="#0a84ff" height="34" opacity="0.85" rx="2" width="22" x="30" y="18" />
                  <rect fill="#0a84ff" height="30" opacity="0.75" rx="2" width="22" x="60" y="22" />
                  <rect fill="#0a84ff" height="42" rx="2" width="22" x="90" y="10" />
                  <rect fill="#0a84ff" height="38" opacity="0.9" rx="2" width="22" x="120" y="14" />
                  <rect fill="#0a84ff" height="46" rx="2" width="22" x="150" y="6" />
                  <rect fill="#0a84ff" height="32" opacity="0.8" rx="2" width="22" x="180" y="20" />
                  <rect fill="#0a84ff" height="40" rx="2" width="22" x="210" y="12" />
                </g>
              </g>
              <!-- Base / hinge -->
              <rect fill="url(#macBodyGrad)" height="6" rx="2" width="336" x="-18" y="180" />
              <rect fill="#8e8e93" height="3" rx="1" width="20" x="140" y="186" />
            </g>

            <!-- 6) Feature icons floating around -->
            <g class="hero__chip hero__chip--a" transform="translate(500 260)">
              <circle cx="0" cy="0" fill="#fff" r="24" stroke="rgba(0,0,0,0.05)" />
              <path
                d="M-8 -2 L-8 -6 A8 8 0 0 1 8 -6 L8 -2 M-10 -2 L10 -2 L10 8 L-10 8 Z"
                fill="none"
                stroke="#0071e3"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </g>
            <g class="hero__chip hero__chip--b" transform="translate(105 410)">
              <circle cx="0" cy="0" fill="#fff" r="24" stroke="rgba(0,0,0,0.05)" />
              <path
                d="M-8 6 L-3 6 L-3 -4 M1 6 L1 2 L6 2 L6 6 M-3 -4 L6 -4"
                fill="none"
                stroke="#10a37f"
                stroke-linecap="round"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </g>
            <g class="hero__chip hero__chip--c" transform="translate(520 410)">
              <circle cx="0" cy="0" fill="#fff" r="24" stroke="rgba(0,0,0,0.05)" />
              <path
                d="M0 -8 L7 -4 L7 2 C7 5 4 8 0 9 C-4 8 -7 5 -7 2 L-7 -4 Z"
                fill="none"
                stroke="#ff9500"
                stroke-linejoin="round"
                stroke-width="1.8"
              />
            </g>
          </svg>
        </div>
      </div>
    </section>

    <!-- Platforms strip -->
    <section id="platforms" class="platforms reveal">
      <h2 class="section-title">支持你的全部模型供应商</h2>
      <p class="section-sub">通过单一 API Key 接入业内主流 AI 平台。</p>
      <div class="platforms__grid">
        <div v-for="p in platforms" :key="p.name" class="platforms__item">
          <div class="platforms__icon" :style="{ background: p.color }">{{ p.icon }}</div>
          <span>{{ p.name }}</span>
        </div>
      </div>
    </section>

    <!-- Feature cards (Apple bento style) -->
    <section id="features" class="features">
      <h2 class="section-title reveal">为生产环境而生</h2>
      <div class="features__grid">
        <article class="feat feat--lg feat--dark reveal">
          <div class="feat__tag">智能调度</div>
          <h3>粘性会话 + 自动故障转移</h3>
          <p>基于请求内容哈希绑定账户，智能识别 529 过载，自动切换可用上游。</p>
          <div class="feat__chart">
            <div v-for="(b, i) in bars" :key="i" :style="{ height: b + '%' }"></div>
          </div>
        </article>

        <article class="feat feat--light reveal">
          <div class="feat__tag">企业级安全</div>
          <h3>AES 加密<br />SHA-256 哈希</h3>
          <p>OAuth Token 与凭据全程加密存储，API Key 哈希校验，零明文。</p>
        </article>

        <article class="feat feat--accent reveal">
          <div class="feat__tag">实时观测</div>
          <h3>毫秒级<br />使用统计</h3>
          <p>流式响应中实时捕获 Token 使用、计算成本，仪表盘秒级刷新。</p>
        </article>

        <article class="feat feat--lg feat--dark reveal">
          <div class="feat__tag">并发控制</div>
          <h3>Redis 排队，不再 429</h3>
          <p>基于 Sorted Set 的分布式并发限制，请求排队等待而非直接拒绝，平滑应对峰值。</p>
          <div class="feat__queue">
            <span v-for="i in 8" :key="i" :style="{ animationDelay: i * 0.12 + 's' }"></span>
          </div>
        </article>
      </div>
    </section>

    <!-- Stats -->
    <section id="stats" class="stats">
      <div class="stats__inner reveal">
        <div v-for="s in stats" :key="s.label" class="stats__item">
          <div class="stats__value">{{ s.value }}</div>
          <div class="stats__label">{{ s.label }}</div>
        </div>
      </div>
    </section>

    <!-- CTA -->
    <section id="start" class="cta">
      <div class="cta__inner reveal">
        <h2>立即开始构建。</h2>
        <p>几分钟内让你的应用接入所有主流 AI。</p>
        <div class="cta__buttons">
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
const bars = [40, 70, 55, 85, 60, 90, 50, 75, 65, 95, 70, 80]

const cliTools = [
  { key: 'claude-code', name: 'Claude Code', icon: 'fas fa-robot' },
  { key: 'codex', name: 'Codex', icon: 'fas fa-code' },
  { key: 'gemini-cli', name: 'Gemini CLI', icon: 'fab fa-google' },
  { key: 'droid-cli', name: 'Droid CLI', icon: 'fas fa-terminal' }
]

const platforms = [
  { name: 'Claude', icon: 'C', color: 'linear-gradient(135deg,#d97757,#b85a3c)' },
  { name: 'Gemini', icon: 'G', color: 'linear-gradient(135deg,#4285f4,#9b72cb)' },
  { name: 'OpenAI', icon: 'O', color: 'linear-gradient(135deg,#10a37f,#0d8a6a)' },
  { name: 'Bedrock', icon: 'B', color: 'linear-gradient(135deg,#ff9900,#ec7211)' },
  { name: 'Azure', icon: 'A', color: 'linear-gradient(135deg,#0078d4,#005a9e)' },
  { name: 'Droid', icon: 'D', color: 'linear-gradient(135deg,#34d399,#10b981)' },
  { name: 'CCR', icon: 'R', color: 'linear-gradient(135deg,#f472b6,#ec4899)' },
  { name: 'Console', icon: 'K', color: 'linear-gradient(135deg,#6366f1,#4f46e5)' }
]

const stats = [
  { value: '11+', label: '账户类型' },
  { value: '99.9%', label: '可用性目标' },
  { value: '< 50ms', label: '调度开销' },
  { value: '∞', label: '并发扩展' }
]

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
})
</script>

<style scoped>
.apple-landing {
  font-family:
    -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', 'Helvetica Neue',
    'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
  background: #fbfbfd;
  color: #1d1d1f;
  -webkit-font-smoothing: antialiased;
  letter-spacing: -0.015em;
  overflow-x: hidden;
}

/* ---------- Nav ---------- */
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
.apple-nav__cta a {
  color: #0071e3;
  text-decoration: none;
  font-weight: 500;
}
/* ---------- Dropdown trigger ---------- */
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

/* ---------- Full-width dropdown panel (GPU-only) ---------- */
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
.dropdown-panel--open .dropdown-panel__link:nth-child(6) {
  transition-delay: 0.25s;
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

/* ---------- Backdrop ---------- */
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
@media (max-width: 720px) {
  .apple-nav__links {
    display: none;
  }
}

/* ---------- Hero ---------- */
.hero {
  padding: 120px 22px 80px;
  text-align: center;
  position: relative;
  overflow: hidden;
}
.hero__inner {
  max-width: 980px;
  margin: 0 auto;
  position: relative;
}
.hero__eyebrow {
  font-size: 21px;
  font-weight: 500;
  color: #6e6e73;
  margin-bottom: 8px;
}
.hero__title {
  font-size: clamp(36px, 5.2vw, 68px);
  line-height: 1.1;
  font-weight: 700;
  letter-spacing: -0.035em;
  margin: 0 0 20px;
  background: linear-gradient(180deg, #1d1d1f 0%, #2d2d33 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.hero__sub {
  font-size: clamp(14px, 1.5vw, 17px);
  font-weight: 400;
  color: #6e6e73;
  line-height: 1.5;
  margin: 0 auto 0;
  max-width: 640px;
}
.hero__cta {
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
}
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

/* Hero visual */
.hero__visual {
  margin-top: 60px;
  position: relative;
  height: 520px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.hero__illust {
  position: relative;
  z-index: 2;
  width: min(640px, 95%);
  height: auto;
  filter: drop-shadow(0 20px 40px rgba(0, 0, 0, 0.12));
}
.hero__cloud > path {
  animation: cloudPulse 6s ease-in-out infinite;
  transform-box: fill-box;
  transform-origin: center;
}
@keyframes cloudPulse {
  0%,
  100% {
    opacity: 0.9;
  }
  50% {
    opacity: 1;
  }
}
.hero__flow path {
  animation: flowDash 2s linear infinite;
}
@keyframes flowDash {
  to {
    stroke-dashoffset: -10;
  }
}
.hero__chip--a circle,
.hero__chip--b circle,
.hero__chip--c circle {
  animation: chipPulse 4s ease-in-out infinite;
  transform-origin: center;
  transform-box: fill-box;
}
.hero__chip--b circle {
  animation-delay: -1.3s;
}
.hero__chip--c circle {
  animation-delay: -2.6s;
}
@keyframes chipPulse {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.08);
  }
}
@media (max-width: 720px) {
  .hero__visual {
    height: auto;
    min-height: 420px;
    margin-top: 40px;
  }
}
.orb {
  position: absolute;
  border-radius: 50%;
  filter: blur(60px);
  opacity: 0.6;
  animation: float 8s ease-in-out infinite;
}
.orb--a {
  width: 320px;
  height: 320px;
  background: radial-gradient(circle, #ff9966, #ff5e62);
  top: -40px;
  left: 20%;
}
.orb--b {
  width: 280px;
  height: 280px;
  background: radial-gradient(circle, #4facfe, #00f2fe);
  top: 20px;
  right: 18%;
  animation-delay: -3s;
}
.orb--c {
  width: 220px;
  height: 220px;
  background: radial-gradient(circle, #a18cd1, #fbc2eb);
  bottom: -20px;
  left: 40%;
  animation-delay: -5s;
}
@keyframes float {
  0%,
  100% {
    transform: translateY(0) scale(1);
  }
  50% {
    transform: translateY(-30px) scale(1.05);
  }
}
.hero__card {
  position: relative;
  z-index: 2;
  width: min(640px, 90%);
  height: 260px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(30px) saturate(180%);
  -webkit-backdrop-filter: blur(30px) saturate(180%);
  border-radius: 22px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow: 0 30px 60px -20px rgba(0, 0, 0, 0.15);
  overflow: hidden;
}
.hero__card-bar {
  height: 36px;
  background: rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 14px;
}
.hero__card-bar span {
  width: 11px;
  height: 11px;
  border-radius: 50%;
}
.hero__card-bar span:nth-child(1) {
  background: #ff5f56;
}
.hero__card-bar span:nth-child(2) {
  background: #ffbd2e;
}
.hero__card-bar span:nth-child(3) {
  background: #27c93f;
}
.hero__card-body {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.line {
  height: 12px;
  border-radius: 6px;
  background: linear-gradient(90deg, rgba(0, 113, 227, 0.15), rgba(0, 113, 227, 0.05));
}
.line--w90 {
  width: 90%;
}
.line--w70 {
  width: 70%;
}
.line--w65 {
  width: 65%;
}
.line--w50 {
  width: 50%;
}
.line--w40 {
  width: 40%;
}

/* ---------- Reveal ---------- */
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

/* ---------- Section common ---------- */
.section-title {
  font-size: clamp(36px, 5vw, 56px);
  font-weight: 700;
  letter-spacing: -0.03em;
  text-align: center;
  margin: 0 0 12px;
  line-height: 1.1;
}
.section-sub {
  font-size: 21px;
  color: #6e6e73;
  text-align: center;
  margin: 0 0 56px;
}

/* ---------- Platforms ---------- */
.platforms {
  padding: 100px 22px;
  max-width: 1100px;
  margin: 0 auto;
}
.platforms__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 20px;
}
.platforms__item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 12px;
  background: #fff;
  border-radius: 18px;
  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease;
}
.platforms__item:hover {
  transform: translateY(-4px);
  box-shadow: 0 16px 40px -12px rgba(0, 0, 0, 0.12);
}
.platforms__icon {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 26px;
  font-weight: 600;
  color: #fff;
  box-shadow: 0 6px 20px -4px rgba(0, 0, 0, 0.2);
}
.platforms__item span {
  font-size: 15px;
  font-weight: 500;
  color: #1d1d1f;
}

/* ---------- Features bento ---------- */
.features {
  padding: 80px 22px 120px;
  max-width: 1100px;
  margin: 0 auto;
}
.features__grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  margin-top: 56px;
}
.feat {
  border-radius: 28px;
  padding: 40px;
  min-height: 380px;
  display: flex;
  flex-direction: column;
  position: relative;
  overflow: hidden;
  transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}
.feat:hover {
  transform: translateY(-4px);
}
.feat--lg {
  grid-column: span 2;
  min-height: 420px;
}
.feat--dark {
  background: linear-gradient(135deg, #1d1d1f 0%, #2d2d33 100%);
  color: #f5f5f7;
}
.feat--light {
  background: linear-gradient(135deg, #f5f5f7 0%, #e8e8ed 100%);
  color: #1d1d1f;
}
.feat--accent {
  background: linear-gradient(135deg, #0071e3 0%, #0a84ff 100%);
  color: #fff;
}
.feat__tag {
  font-size: 13px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  opacity: 0.7;
  margin-bottom: 16px;
}
.feat h3 {
  font-size: clamp(28px, 3vw, 40px);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -0.02em;
  margin: 0 0 16px;
}
.feat p {
  font-size: 17px;
  line-height: 1.5;
  opacity: 0.85;
  margin: 0;
  max-width: 480px;
}
.feat__chart {
  margin-top: auto;
  display: flex;
  align-items: flex-end;
  gap: 6px;
  height: 100px;
  padding-top: 24px;
}
.feat__chart > div {
  flex: 1;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.6), rgba(255, 255, 255, 0.1));
  border-radius: 4px;
  animation: rise 1.2s ease-out backwards;
}
.feat__chart > div:nth-child(n) {
  animation-delay: calc(var(--i, 0) * 0.05s);
}
@keyframes rise {
  from {
    transform: scaleY(0);
    transform-origin: bottom;
  }
  to {
    transform: scaleY(1);
  }
}
.feat__queue {
  margin-top: auto;
  display: flex;
  gap: 8px;
  padding-top: 24px;
}
.feat__queue span {
  width: 36px;
  height: 36px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.2);
  animation: pulse 2s ease-in-out infinite;
}
@keyframes pulse {
  0%,
  100% {
    background: rgba(255, 255, 255, 0.1);
  }
  50% {
    background: rgba(255, 255, 255, 0.35);
  }
}
@media (max-width: 720px) {
  .features__grid {
    grid-template-columns: 1fr;
  }
  .feat--lg {
    grid-column: span 1;
  }
  .feat {
    padding: 28px;
    min-height: 320px;
  }
}

/* ---------- Stats ---------- */
.stats {
  background: #1d1d1f;
  color: #f5f5f7;
  padding: 100px 22px;
}
.stats__inner {
  max-width: 1100px;
  margin: 0 auto;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 32px;
  text-align: center;
}
.stats__value {
  font-size: clamp(40px, 6vw, 72px);
  font-weight: 700;
  letter-spacing: -0.03em;
  background: linear-gradient(180deg, #fff, #a1a1a6);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.stats__label {
  font-size: 17px;
  color: #a1a1a6;
  margin-top: 8px;
}
@media (max-width: 720px) {
  .stats__inner {
    grid-template-columns: repeat(2, 1fr);
  }
}

/* ---------- CTA ---------- */
.cta {
  padding: 140px 22px;
  text-align: center;
  background: linear-gradient(180deg, #fbfbfd 0%, #f5f5f7 100%);
}
.cta__inner h2 {
  font-size: clamp(44px, 6vw, 72px);
  font-weight: 700;
  letter-spacing: -0.03em;
  margin: 0 0 16px;
  line-height: 1.1;
}
.cta__inner p {
  font-size: 21px;
  color: #6e6e73;
  margin: 0 0 36px;
}
.cta__buttons {
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
}

/* ---------- Footer ---------- */
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
</style>
