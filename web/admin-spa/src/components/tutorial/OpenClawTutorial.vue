<template>
  <div class="tutorial-content">
    <!-- 第一步：安装 Node.js -->
    <NodeInstallTutorial :platform="platform" :step-number="1" tool-name="OpenClaw" />

    <div
      class="-mt-2 mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30 sm:mb-10 sm:p-4"
    >
      <h6 class="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300 sm:text-base">
        OpenClaw 对 Node.js 版本的要求
      </h6>
      <ul class="space-y-1 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
        <li>• 支持 Node.js 22.22.3+、24.15+ 或 25.9+，推荐 Node.js 24 LTS；不支持 Node.js 23</li>
        <li>• 安装后可用 <code>node -v</code> 确认版本，低于要求时请先升级</li>
        <li>
          • 中国大陆可从 npmmirror 下载 Node.js 安装包：
          <code>https://npmmirror.com/mirrors/node/</code>
        </li>
      </ul>
      <template v-if="platform !== 'windows'">
        <p class="mb-2 mt-3 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
          使用 nvm 时，可以让 nvm 从国内镜像下载 Node.js：
        </p>
        <div class="tutorial-command-box">
          <div class="whitespace-nowrap text-gray-300">
            export NVM_NODEJS_ORG_MIRROR=https://npmmirror.com/mirrors/node
          </div>
          <div class="whitespace-nowrap text-gray-300">nvm install 24</div>
        </div>
      </template>
    </div>

    <!-- 第二步：安装 OpenClaw -->
    <div class="mb-6 sm:mb-10">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >2</span
        >
        安装 OpenClaw
      </h4>

      <div
        class="mb-4 rounded-xl border border-green-100 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-500/40 dark:from-green-950/30 dark:to-emerald-950/30 sm:mb-6 sm:p-6"
      >
        <h5
          class="mb-2 flex items-center text-base font-semibold text-gray-800 dark:text-gray-200 sm:mb-3 sm:text-lg"
        >
          <i class="fas fa-download mr-2 text-green-600" />
          方法一：官方安装脚本（海外网络推荐）
        </h5>
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
          {{ platform === 'windows' ? '打开 PowerShell' : '打开终端' }}，运行以下命令。脚本会检测
          Node.js、安装 OpenClaw，并跳过初始化向导（下一步再单独初始化）：
        </p>
        <div class="tutorial-command-box mb-4">
          <div v-if="platform === 'windows'" class="whitespace-nowrap text-gray-300">
            &amp; ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard
          </div>
          <div v-else class="whitespace-nowrap text-gray-300">
            curl -fsSL https://openclaw.ai/install.sh | bash -s -- --no-onboard
          </div>
        </div>

        <h5
          class="mb-2 mt-6 flex items-center text-base font-semibold text-gray-800 dark:text-gray-200 sm:mb-3 sm:text-lg"
        >
          <i class="fab fa-npm mr-2 text-green-600" />
          方法二：使用 npm 安装
        </h5>
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
          已经装好 Node.js 时，也可以直接用 npm 全局安装：
        </p>
        <div class="tutorial-command-box mb-3">
          <div class="whitespace-nowrap text-gray-300">
            npm install -g openclaw@latest --allow-scripts=openclaw
          </div>
        </div>
        <p class="text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
          💡 <code>--allow-scripts=openclaw</code> 用于 npm 11.16 及以上版本（放行 OpenClaw
          的安装脚本）。先执行 <code>npm -v</code> 查看版本；npm 11.15 及以下请去掉该参数。
        </p>

        <div
          class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30 sm:p-4"
        >
          <h6 class="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300 sm:text-base">
            中国大陆网络环境（推荐）
          </h6>
          <p class="mb-3 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
            访问 openclaw.ai 或 npm 官方仓库较慢、超时时，使用 npmmirror 镜像安装：
          </p>
          <div class="tutorial-command-box mb-4">
            <div class="whitespace-nowrap text-gray-300">
              npm install -g openclaw@latest --allow-scripts=openclaw
              --registry=https://registry.npmmirror.com
            </div>
          </div>

          <p class="mb-3 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
            npm 11.15 及以下版本使用：
          </p>
          <div class="tutorial-command-box mb-4">
            <div class="whitespace-nowrap text-gray-300">
              npm install -g openclaw@latest --registry=https://registry.npmmirror.com
            </div>
          </div>

          <p class="mb-3 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
            以后升级 OpenClaw 时同样带上镜像地址：
          </p>
          <div class="tutorial-command-box">
            <div class="whitespace-nowrap text-gray-300">
              npm install -g openclaw@latest --allow-scripts=openclaw
              --registry=https://registry.npmmirror.com
            </div>
          </div>

          <ul class="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
            <li>• 镜像同步最新版本可能有延迟，装到旧版本时稍后重试即可</li>
            <li>• 只在本次命令里指定镜像，不会修改你全局的 npm registry 设置</li>
          </ul>
        </div>

        <div
          class="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/40 dark:bg-blue-950/30 sm:p-4"
        >
          <h6 class="mb-2 text-sm font-medium text-blue-800 dark:text-blue-300 sm:text-base">
            提示
          </h6>
          <ul class="space-y-1 text-xs text-blue-700 dark:text-blue-300 sm:text-sm">
            <template v-if="platform === 'windows'">
              <li>• 建议使用 PowerShell 而不是 CMD</li>
              <li>• 也可以在 WSL2 中按「Linux / WSL2」页签的步骤安装</li>
            </template>
            <template v-else-if="platform === 'macos'">
              <li>• 不建议使用 sudo 安装全局 npm 包</li>
              <li>• 遇到权限问题时，优先使用 nvm 或修复 npm 全局安装目录</li>
            </template>
            <template v-else>
              <li>• 使用 nvm 安装的 Node.js 可以避免 sudo</li>
              <li>• WSL2 用户请在 Linux 子系统中执行命令</li>
            </template>
          </ul>
        </div>
      </div>

      <div
        class="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-500/40 dark:bg-green-950/30 sm:p-4"
      >
        <h6 class="mb-2 font-medium text-green-800 dark:text-green-300">验证 OpenClaw 安装</h6>
        <p class="mb-3 text-sm text-green-700 dark:text-green-300">
          重新打开一个终端，输入以下命令：
        </p>
        <div class="tutorial-command-box">
          <div class="whitespace-nowrap text-gray-300">openclaw --version</div>
        </div>
        <p class="mt-2 text-sm text-green-700 dark:text-green-300">显示版本号即表示安装成功。</p>
      </div>
    </div>

    <!-- 第三步：初始化 -->
    <div class="mb-6 sm:mb-10">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-purple-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >3</span
        >
        初始化 OpenClaw
      </h4>
      <div
        class="rounded-xl border border-purple-100 bg-gradient-to-r from-purple-50 to-pink-50 p-4 dark:border-purple-500/40 dark:from-purple-950/30 dark:to-pink-950/30 sm:p-6"
      >
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
          运行初始化向导，创建工作区并安装后台 Gateway 服务：
        </p>
        <div class="tutorial-command-box mb-3">
          <div class="whitespace-nowrap text-gray-300">openclaw onboard --install-daemon</div>
        </div>
        <ul class="space-y-1 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
          <li>• 向导里选择模型 / 认证方式时选 <strong>Skip</strong>，模型在下一步用脚本配置</li>
          <li>• 其余选项保持默认即可，之后都可以用 <code>openclaw configure</code> 修改</li>
        </ul>
      </div>
    </div>

    <!-- 第四步：配置模型 -->
    <div class="mb-6 sm:mb-10">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >4</span
        >
        配置 Claude / GPT 模型
      </h4>

      <div
        class="mb-4 rounded-xl border border-indigo-100 bg-gradient-to-r from-indigo-50 to-blue-50 p-4 dark:border-indigo-500/40 dark:from-indigo-950/30 dark:to-blue-950/30 sm:mb-6 sm:p-6"
      >
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:text-base">
          下面的脚本会把 API Key 写入
          <code>{{ envPath }}</code>
          ，并在 OpenClaw 配置中添加指向本服务的模型。配置文件里只保存
          <code>${...}</code>
          变量引用，不保存明文密钥；重复执行只会更新本服务这一段，不影响你已有的其他模型。
        </p>
        <label class="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
          你的 API Key（可选，仅用于在本页生成脚本，不会上传）
        </label>
        <input
          v-model.trim="apiKey"
          autocomplete="off"
          class="form-input-md mb-2 w-full"
          placeholder="cr_xxxxxxxxxxxxxxxxxx"
          spellcheck="false"
          type="password"
        />
        <p class="text-xs text-gray-600 dark:text-gray-400">
          💡 不填写时脚本中显示为「{{ API_KEY_PLACEHOLDER }}」，复制后请替换为在 "API Keys"
          中创建的实际密钥。Claude 与 GPT 可以使用同一把 Key。
        </p>
      </div>

      <div
        class="mb-4 rounded-lg border border-orange-200 bg-white p-3 dark:border-orange-700 dark:bg-gray-800 sm:mb-6 sm:p-4"
      >
        <h6
          class="mb-2 flex items-center text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base"
        >
          <i class="fas fa-robot mr-2 text-orange-500" />
          配置 Claude 模型
        </h6>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
          协议：Anthropic Messages，地址：<code>{{ currentBaseUrl }}</code
          >。在 {{ shellName }} 中整段粘贴执行：
        </p>
        <div class="tutorial-command-box">
          <div
            v-for="(line, index) in claudeScriptLines"
            :key="`claude-${index}`"
            class="whitespace-nowrap text-gray-300"
          >
            {{ line }}
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-600 dark:text-gray-400">
          执行后默认模型为 <code>{{ claudePrimary }}</code
          >，包含：{{ claudeModels.map((m) => m.value).join('、') }}
        </p>
      </div>

      <div
        class="mb-4 rounded-lg border border-emerald-200 bg-white p-3 dark:border-emerald-700 dark:bg-gray-800 sm:mb-6 sm:p-4"
      >
        <h6
          class="mb-2 flex items-center text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base"
        >
          <i class="fas fa-code mr-2 text-emerald-500" />
          配置 GPT 模型
        </h6>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
          协议：OpenAI Chat Completions，地址：<code>{{ gptBaseUrl }}</code
          >。在 {{ shellName }} 中整段粘贴执行：
        </p>
        <div class="tutorial-command-box">
          <div
            v-for="(line, index) in gptScriptLines"
            :key="`gpt-${index}`"
            class="whitespace-nowrap text-gray-300"
          >
            {{ line }}
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-600 dark:text-gray-400">
          执行后默认模型为 <code>{{ gptPrimary }}</code
          >，包含：{{ gptModels.map((m) => m.value).join('、') }}
        </p>
      </div>

      <div
        class="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/40 dark:bg-blue-950/30 sm:p-4"
      >
        <h6 class="mb-2 text-sm font-medium text-blue-800 dark:text-blue-300 sm:text-base">说明</h6>
        <ul class="space-y-1 text-xs text-blue-700 dark:text-blue-300 sm:text-sm">
          <li>• 两段脚本可以都执行；最后执行的那段决定默认模型</li>
          <li>
            • 输出 <code>Applied ... config update(s)</code> 即表示写入成功；之后重启 Gateway
            让它读取新的 API Key：
          </li>
        </ul>
        <div class="tutorial-command-box mt-3">
          <div class="whitespace-nowrap text-gray-300">openclaw gateway restart</div>
        </div>
      </div>
    </div>

    <!-- 第五步：开始使用 -->
    <div class="mb-6 sm:mb-8">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >5</span
        >
        验证并开始使用
      </h4>
      <div
        class="rounded-xl border border-orange-100 bg-gradient-to-r from-orange-50 to-yellow-50 p-4 dark:border-orange-500/40 dark:from-orange-950/30 dark:to-yellow-950/30 sm:p-6"
      >
        <div class="space-y-4">
          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              查看已配置的模型
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">
                openclaw models list --provider {{ CLAUDE_PROVIDER_ID }}
              </div>
              <div class="whitespace-nowrap text-gray-300">
                openclaw models list --provider {{ GPT_PROVIDER_ID }}
              </div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              发一条消息测试（能正常回复即配置成功）
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">
                openclaw agent exec "用一句话介绍你自己" --model {{ claudePrimary }}
              </div>
              <div class="whitespace-nowrap text-gray-300">
                openclaw agent exec "用一句话介绍你自己" --model {{ gptPrimary }}
              </div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              切换默认模型
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">
                openclaw models set {{ gptPrimary }}
              </div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              打开网页控制台 / 终端界面
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">openclaw dashboard</div>
              <div class="whitespace-nowrap text-gray-300">openclaw tui</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              诊断安装和环境
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">openclaw doctor</div>
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
            安装后提示找不到 openclaw 命令
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <ul class="list-inside list-disc space-y-1 text-sm">
              <li>先关闭并重新打开终端</li>
              <li>
                执行 <code>npm prefix -g</code> 查看 npm 全局目录，确认其
                {{ platform === 'windows' ? '' : 'bin 子目录' }}已加入 PATH
              </li>
            </ul>
          </div>
        </details>

        <details
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            npm 提示 blocked because they are not covered by allowScripts
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">
              新版 npm 默认拦截安装脚本，重新执行带
              <code>--allow-scripts=openclaw</code> 的安装命令即可。注意
              <code>npm approve-scripts openclaw</code> 对全局安装无效。
            </p>
          </div>
        </details>

        <details
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            请求返回 401 或提示 API Key 无效
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <ul class="list-inside list-disc space-y-1 text-sm">
              <li>
                打开 <code>{{ envPath }}</code
                >，确认 <code>{{ CLAUDE_ENV_KEY }}</code> /
                <code>{{ GPT_ENV_KEY }}</code> 的值是完整的 API Key
              </li>
              <li>修改后执行 <code>openclaw gateway restart</code></li>
            </ul>
          </div>
        </details>

        <details
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            GPT 模型返回 400，Claude 正常
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">
              通常是该 API Key 没有 OpenAI 权限，或所在分组暂无可用的 GPT
              账号。请在「实时数据」页查询 Key 的权限，或联系管理员开通。
            </p>
          </div>
        </details>

        <details
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            Claude 提示 "thinking.type.disabled" is not supported
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">
              新版 Claude 模型不支持关闭思考。请不要使用 <code>--thinking off</code> 或
              <code>/think off</code>，改用 <code>low</code> 等最低档位。
            </p>
          </div>
        </details>

        <details
          v-if="platform === 'windows'"
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            PowerShell 执行策略错误
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">如果遇到执行策略限制，运行：</p>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">
                Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from 'vue'
