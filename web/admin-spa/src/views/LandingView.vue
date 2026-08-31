<template>
  <div class="apple-landing">
    <!-- Sticky translucent nav -->
    <PublicNav home-as-anchor />

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

    <!-- Preview：控制台实拍（演示数据） -->
    <section id="preview" class="preview">
      <h2 class="section-title reveal">看看它长什么样</h2>
      <p class="section-sub reveal">看板、API Key 与账户管理，三块日常最常用的界面。</p>

      <div class="preview__tabs reveal">
        <button
          v-for="s in shots"
          :key="s.key"
          class="preview__tab"
          :class="{ 'preview__tab--active': activeShot === s.key }"
          type="button"
          @click="activeShot = s.key"
        >
          {{ s.label }}
        </button>
      </div>

      <figure class="preview__frame reveal">
        <!-- 图片给定固定宽高比，避免未加载时高度塌成 0：
             .reveal 靠 IntersectionObserver 触发入场，而零高元素永远不与
             视口相交，会卡在 opacity:0 —— 图片与动画互相死锁 -->
        <div class="preview__bar">
          <span class="preview__dot preview__dot--r" />
          <span class="preview__dot preview__dot--y" />
          <span class="preview__dot preview__dot--g" />
          <span class="preview__crumb">{{ currentShot.label }}</span>
        </div>
        <img
          :key="currentShot.key"
          :alt="currentShot.alt"
          class="preview__img"
          decoding="async"
          height="1434"
          :src="currentShot.src"
          width="3024"
        />
        <figcaption class="preview__cap">{{ currentShot.desc }}</figcaption>
      </figure>
      <p class="preview__note">截图中的账号、用量与费用均为演示数据。</p>
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

    <PublicFooter />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import PublicFooter from '@/components/public/PublicFooter.vue'
import PublicNav from '@/components/public/PublicNav.vue'

const bars = [40, 70, 55, 85, 60, 90, 50, 75, 65, 95, 70, 80]

// 控制台截图（演示数据，非真实账号/用量）
const shots = [
  {
    key: 'dashboard',
    label: '看板',
    src: 'screenshots/dashboard.jpg',
    alt: 'Relay Service 看板：请求量、Token 用量、实时吞吐与模型分布',
    desc: '请求量、Token 用量、实时吞吐与模型分布一屏掌握。'
  },
  {
    key: 'api-keys',
    label: 'API Keys',
    src: 'screenshots/api-keys.jpg',
    alt: 'Relay Service API Key 管理：费用、Token、请求数与最后使用时间',
    desc: '每把 Key 的费用、用量与最后使用时间一目了然。'
  },
  {
    key: 'accounts',
    label: '账户管理',
    src: 'screenshots/accounts.jpg',
    alt: 'Relay Service 账户管理：多平台账户、会话窗口与调度优先级',
    desc: '多平台账户、会话窗口与调度优先级集中管理。'
  }
]
const activeShot = ref('dashboard')
const currentShot = computed(() => shots.find((s) => s.key === activeShot.value) || shots[0])

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

let observer

onMounted(() => {
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

/* ---------- Preview ---------- */
.preview {
  padding: 100px 22px 110px;
  max-width: 1180px;
  margin: 0 auto;
}
.preview__tabs {
  display: flex;
  justify-content: center;
  gap: 8px;
  margin: 28px 0 26px;
  flex-wrap: wrap;
}
.preview__tab {
  height: 36px;
  padding: 0 18px;
  border-radius: 999px;
  border: 1px solid rgba(0, 0, 0, 0.12);
  background: #fff;
  color: #1d1d1f;
  font-size: 15px;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}
.preview__tab:hover {
  background: rgba(0, 0, 0, 0.04);
}
.preview__tab--active {
  background: #1d1d1f;
  border-color: #1d1d1f;
  color: #fff;
}
.preview__frame {
  margin: 0;
  border-radius: 18px;
  overflow: hidden;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  box-shadow: 0 30px 60px -25px rgba(0, 0, 0, 0.28);
}
.preview__bar {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 38px;
  padding: 0 14px;
  background: #f5f5f7;
  border-bottom: 1px solid rgba(0, 0, 0, 0.07);
}
.preview__dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  flex: 0 0 11px;
}
.preview__dot--r {
  background: #ff5f57;
}
.preview__dot--y {
  background: #febc2e;
}
.preview__dot--g {
  background: #28c840;
}
.preview__crumb {
  margin-left: 10px;
  font-size: 12.5px;
  color: #6e6e73;
}
.preview__img {
  display: block;
  width: 100%;
  height: auto;
  aspect-ratio: 3024 / 1434;
  background: #f5f5f7;
  animation: shotFade 0.35s ease;
}
.dark .preview__img {
  background: #2c2c2e;
}
@keyframes shotFade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.preview__cap {
  padding: 16px 20px;
  font-size: 15px;
  color: #6e6e73;
  border-top: 1px solid rgba(0, 0, 0, 0.07);
}
.preview__note {
  margin: 14px 0 0;
  text-align: center;
  font-size: 13px;
  color: #86868b;
}
@media (max-width: 640px) {
  .preview {
    padding: 70px 16px 76px;
  }
  .preview__cap {
    font-size: 14px;
    padding: 13px 15px;
  }
}
.dark .preview__tab {
  background: #1c1c1e;
  border-color: rgba(255, 255, 255, 0.14);
  color: #f5f5f7;
}
.dark .preview__tab--active {
  background: #f5f5f7;
  border-color: #f5f5f7;
  color: #1d1d1f;
}
.dark .preview__frame {
  background: #1c1c1e;
  border-color: rgba(255, 255, 255, 0.1);
}
.dark .preview__bar {
  background: #2c2c2e;
  border-bottom-color: rgba(255, 255, 255, 0.08);
}
.dark .preview__cap {
  border-top-color: rgba(255, 255, 255, 0.08);
  color: #a1a1a6;
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
/* ---------- 暗色变体 ----------
 * 本页原无任何暗色规则，深色模式下整页为浅底。仅覆盖表面、文字与边框；
 * .feat--dark 与 .stats 本就是刻意的深色区块，.btn--primary 为品牌色，均不改。
 */
.dark .apple-landing {
  background: #0b1220;
  color: #f3f4f6;
}
.dark .hero__title {
  background: linear-gradient(180deg, #f9fafb 0%, #d1d5db 100%);
  -webkit-background-clip: text;
  background-clip: text;
}
.dark .hero__card {
  background: rgba(31, 41, 55, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.dark .hero__card-bar {
  background: rgba(255, 255, 255, 0.06);
}
.dark .platforms__item {
  background: #1f2937;
}
.dark .platforms__item span {
  color: #f3f4f6;
}
.dark .feat--light {
  background: linear-gradient(135deg, #1f2937 0%, #111827 100%);
  color: #f3f4f6;
}
.dark .cta {
  background: linear-gradient(180deg, #0b1220 0%, #111827 100%);
}
</style>
