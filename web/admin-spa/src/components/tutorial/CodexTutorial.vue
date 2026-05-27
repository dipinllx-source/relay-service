<template>
  <div class="tutorial-section">
    <!-- 第一步：安装 Node.js -->
    <NodeInstallTutorial :platform="platform" :step-number="1" tool-name="Codex" />

    <!-- 第二步：安装 Codex CLI -->
    <div class="mb-4 sm:mb-6">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >2</span
        >
        安装 Codex CLI
      </h4>

      <div
        class="mb-4 rounded-xl border border-green-100 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-500/40 dark:from-green-950/30 dark:to-emerald-950/30 sm:mb-6 sm:p-6"
      >
        <h5
          class="mb-2 flex items-center text-base font-semibold text-gray-800 dark:text-gray-200 sm:mb-3 sm:text-lg"
        >
          <i class="fas fa-download mr-2 text-green-600" />
          官方 npm 安装
        </h5>
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
          {{ platform === 'windows' ? '打开 PowerShell' : '打开终端' }}，运行以下命令安装 OpenAI
          Codex CLI：
        </p>
        <div class="tutorial-command-box mb-4">
          <div class="mb-2"># 全局安装 Codex CLI</div>
          <div class="whitespace-nowrap text-gray-300">npm install -g @openai/codex</div>
        </div>

        <template v-if="platform === 'macos'">
          <p class="mb-3 text-sm text-gray-700 dark:text-gray-300">
            macOS 用户也可以使用 Homebrew 安装：
          </p>
          <div class="tutorial-command-box mb-4">
            <div class="whitespace-nowrap text-gray-300">brew install --cask codex</div>
          </div>
        </template>

        <div
          class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30 sm:p-4"
        >
          <h6 class="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300 sm:text-base">
            中国大陆网络环境（可选）
          </h6>
          <p class="mb-3 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
            如果访问 npm 官方仓库较慢或超时，可以临时使用 npmmirror 镜像安装。镜像不是 OpenAI 或 npm
            官方源，建议只在安装时临时指定，安装完成后继续使用官方源。
          </p>
          <div class="tutorial-command-box mb-4">
            <div class="mb-2"># 方法一：本次安装临时使用镜像（推荐）</div>
            <div class="whitespace-nowrap text-gray-300">
              npm install -g @openai/codex --registry=https://registry.npmmirror.com
            </div>
          </div>

          <p class="mb-3 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
            如果你经常需要使用镜像，也可以临时切换 npm registry，安装完成后再恢复官方源：
          </p>
          <div class="tutorial-command-box">
            <div class="mb-2"># 方法二：切换 npm registry 后安装，再恢复官方源</div>
            <div class="whitespace-nowrap text-gray-300">
              npm config set registry https://registry.npmmirror.com
            </div>
            <div class="whitespace-nowrap text-gray-300">npm install -g @openai/codex</div>
            <div class="whitespace-nowrap text-gray-300">
              npm config set registry https://registry.npmjs.org/
            </div>
          </div>

          <ul class="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
            <li>• 如果提示包不存在或二进制缺失，请等待镜像同步完成后重试</li>
            <li>• 如果仍然失败，优先恢复官方源后再执行官方安装命令</li>
          </ul>
        </div>

        <div
          class="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/40 dark:bg-blue-950/30 sm:p-4"
        >
          <h6 class="mb-2 text-sm font-medium text-blue-800 dark:text-blue-300 sm:text-base">
            平台提示
          </h6>
          <ul class="space-y-1 text-xs text-blue-700 dark:text-blue-300 sm:text-sm">
            <template v-if="platform === 'windows'">
              <li>• 建议使用 PowerShell；如果项目依赖 Linux 工具链，也可以在 WSL2 中使用</li>
              <li>• 如果遇到全局安装权限问题，以管理员身份运行 PowerShell 后重试</li>
            </template>
            <template v-else-if="platform === 'macos'">
              <li>• 不建议使用 sudo 安装全局 npm 包</li>
              <li>• 如果遇到权限问题，优先使用 nvm 或 Homebrew 方式安装</li>
            </template>
            <template v-else>
              <li>• 使用 nvm 安装的 Node.js 可以避免 sudo</li>
              <li>• WSL2 用户请在 Linux 子系统中运行安装和启动命令</li>
            </template>
          </ul>
        </div>
      </div>

      <!-- 验证安装 -->
      <div
        class="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-500/40 dark:bg-green-950/30 sm:p-4"
      >
        <h6 class="mb-2 font-medium text-green-800 dark:text-green-300">验证 Codex CLI 安装</h6>
        <p class="mb-3 text-sm text-green-700 dark:text-green-300">
          安装完成后，输入以下命令检查是否安装成功：
        </p>
        <div class="tutorial-command-box">
          <div class="whitespace-nowrap text-gray-300">codex --version</div>
        </div>
        <p class="mt-2 text-sm text-green-700 dark:text-green-300">
          如果显示版本号，说明 Codex CLI 已经成功安装。
        </p>
      </div>
    </div>

    <!-- 第三步：配置 Codex -->
    <div class="mb-4 sm:mb-6">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >3</span
        >
        配置 Codex
      </h4>
      <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
        配置 Codex 以连接到中转服务：
      </p>

      <div class="space-y-4">
        <!-- config.toml 配置 -->
        <div
          class="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-500/40 dark:bg-yellow-950/30 sm:p-4"
        >
          <h6 class="mb-2 font-medium text-yellow-800 dark:text-yellow-300">
            1. 配置文件 config.toml
          </h6>
          <p class="mb-3 text-sm text-yellow-700 dark:text-yellow-300">
            在
            <code class="rounded bg-yellow-100 px-1 dark:bg-yellow-900">{{ configPath }}</code>
            文件开头添加以下配置：
          </p>
          <div class="tutorial-code-box">
            <div
              v-for="(line, index) in configTomlLines"
              :key="`${line}-${index}`"
              class="whitespace-nowrap text-gray-300"
              :class="{ 'mt-2': line === '' }"
            >
              {{ line || '&nbsp;' }}
            </div>
          </div>
          <p class="mt-3 text-sm text-yellow-600 dark:text-yellow-400">一键写入命令：</p>
          <div class="tutorial-command-box mt-2">
            <div class="whitespace-nowrap text-gray-300">{{ configTomlWriteCmd }}</div>
          </div>

          <div
            class="mt-4 rounded-lg border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-500/40 dark:bg-cyan-950/30 sm:p-4"
          >
            <h6 class="mb-2 text-sm font-medium text-cyan-800 dark:text-cyan-300 sm:text-base">
              IPv4 映射 IPv6 格式（可选）
            </h6>
            <p class="mb-3 text-sm text-cyan-700 dark:text-cyan-300">
              如果直接使用 IPv6 地址访问中转服务，请只替换
              <code class="rounded bg-cyan-100 px-1 dark:bg-cyan-900">base_url</code>
              这一行；地址使用
              <code class="rounded bg-cyan-100 px-1 dark:bg-cyan-900">[::ffff:ipv4]:port</code>
              格式，路径仍然保持
              <code class="rounded bg-cyan-100 px-1 dark:bg-cyan-900">/openai</code>：
            </p>
            <div class="tutorial-code-box">
              <div class="whitespace-nowrap text-gray-300">
                base_url = "{{ ipv6OpenaiBaseUrl }}"
              </div>
            </div>
            <p class="mt-3 text-sm text-cyan-700 dark:text-cyan-300">IPv6 格式一键写入命令：</p>
            <div class="tutorial-command-box mt-2">
              <div class="whitespace-nowrap text-gray-300">{{ ipv6ConfigTomlWriteCmd }}</div>
            </div>
            <p class="mt-2 text-xs text-cyan-700 dark:text-cyan-300">
              💡 如果当前页面使用 IPv4 地址访问，会自动填入该 IPv4；否则将示例中的
              <code class="rounded bg-cyan-100 px-1 dark:bg-cyan-900">ipv4</code>
              替换为实际 IPv4 地址；如果端口显示为
              <code class="rounded bg-cyan-100 px-1 dark:bg-cyan-900">port</code>
              ，也替换为实际端口。
            </p>
          </div>
        </div>

        <!-- auth.json 配置 -->
        <div
          class="rounded-lg border border-orange-200 bg-orange-50 p-3 dark:border-orange-500/40 dark:bg-orange-950/30 sm:p-4"
        >
          <h6 class="mb-2 font-medium text-orange-800 dark:text-orange-300">
            2. 认证文件 auth.json
          </h6>
          <p class="mb-3 text-sm text-orange-700 dark:text-orange-300">
            在
            <code class="rounded bg-orange-100 px-1 dark:bg-orange-900">{{ authPath }}</code>
            文件中配置：
          </p>
          <div class="tutorial-code-box">
            <div class="whitespace-nowrap text-gray-300">{</div>
            <div class="whitespace-nowrap text-gray-300">
              &nbsp;&nbsp;"OPENAI_API_KEY": "后台创建的API密钥"
            </div>
            <div class="whitespace-nowrap text-gray-300">}</div>
          </div>
          <p class="mt-3 text-sm text-orange-600 dark:text-orange-400">一键写入命令：</p>
          <div class="tutorial-command-box mt-2">
            <div class="whitespace-nowrap text-gray-300">{{ authJsonWriteCmd }}</div>
          </div>
        </div>

        <!-- 提示 -->
        <div
          class="rounded-lg border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-500/40 dark:bg-yellow-950/30 sm:p-4"
        >
          <p class="text-sm text-yellow-700 dark:text-yellow-300">
            💡 请将示例中的
            <code class="rounded bg-yellow-100 px-1 dark:bg-yellow-900">cr_xxxxxxxxxx</code>
            替换为您的实际 API 密钥
          </p>
        </div>

        <!-- 模型选择说明 -->
        <div
          class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/40 dark:bg-blue-950/30 sm:p-4"
        >
          <h6 class="mb-2 font-medium text-blue-800 dark:text-blue-300">📌 模型选择</h6>
          <ul class="space-y-1 text-sm text-blue-700 dark:text-blue-300">
            <li>
              • <strong>ChatGPT Plus 订阅</strong>：仅支持通用模型，推荐
              <code class="rounded bg-blue-100 px-1 dark:bg-blue-900">gpt-5.4</code> /
              <code class="rounded bg-blue-100 px-1 dark:bg-blue-900">gpt-5</code> /
              <code class="rounded bg-blue-100 px-1 dark:bg-blue-900">gpt-5.1</code>
            </li>
            <li>
              • <strong>ChatGPT Pro / Business / Enterprise 订阅</strong>：可额外使用 Codex 专属模型
              <code class="rounded bg-blue-100 px-1 dark:bg-blue-900">gpt-5-codex</code> /
              <code class="rounded bg-blue-100 px-1 dark:bg-blue-900">gpt-5.1-codex-max</code>
            </li>
            <li class="pt-1">
              • 若请求被上游返回
              <code class="rounded bg-blue-100 px-1 dark:bg-blue-900"
                >model is not supported when using Codex with a ChatGPT account</code
              >
              ，请将
              <code class="rounded bg-blue-100 px-1 dark:bg-blue-900">model</code>
              改为通用模型（如
              <code class="rounded bg-blue-100 px-1 dark:bg-blue-900">gpt-5.4</code>）
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- 第四步：启动并使用 Codex -->
    <div class="mb-6 sm:mb-8">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >4</span
        >
        启动并使用 Codex
      </h4>
      <div
        class="rounded-xl border border-orange-100 bg-gradient-to-r from-orange-50 to-yellow-50 p-4 dark:border-orange-500/40 dark:from-orange-950/30 dark:to-yellow-950/30 sm:p-6"
      >
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
          配置完成后，进入项目目录即可使用 Codex：
        </p>

        <div class="space-y-4">
          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              交互式启动
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">codex</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              在特定项目中使用
            </h6>
            <div class="tutorial-command-box">
              <div class="mb-2"># 进入你的项目目录</div>
              <div class="whitespace-nowrap text-gray-300">cd {{ projectPath }}</div>
              <div class="mb-2 mt-2"># 启动 Codex</div>
              <div class="whitespace-nowrap text-gray-300">codex</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              带初始问题启动
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">codex "请先帮我理解这个项目结构"</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              一次性执行并退出（适合验证配置）
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">codex exec "用一句话介绍当前项目"</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              继续或恢复会话
            </h6>
            <div class="tutorial-command-box">
              <div class="mb-2"># 打开会话选择器</div>
              <div class="whitespace-nowrap text-gray-300">codex resume</div>
              <div class="mb-2 mt-2"># 直接继续最近一次会话</div>
              <div class="whitespace-nowrap text-gray-300">codex resume --last</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              检查版本和命令帮助
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">codex --version</div>
              <div class="whitespace-nowrap text-gray-300">codex --help</div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 故障排除 -->
    <div class="mb-8">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <i class="fas fa-wrench mr-2 text-red-600 sm:mr-3" />
        {{ platformName }} 常见问题解决
      </h4>
      <div class="space-y-4">
        <details
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            安装后提示 codex 命令不可用
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">这通常是 npm 全局安装目录没有加入 PATH：</p>
            <ul class="list-inside list-disc space-y-1 text-sm">
              <template v-if="platform === 'windows'">
                <li>
                  重新打开 PowerShell 后再执行
                  <code>codex --version</code>
                </li>
                <li>
                  确认 npm 全局目录（通常是
                  <code>%APPDATA%\npm</code>）已经加入 PATH
                </li>
              </template>
              <template v-else>
                <li>
                  重新打开终端后再执行
                  <code>codex --version</code>
                </li>
                <li>如果使用 nvm，请确认当前 shell 已加载 nvm 的环境变量</li>
              </template>
            </ul>
          </div>
        </details>

        <details
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            中国大陆镜像安装失败或版本落后
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">npm 镜像可能需要时间同步最新包，可以尝试：</p>
            <ul class="list-inside list-disc space-y-1 text-sm">
              <li>等待镜像同步后重新执行安装命令</li>
              <li>
                恢复官方源：
                <code class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                  >npm config set registry https://registry.npmjs.org/</code
                >
              </li>
              <li>确认没有把镜像源永久保留在 CI 或生产环境中</li>
            </ul>
          </div>
        </details>

        <details
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            Codex 没有走中转服务
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">请检查以下配置项：</p>
            <ul class="list-inside list-disc space-y-1 text-sm">
              <li>
                <code class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                  >model_provider = "crs"</code
                >
                是否位于
                <code>{{ configPath }}</code>
                文件开头
              </li>
              <li>
                <code class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                  >base_url</code
                >
                是否指向当前服务的
                <code>/openai</code>
                路径
              </li>
              <li>Nginx 反向代理需要保留下划线请求头，否则粘性会话可能失效</li>
            </ul>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useTutorialUrls } from '@/utils/useTutorialUrls'