import { useTutorialUrls } from '@/utils/useTutorialUrls'
import { getModelsApi } from '@/utils/http_apis'
import {
  API_KEY_PLACEHOLDER,
  CLAUDE_ENV_KEY,
  CLAUDE_MODEL_PATTERN,
  CLAUDE_PROVIDER_ID,
  DEFAULT_CLAUDE_MODELS,
  DEFAULT_GPT_MODELS,
  GPT_ENV_KEY,
  GPT_MODEL_PATTERN,
  GPT_PROVIDER_ID,
  buildClaudeScriptLines,
  buildGptScriptLines,
  pickModels
} from '@/utils/openclawTutorialScripts'
import NodeInstallTutorial from './NodeInstallTutorial.vue'

const props = defineProps({
  platform: {
    type: String,
    required: true,
    validator: (value) => ['windows', 'macos', 'linux'].includes(value)
  }
})

// 教程页切换系统时会重新挂载组件，模型清单在模块级缓存，避免重复请求
let cachedModels = null

const { currentBaseUrl } = useTutorialUrls()
const gptBaseUrl = computed(() => `${currentBaseUrl.value}/v1`)

const apiKey = ref('')
const claudeModels = ref(cachedModels?.claude || DEFAULT_CLAUDE_MODELS)
const gptModels = ref(cachedModels?.gpt || DEFAULT_GPT_MODELS)

