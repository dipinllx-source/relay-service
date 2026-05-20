<template>
  <div class="tutorial-content">
    <!-- 第一步：安装 Node.js -->
    <NodeInstallTutorial :platform="platform" :step-number="1" tool-name="Claude Code" />

    <!-- 第二步：安装 Claude Code -->
    <div class="mb-4 sm:mb-10 sm:mb-6">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-green-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >2</span
        >
        安装 Claude Code
      </h4>

      <div
        class="mb-4 rounded-xl border border-green-100 bg-gradient-to-r from-green-50 to-emerald-50 p-4 dark:border-green-500/40 dark:from-green-950/30 dark:to-emerald-950/30 sm:mb-6 sm:p-6"
      >
        <h5
          class="mb-2 flex items-center text-base font-semibold text-gray-800 dark:text-gray-200 sm:mb-3 sm:text-lg"
        >
          <i class="fas fa-download mr-2 text-green-600" />
          安装 Claude Code
        </h5>
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
          {{ platform === 'windows' ? '打开 PowerShell 或 CMD' : '打开终端' }}，运行以下命令：
        </p>
        <div class="tutorial-command-box mb-4">
          <div class="mb-2"># 全局安装 Claude Code</div>
          <div class="whitespace-nowrap text-gray-300">
            npm install -g @anthropic-ai/claude-code
          </div>
        </div>
        <p class="text-sm text-gray-600 dark:text-gray-400">
          这个命令会从 npm 官方仓库下载并安装最新版本的 Claude Code。
        </p>

        <div
          class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-950/30 sm:p-4"
        >
          <h6 class="mb-2 text-sm font-medium text-amber-800 dark:text-amber-300 sm:text-base">
            中国大陆网络环境（可选）
          </h6>
          <p class="mb-3 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
            如果访问 npm 官方仓库较慢或超时，可以临时使用 npmmirror 镜像安装：
          </p>
          <div class="tutorial-command-box mb-4">
            <div class="mb-2"># 方法一：本次安装临时使用镜像（推荐）</div>
            <div class="whitespace-nowrap text-gray-300">
              npm install -g @anthropic-ai/claude-code --registry=https://registry.npmmirror.com
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
            <div class="whitespace-nowrap text-gray-300">
              npm install -g @anthropic-ai/claude-code
            </div>
            <div class="whitespace-nowrap text-gray-300">
              npm config set registry https://registry.npmjs.org/
            </div>
          </div>

          <ul class="mt-3 space-y-1 text-xs text-amber-700 dark:text-amber-300 sm:text-sm">
            <li>• 如果提示原生平台包缺失，请确认镜像已经同步最新版本后重试</li>
            <li>
              • 请确保 npm 没有禁用 optional dependencies，否则 Claude Code 原生二进制可能不会被安装
            </li>
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
              <li>• 建议使用 PowerShell 而不是 CMD，功能更强大</li>
              <li>• 如果遇到权限问题，以管理员身份运行 PowerShell</li>
            </template>
            <template v-else-if="platform === 'macos'">
              <li>• 不建议使用 sudo 安装全局 npm 包</li>
              <li>• 如果遇到权限问题，优先使用 nvm 或修复 npm 全局安装目录</li>
            </template>
            <template v-else>
              <li>• 使用 nvm 安装的 Node.js 可以避免 sudo</li>
              <li>• WSL2 用户确保在 Linux 子系统中运行</li>
            </template>
          </ul>
        </div>
      </div>

      <!-- 验证安装 -->
      <div
        class="rounded-lg border border-green-200 bg-green-50 p-3 dark:border-green-500/40 dark:bg-green-950/30 sm:p-4"
      >
        <h6 class="mb-2 font-medium text-green-800 dark:text-green-300">验证 Claude Code 安装</h6>
        <p class="mb-3 text-sm text-green-700 dark:text-green-300">
          安装完成后，输入以下命令检查是否安装成功：
        </p>
        <div class="tutorial-command-box">
          <div class="whitespace-nowrap text-gray-300">claude --version</div>
        </div>
        <p class="mt-2 text-sm text-green-700 dark:text-green-300">
          如果显示版本号，恭喜你！Claude Code 已经成功安装了。
        </p>
      </div>
    </div>

    <!-- 第三步：设置环境变量 -->
    <div class="mb-6 sm:mb-10">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-purple-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >3</span
        >
        设置环境变量
      </h4>

      <div
        class="mb-4 rounded-xl border border-purple-100 bg-gradient-to-r from-purple-50 to-pink-50 p-4 dark:border-purple-500/40 dark:from-purple-950/30 dark:to-pink-950/30 sm:mb-6 sm:p-6"
      >
        <h5
          class="mb-2 flex items-center text-base font-semibold text-gray-800 dark:text-gray-200 sm:mb-3 sm:text-lg"
        >
          <i class="fas fa-cog mr-2 text-purple-600" />
          配置 Claude Code 环境变量
        </h5>
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
          为了让 Claude Code 连接到你的中转服务，需要设置两个环境变量：
        </p>

        <div class="space-y-4">
          <!-- Windows 环境变量设置 -->
          <template v-if="platform === 'windows'">
            <div
              class="rounded-lg border border-purple-200 bg-white p-3 dark:border-purple-700 dark:bg-gray-800 sm:p-4"
            >
              <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
                方法一：PowerShell 临时设置（当前会话）
              </h6>
              <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
                在 PowerShell 中运行以下命令：
              </p>
              <div class="tutorial-command-box">
                <div class="whitespace-nowrap text-gray-300">
                  $env:ANTHROPIC_BASE_URL = "{{ currentBaseUrl }}"
                </div>
                <div class="whitespace-nowrap text-gray-300">
                  $env:ANTHROPIC_AUTH_TOKEN = "你的API密钥"
                </div>
              </div>
              <p class="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
                💡 记得将 "你的API密钥" 替换为在上方 "API Keys" 标签页中创建的实际密钥。
              </p>
            </div>

            <div
              class="rounded-lg border border-purple-200 bg-white p-3 dark:border-purple-700 dark:bg-gray-800 sm:p-4"
            >
              <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
                方法二：PowerShell 永久设置（用户级）
              </h6>
              <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
                在 PowerShell 中运行以下命令设置用户级环境变量：
              </p>
              <div class="tutorial-command-box mb-3">
                <div class="mb-2"># 设置用户级环境变量（永久生效）</div>
                <div class="whitespace-nowrap text-gray-300">
                  [System.Environment]::SetEnvironmentVariable("ANTHROPIC_BASE_URL", "{{
                    currentBaseUrl
                  }}", [System.EnvironmentVariableTarget]::User)
                </div>
                <div class="whitespace-nowrap text-gray-300">
                  [System.Environment]::SetEnvironmentVariable("ANTHROPIC_AUTH_TOKEN",
                  "你的API密钥", [System.EnvironmentVariableTarget]::User)
                </div>
              </div>
              <p class="mt-2 text-xs text-blue-700 dark:text-blue-300">
                💡 设置后需要重新打开 PowerShell 窗口才能生效。
              </p>
            </div>
          </template>

          <!-- macOS / Linux 环境变量设置 -->
          <template v-else>
            <div
              class="rounded-lg border border-purple-200 bg-white p-3 dark:border-purple-700 dark:bg-gray-800 sm:p-4"
            >
              <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
                方法一：临时设置（当前会话）
              </h6>
              <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">在终端中运行以下命令：</p>
              <div class="tutorial-command-box">
                <div class="whitespace-nowrap text-gray-300">
                  export ANTHROPIC_BASE_URL="{{ currentBaseUrl }}"
                </div>
                <div class="whitespace-nowrap text-gray-300">
                  export ANTHROPIC_AUTH_TOKEN="你的API密钥"
                </div>
              </div>
              <p class="mt-2 text-xs text-yellow-700 dark:text-yellow-400">
                💡 记得将 "你的API密钥" 替换为在上方 "API Keys" 标签页中创建的实际密钥。
              </p>
            </div>

            <div
              class="rounded-lg border border-purple-200 bg-white p-3 dark:border-purple-700 dark:bg-gray-800 sm:p-4"
            >
              <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
                方法二：永久设置（Shell 配置文件）
              </h6>
              <p class="mb-3 text-sm text-gray-600 dark:text-gray-400">
                将以下内容添加到你的 shell 配置文件中（{{
                  platform === 'macos' ? '~/.zshrc' : '~/.bashrc'
                }}）：
              </p>
              <div class="tutorial-command-box mb-3">
                <div class="whitespace-nowrap text-gray-300">
                  export ANTHROPIC_BASE_URL="{{ currentBaseUrl }}"
                </div>
                <div class="whitespace-nowrap text-gray-300">
                  export ANTHROPIC_AUTH_TOKEN="你的API密钥"
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

          <div
            class="rounded-lg border border-cyan-200 bg-cyan-50 p-3 dark:border-cyan-500/40 dark:bg-cyan-950/30 sm:p-4"
          >
            <h6 class="mb-2 text-sm font-medium text-cyan-800 dark:text-cyan-300 sm:text-base">
              IPv4 映射 IPv6 格式（可选）
            </h6>
            <p class="mb-3 text-sm text-cyan-700 dark:text-cyan-300">
              如果需要使用 IPv4 映射 IPv6 格式访问中转服务，请使用
              <code class="rounded bg-cyan-100 px-1 dark:bg-cyan-900">[::ffff:ipv4]:port</code>
              ，路径仍然保持
              <code class="rounded bg-cyan-100 px-1 dark:bg-cyan-900">/api</code>：
            </p>
            <div class="tutorial-command-box">
              <template v-if="platform === 'windows'">
                <div class="whitespace-nowrap text-gray-300">
                  $env:ANTHROPIC_BASE_URL = "{{ ipv6CurrentBaseUrl }}"
                </div>
                <div class="whitespace-nowrap text-gray-300">
                  $env:ANTHROPIC_AUTH_TOKEN = "你的API密钥"
                </div>
              </template>
              <template v-else>
                <div class="whitespace-nowrap text-gray-300">
                  export ANTHROPIC_BASE_URL="{{ ipv6CurrentBaseUrl }}"
                </div>
                <div class="whitespace-nowrap text-gray-300">
                  export ANTHROPIC_AUTH_TOKEN="你的API密钥"
                </div>
              </template>
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
      </div>

      <!-- VSCode 插件配置 -->
      <div
        class="mt-6 rounded-lg border border-indigo-200 bg-indigo-50 p-3 dark:border-indigo-500/40 dark:bg-indigo-950/30 sm:p-4"
      >
        <h6 class="mb-2 font-medium text-indigo-800 dark:text-indigo-300">
          VSCode Claude 插件配置
        </h6>
        <p class="mb-3 text-sm text-indigo-700 dark:text-indigo-300">
          如果使用 VSCode 的 Claude 插件，需要在配置文件中进行设置：
        </p>
        <div class="mb-3 space-y-2">
          <p class="text-sm text-indigo-700 dark:text-indigo-300">
            <strong>配置文件位置：</strong>
            <code class="rounded bg-indigo-100 px-1 dark:bg-indigo-900">{{
              platform === 'windows'
                ? 'C:\\Users\\你的用户名\\.claude\\config.json'
                : '~/.claude/config.json'
            }}</code>
          </p>
          <p class="text-xs text-indigo-600 dark:text-indigo-400">
            💡 如果该文件不存在，请手动创建。
          </p>
        </div>
        <div class="tutorial-code-box">
          <div class="whitespace-nowrap text-gray-300">{</div>
          <div class="whitespace-nowrap text-gray-300">"primaryApiKey": "crs"</div>
          <div class="whitespace-nowrap text-gray-300">}</div>
        </div>
      </div>

      <!-- 验证环境变量设置 -->
      <div
        class="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-500/40 dark:bg-blue-950/30 sm:p-4"
      >
        <h6 class="mb-2 font-medium text-blue-800 dark:text-blue-300">验证环境变量设置</h6>
        <p class="mb-3 text-sm text-blue-700 dark:text-blue-300">
          设置完环境变量后，可以通过以下命令验证是否设置成功：
        </p>

        <div class="space-y-4">
          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              {{ platform === 'windows' ? '在 PowerShell 中验证：' : '在终端中验证：' }}
            </h6>
            <div class="tutorial-command-box space-y-1">
              <template v-if="platform === 'windows'">
                <div class="whitespace-nowrap text-gray-300">echo $env:ANTHROPIC_BASE_URL</div>
                <div class="whitespace-nowrap text-gray-300">echo $env:ANTHROPIC_AUTH_TOKEN</div>
              </template>
              <template v-else>
                <div class="whitespace-nowrap text-gray-300">echo $ANTHROPIC_BASE_URL</div>
                <div class="whitespace-nowrap text-gray-300">echo $ANTHROPIC_AUTH_TOKEN</div>
              </template>
            </div>
          </div>
        </div>

        <div class="mt-3 space-y-2">
          <p class="text-sm text-blue-700 dark:text-blue-300">
            <strong>预期输出示例：</strong>
          </p>
          <div class="tutorial-code-box">
            <div>{{ currentBaseUrl }}</div>
            <div>cr_xxxxxxxxxxxxxxxxxx</div>
          </div>
          <p class="text-xs text-blue-700 dark:text-blue-300">
            💡 如果输出为空或显示变量名本身，说明环境变量设置失败，请重新设置。
          </p>
        </div>
      </div>
    </div>

    <!-- 第四步：开始使用 -->
    <div class="mb-6 sm:mb-8">
      <h4
        class="mb-3 flex items-center text-lg font-semibold text-gray-800 dark:text-gray-300 sm:mb-4 sm:text-xl"
      >
        <span
          class="tutorial-step-marker mr-2 flex h-6 w-6 items-center justify-center rounded-full bg-orange-500 text-xs font-bold text-white sm:mr-3 sm:h-8 sm:w-8 sm:text-sm"
          >4</span
        >
        开始使用 Claude Code
      </h4>
      <div
        class="rounded-xl border border-orange-100 bg-gradient-to-r from-orange-50 to-yellow-50 p-4 dark:border-orange-500/40 dark:from-orange-950/30 dark:to-yellow-950/30 sm:p-6"
      >
        <p class="mb-3 text-sm text-gray-700 dark:text-gray-300 sm:mb-4 sm:text-base">
          现在你可以开始使用 Claude Code 了！
        </p>

        <div class="space-y-4">
          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              交互式启动
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">claude</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              在特定项目中使用
            </h6>
            <div class="tutorial-command-box">
              <div class="mb-2"># 进入你的项目目录</div>
              <div class="whitespace-nowrap text-gray-300">
                cd
                {{
                  platform === 'windows' ? 'C:\\path\\to\\your\\project' : '/path/to/your/project'
                }}
              </div>
              <div class="mb-2 mt-2"># 启动 Claude Code</div>
              <div class="whitespace-nowrap text-gray-300">claude</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              带初始问题启动
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">claude "请先帮我理解这个项目结构"</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              一次性询问并退出（适合验证配置）
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">claude -p "用一句话介绍当前项目"</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              继续或恢复会话
            </h6>
            <div class="tutorial-command-box">
              <div class="mb-2"># 继续当前目录最近一次会话</div>
              <div class="whitespace-nowrap text-gray-300">claude -c</div>
              <div class="mb-2 mt-2"># 使用会话 ID 恢复指定会话</div>
              <div class="whitespace-nowrap text-gray-300">
                claude -r "abc123" "继续完成上次的任务"
              </div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              诊断安装和环境
            </h6>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">claude doctor</div>
            </div>
          </div>

          <div>
            <h6 class="mb-2 text-sm font-medium text-gray-800 dark:text-gray-300 sm:text-base">
              使用当前中转服务临时启动
            </h6>
            <p class="mb-2 text-xs text-gray-600 dark:text-gray-400 sm:text-sm">
              如果不想永久写入环境变量，可以在当前终端会话中设置后直接启动：
            </p>
            <div class="tutorial-command-box">
              <template v-if="platform === 'windows'">
                <div class="whitespace-nowrap text-gray-300">
                  $env:ANTHROPIC_BASE_URL = "{{ currentBaseUrl }}"
                </div>
                <div class="whitespace-nowrap text-gray-300">
                  $env:ANTHROPIC_AUTH_TOKEN = "你的API密钥"
                </div>
                <div class="whitespace-nowrap text-gray-300">claude</div>
              </template>
              <template v-else>
                <div class="whitespace-nowrap text-gray-300">
                  export ANTHROPIC_BASE_URL="{{ currentBaseUrl }}"
                </div>
                <div class="whitespace-nowrap text-gray-300">
                  export ANTHROPIC_AUTH_TOKEN="你的API密钥"
                </div>
                <div class="whitespace-nowrap text-gray-300">claude</div>
              </template>
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
            安装时提示 "permission denied" 错误
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">这通常是权限问题，尝试以下解决方法：</p>
            <ul class="list-inside list-disc space-y-1 text-sm">
              <template v-if="platform === 'windows'">
                <li>以管理员身份运行 PowerShell</li>
                <li>
                  或者配置 npm 使用用户目录：<code
                    class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                    >npm config set prefix %APPDATA%\npm</code
                  >
                </li>
              </template>
              <template v-else>
                <li>不建议直接依赖 sudo 安装全局 npm 包</li>
                <li>优先使用 nvm，或修复 npm 全局安装目录权限</li>
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
            安装后提示 native binary not found 或 claude 命令不可用
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">这通常与 Claude Code 的平台原生包或 npm optional dependencies 有关：</p>
            <ul class="list-inside list-disc space-y-1 text-sm">
              <li>
                确认 npm 没有使用
                <code class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                  >--omit=optional</code
                >
                或禁用 optional dependencies
              </li>
              <li>如果使用镜像源，请等待镜像同步完成后重新安装</li>
              <li>
                重新安装后再次执行
                <code class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                  >claude --version</code
                >
                或
                <code class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                  >claude doctor</code
                >
              </li>
            </ul>
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

        <details
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            环境变量设置后不生效
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">设置永久环境变量后需要：</p>
            <ul class="list-inside list-disc space-y-1 text-sm">
              <template v-if="platform === 'windows'">
                <li>重新启动 PowerShell 或 CMD</li>
                <li>或者注销并重新登录 Windows</li>
                <li>
                  验证设置：<code
                    class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                    >echo $env:ANTHROPIC_BASE_URL</code
                  >
                </li>
              </template>
              <template v-else>
                <li>重新打开终端窗口</li>
                <li>
                  或者执行
                  <code class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                    >source {{ platform === 'macos' ? '~/.zshrc' : '~/.bashrc' }}</code
                  >
                </li>
                <li>
                  验证设置：<code
                    class="rounded bg-gray-200 px-1 text-xs dark:bg-gray-700 sm:text-sm"
                    >echo $ANTHROPIC_BASE_URL</code
                  >
                </li>
              </template>
            </ul>
          </div>
        </details>

        <details
          v-if="platform === 'linux'"
          class="rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800"
        >
          <summary
            class="cursor-pointer p-3 text-sm font-medium text-gray-800 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700 sm:p-4 sm:text-base"
          >
            WSL2 中无法访问 Windows 文件
          </summary>
          <div class="px-3 pb-3 text-gray-600 dark:text-gray-400 sm:px-4 sm:pb-4">
            <p class="mb-2">WSL2 可以通过 /mnt/ 路径访问 Windows 文件：</p>
            <div class="tutorial-command-box">
              <div class="whitespace-nowrap text-gray-300">cd /mnt/c/Users/你的用户名/项目目录</div>
            </div>
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

const { currentBaseUrl, ipv6CurrentBaseUrl } = useTutorialUrls()

const platformName = computed(() => {
  const names = { windows: 'Windows', macos: 'macOS', linux: 'Linux / WSL2' }
  return names[props.platform]
})
</script>
