# service-process-supervision

## ADDED Requirements

### Requirement: 应用进程由 systemd 托管
relay 应用 SHALL 由 systemd unit 托管运行，MUST NOT 以裸 `nohup` 方式长期运行。unit SHALL 配置 `Restart=always`，使进程以退出码 0 主动退出后仍被重新拉起（这是升级换代码的机制依赖）；`Restart=on-failure` MUST NOT 被用于本服务。

#### Scenario: 主动退出后自动以新代码拉起
- **WHEN** 应用在升级末步执行 `process.exit(0)`
- **THEN** systemd SHALL 重新启动服务，且新进程加载升级后的代码

#### Scenario: 异常崩溃自动恢复
- **WHEN** 进程因未捕获异常或 OOM 非正常退出
- **THEN** systemd SHALL 重新拉起服务，MUST NOT 出现无人恢复的永久宕机

#### Scenario: 显式停止不被自动拉起
- **WHEN** 运维执行 `systemctl stop`
- **THEN** 服务保持停止状态，MUST NOT 被 `Restart=always` 重新拉起

### Requirement: unit 配置对运行环境的正确性
unit SHALL 设置 `WorkingDirectory` 为应用根目录（`config/config.js` 通过 `dotenv` 从 cwd 加载 `.env`）；MUST NOT 硬编码随 node 版本变化的 nvm 具体版本路径；运行用户 SHALL 与现状一致以避免 `node_modules`、`dist`、`data`、`logs` 的属主漂移。

#### Scenario: 环境变量正确加载
- **WHEN** 服务由 systemd 启动
- **THEN** `.env` 中的配置（含 `REDIS_PORT=6380`、`METADATA_BACKEND=sqlite`）MUST 生效，行为与手工启动一致

#### Scenario: node 版本升级后 unit 仍可用
- **WHEN** node 从 v24.15.0 升级到其他版本、nvm 路径随之变化
- **THEN** unit MUST 仍能定位可执行的 node，无需编辑 unit 文件

### Requirement: 进程管理职责单一
引入 systemd 后，进程生命周期 SHALL 仅由 systemd 管理。`scripts/manage.js` 的守护态子命令（后台启动、停止、重启、状态）SHALL 委派至 systemd 或明确标注不再用于守护态，MUST NOT 与 systemd 并行维护另一套 PID 文件状态。

#### Scenario: 状态查询不出现双份真相
- **WHEN** 服务由 systemd 运行，管理员执行 `manage.js status`
- **THEN** 输出 MUST 反映 systemd 的真实状态，MUST NOT 因自有 PID 文件缺失而误报「未运行」

#### Scenario: 切换期不出现双进程
- **WHEN** 从既有 nohup 进程切换到 systemd 托管
- **THEN** 切换过程 MUST 确认旧进程已退出且 28088 端口已释放，之后再启动 unit
