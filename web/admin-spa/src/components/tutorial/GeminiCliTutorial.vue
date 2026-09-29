<template>
  <div class="tutorial-section">
    <!-- 第一步：安装 Node.js -->
    <NodeInstallTutorial :platform="platform" :step-number="1" tool-name="Gemini CLI" />

    <!-- 第二步：配置环境变量 -->
    <div class="mb-4 sm:mb-10 sm:mb-6">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >2</span
        >
        配置 Gemini CLI 环境变量
      </h4>
      <TutorialApiKeyInput>
        <strong>方式一：一键配置（推荐）。</strong>脚本会把中转地址、API Key
        和默认模型写成用户级环境变量（{{
          platform === 'windows' ? 'setx' : rcFile + ' 中带标记的一段'
        }}），并在 <code>{{ geminiSettingsPath }}</code> 中选定 API Key
        认证方式；重复执行只更新这一段，原文件备份为 <code>.bak</code>。
      </TutorialApiKeyInput>
      <div
        class="mb-4 rounded-lg border border-green-200 bg-white p-3 dark:border-green-700 dark:bg-gray-800 sm:mb-6 sm:p-4"
      >
        <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
          一键配置脚本
        </h6>
        <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
          模型：<code>{{ geminiModel }}</code
          >，地址：<code>{{ geminiBaseUrl }}</code
          >。在 {{ shellName }} 中整段粘贴执行：
        </p>
        <div class="tutorial-command-box">
          <div
            v-for="(line, index) in oneClickLines"
            :key="`gemini-${index}`"
            class="whitespace-nowrap text-gray-300"
          >
            {{ line }}
          </div>
        </div>
        <p class="mt-2 text-xs text-gray-600 dark:text-gray-400">
          💡 执行后<strong>重新打开一个{{ shellName }}窗口</strong>再运行
          <code>gemini</code>。首次在某个目录使用时 Gemini CLI 会询问是否信任该目录；非交互验证可用
          <code>gemini --skip-trust -p "你好"</code>。
        </p>
      </div>

      <p class="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
        方式二：手动设置环境变量
      </p>

      <div class="space-y-4">
        <!-- Windows -->
        <template v-if="platform === 'windows'">
          <div
            class="rounded-lg border border-green-200 bg-white p-3 dark:border-green-700 dark:bg-gray-800 sm:p-4"
          >
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              PowerShell 设置方法
            </h6>
            <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
              在 PowerShell 中运行以下命令：
            </p>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">
                $env:GOOGLE_GEMINI_BASE_URL = "{{ geminiBaseUrl }}"
              </div>
              <div class="whitespace-nowrap text-gray-300">$env:GEMINI_API_KEY = "你的API密钥"</div>
              <div class="whitespace-nowrap text-gray-300">
                $env:GEMINI_MODEL = "{{ geminiModel }}"
              </div>
            </div>
            <p class="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
              💡 使用与 Claude Code 相同的 API 密钥即可。
            </p>
          </div>

          <div
            class="rounded-lg border border-green-200 bg-white p-3 dark:border-green-700 dark:bg-gray-800 sm:p-4"
          >
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              PowerShell 永久设置（用户级）
            </h6>
            <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
              在 PowerShell 中运行以下命令：
            </p>
            <div class="tutorial-command-box mb-3">
              <div class="mb-2"># 设置用户级环境变量（永久生效）</div>
              <div class="whitespace-nowrap text-gray-300">
                [System.Environment]::SetEnvironmentVariable("GOOGLE_GEMINI_BASE_URL", "{{
                  geminiBaseUrl
                }}", [System.EnvironmentVariableTarget]::User)
              </div>
              <div class="whitespace-nowrap text-gray-300">
                [System.Environment]::SetEnvironmentVariable("GEMINI_API_KEY", "你的API密钥",
                [System.EnvironmentVariableTarget]::User)
              </div>
              <div class="whitespace-nowrap text-gray-300">
                [System.Environment]::SetEnvironmentVariable("GEMINI_MODEL", "{{ geminiModel }}",
                [System.EnvironmentVariableTarget]::User)
              </div>
            </div>
            <p class="mt-2 text-xs text-blue-700 dark:text-blue-300">
              💡 设置后需要重新打开 PowerShell 窗口才能生效。
            </p>
          </div>
        </template>

        <!-- macOS / Linux -->
        <template v-else>
          <div
            class="rounded-lg border border-green-200 bg-white p-3 dark:border-green-700 dark:bg-gray-800 sm:p-4"
          >
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              临时设置（当前会话）
            </h6>
            <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">在终端中运行以下命令：</p>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">
                export GOOGLE_GEMINI_BASE_URL="{{ geminiBaseUrl }}"
              </div>
              <div class="whitespace-nowrap text-gray-300">export GEMINI_API_KEY="你的API密钥"</div>
              <div class="whitespace-nowrap text-gray-300">
                export GEMINI_MODEL="gemini-2.5-pro"
              </div>
            </div>
            <p class="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
              💡 使用与 Claude Code 相同的 API 密钥即可。
            </p>
          </div>

          <div
            class="rounded-lg border border-green-200 bg-white p-3 dark:border-green-700 dark:bg-gray-800 sm:p-4"
          >
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              永久设置（Shell 配置文件）
            </h6>
            <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
              将以下内容添加到你的 shell 配置文件中（{{
                platform === 'macos' ? '~/.zshrc' : '~/.bashrc'
              }}）：
            </p>
            <div class="tutorial-command-box mb-3">
              <div class="whitespace-nowrap text-gray-300">
                export GOOGLE_GEMINI_BASE_URL="{{ geminiBaseUrl }}"
              </div>
              <div class="whitespace-nowrap text-gray-300">export GEMINI_API_KEY="你的API密钥"</div>
              <div class="whitespace-nowrap text-gray-300">
                export GEMINI_MODEL="gemini-2.5-pro"
              </div>
            </div>
            <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">然后执行：</p>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">
                source {{ platform === 'macos' ? '~/.zshrc' : '~/.bashrc' }}
              </div>
            </div>
          </div>
        </template>

        <!-- 验证 -->
        <div
          class="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-500/40 dark:bg-green-950/30 sm:p-4"
        >
          <h6 class="mb-2 font-medium text-green-800 dark:text-green-300">
            验证 Gemini CLI 环境变量
          </h6>
          <p class="mb-3 text-sm text-green-700 dark:text-green-300">
            {{ platform === 'windows' ? '在 PowerShell 中验证：' : '在终端中验证：' }}
          </p>
          <div class="tutorial-command-box space-y-1">
            <template v-if="platform === 'windows'">
              <div class="whitespace-nowrap text-gray-300">echo $env:GOOGLE_GEMINI_BASE_URL</div>
              <div class="whitespace-nowrap text-gray-300">echo $env:GEMINI_API_KEY</div>
              <div class="whitespace-nowrap text-gray-300">echo $env:GEMINI_MODEL</div>
            </template>
            <template v-else>
              <div class="whitespace-nowrap text-gray-300">echo $GOOGLE_GEMINI_BASE_URL</div>
              <div class="whitespace-nowrap text-gray-300">echo $GEMINI_API_KEY</div>
              <div class="whitespace-nowrap text-gray-300">echo $GEMINI_MODEL</div>
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useTutorialUrls } from '@/utils/useTutorialUrls'
import { filterModels, tutorialApiKey, useRelayModels } from '@/utils/useTutorialShared'
import { buildGeminiScript } from '@/utils/tutorialConfigScripts'
import NodeInstallTutorial from './NodeInstallTutorial.vue'
import TutorialApiKeyInput from './TutorialApiKeyInput.vue'

const props = defineProps({
  platform: {
    type: String,
    required: true,
    validator: (value) => ['windows', 'macos', 'linux'].includes(value)
  }
})

const { geminiBaseUrl } = useTutorialUrls()

const relayModels = useRelayModels()
const geminiModel = computed(
  () => filterModels(relayModels.gemini, /^gemini-/, [{ value: 'gemini-2.5-pro' }])[0].value
)

const shellName = computed(() => (props.platform === 'windows' ? 'PowerShell' : '终端'))
const rcFile = computed(() => (props.platform === 'macos' ? '~/.zshrc' : '~/.bashrc'))
const geminiSettingsPath = computed(() =>
  props.platform === 'windows' ? '%USERPROFILE%\\.gemini\\settings.json' : '~/.gemini/settings.json'
)

const oneClickLines = computed(() =>
  buildGeminiScript(props.platform, {
    baseUrl: geminiBaseUrl.value,
    apiKey: tutorialApiKey.value,
    model: geminiModel.value
  })
)
</script>