const platformName = computed(() => {
  const names = { windows: 'Windows', macos: 'macOS', linux: 'Linux / WSL2' }
  return names[props.platform]
})

const shellName = computed(() => (props.platform === 'windows' ? 'PowerShell' : '终端'))

const envPath = computed(() =>
  props.platform === 'windows' ? '%USERPROFILE%\\.openclaw\\.env' : '~/.openclaw/.env'
)

const claudePrimary = computed(() => `${CLAUDE_PROVIDER_ID}/${claudeModels.value[0].value}`)
const gptPrimary = computed(() => `${GPT_PROVIDER_ID}/${gptModels.value[0].value}`)

const claudeScriptLines = computed(() =>
  buildClaudeScriptLines(props.platform, currentBaseUrl.value, claudeModels.value, apiKey.value)
)
const gptScriptLines = computed(() =>
  buildGptScriptLines(props.platform, gptBaseUrl.value, gptModels.value, apiKey.value)
)

onMounted(async () => {
  if (cachedModels) {
    return
  }
  try {
    const result = await getModelsApi()
    if (result?.success && result.data) {
      cachedModels = {
        claude: pickModels(result.data.claude, CLAUDE_MODEL_PATTERN, DEFAULT_CLAUDE_MODELS),
        gpt: pickModels(result.data.openai, GPT_MODEL_PATTERN, DEFAULT_GPT_MODELS)
      }
      claudeModels.value = cachedModels.claude
      gptModels.value = cachedModels.gpt
    }
  } catch {
    // 拉取失败时保留兜底模型清单
  }
})
</script>