import NodeInstallTutorial from './NodeInstallTutorial.vue'

const props = defineProps({
  platform: {
    type: String,
    required: true,
    validator: (value) => ['windows', 'macos', 'linux'].includes(value)
  }
})

const { openaiBaseUrl, ipv6OpenaiBaseUrl } = useTutorialUrls()

const platformName = computed(() => {
  const names = { windows: 'Windows', macos: 'macOS', linux: 'Linux / WSL2' }
  return names[props.platform]
})

const projectPath = computed(() =>
  props.platform === 'windows' ? 'C:\\path\\to\\your\\project' : '/path/to/your/project'
)

const configPath = computed(() =>
  props.platform === 'windows' ? '%USERPROFILE%\\.codex\\config.toml' : '~/.codex/config.toml'
)

const authPath = computed(() =>
  props.platform === 'windows' ? '%USERPROFILE%\\.codex\\auth.json' : '~/.codex/auth.json'
)

const configTomlLines = computed(() => [
  'model_provider = "crs"',
  'model = "gpt-5.4"',
  'disable_response_storage = true',
  'preferred_auth_method = "apikey"',
  '',
  '[model_providers.crs]',
  'name = "crs"',
  `base_url = "${openaiBaseUrl.value}"`,
  'wire_api = "responses"',
  'requires_openai_auth = true'
])

const configTomlContent = computed(() => configTomlLines.value.join('\n'))

const ipv6ConfigTomlLines = computed(() =>
  configTomlLines.value.map((line) =>
    line.startsWith('base_url = ') ? `base_url = "${ipv6OpenaiBaseUrl.value}"` : line
  )
)

const ipv6ConfigTomlContent = computed(() => ipv6ConfigTomlLines.value.join('\n'))

const buildConfigWriteCmd = (content) => {
  if (props.platform === 'windows') {
    const escaped = content.replace(/"/g, '`"').replace(/\n/g, '`n')
    return `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.codex" | Out-Null; "${escaped}" | Set-Content -Path "$env:USERPROFILE\\.codex\\config.toml" -Force`
  }

  const escaped = content.replace(/\n/g, '\\n')
  return `mkdir -p ~/.codex && printf '${escaped}\\n' > ~/.codex/config.toml`
}

const configTomlWriteCmd = computed(() => buildConfigWriteCmd(configTomlContent.value))
const ipv6ConfigTomlWriteCmd = computed(() => buildConfigWriteCmd(ipv6ConfigTomlContent.value))

const authJsonWriteCmd = computed(() => {
  if (props.platform === 'windows') {
    return `New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\\.codex" | Out-Null; '{"OPENAI_API_KEY": null}' | Set-Content -Path "$env:USERPROFILE\\.codex\\auth.json" -Force`
  }
  return `mkdir -p ~/.codex && echo '{"OPENAI_API_KEY": null}' > ~/.codex/auth.json`
})
</script>
