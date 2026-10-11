# Model Pricing Data

本目录存放模型价格相关的随代码发布的数据文件。

## 价格来源

默认直接使用 LiteLLM 官方价格表（不再经过 `price-mirror` 镜像分支）：

- https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json

服务启动时及每 10 分钟用 HTTP `If-None-Match`（ETag）做条件请求，远端未变化时返回 304、不重复下载；
下载结果保存为 `data/model_pricing.json`（上游原始内容），ETag 保存为 `data/model_pricing.etag`。

如需改用自建镜像，设置 `PRICE_MIRROR_REPO` / `PRICE_MIRROR_BRANCH` / `PRICE_MIRROR_BASE_URL` 任一项
（沿用旧的 `<base>/model_prices_and_context_window.json` + `.sha256` 哈希校验），或用
`PRICE_MIRROR_JSON_URL` / `PRICE_MIRROR_HASH_URL` 直接指定完整地址（未配置哈希地址时自动使用 ETag）。

## 文件说明

| 文件                                   | 作用                                                                                               |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `model_prices_and_context_window.json` | LiteLLM 价格表快照，远端下载失败时作为兜底                                                         |
| `model_pricing_supplements.json`       | LiteLLM 原版缺失、但服务需要计费的模型（来自旧镜像）。**仅在上游没有该模型时补入**，不覆盖上游价格 |
| `model_pricing_overrides.example.json` | 旧镜像与 LiteLLM 价格不一致的条目示例，默认不生效                                                  |

## 合并优先级

内存中的价格表按以下顺序合并（后者覆盖前者）：

1. `model_pricing_supplements.json`（仅补缺失模型）
2. 上游价格表（`data/model_pricing.json`）
3. `data/model_pricing_overrides.json`（可选，运维手工维护，按模型逐字段覆盖）

以 `_` 开头的键会被忽略，可用于写注释。覆盖文件修改后，重启服务或等待价格文件下次重载后生效。

## 计费规则（对齐 LiteLLM）

- 服务档位：请求的 `service_tier`（`flex` / `priority` / `fast`→`priority` / `ultrafast`）存在对应的
  `*_<tier>` 价格键就使用，缺失时回退标准价格；`auto` / `default` / 未传按标准价格。
  不依赖 `supports_service_tier` 标记。
- 长上下文：非 Claude 模型按 `input_cost_per_token_above_<N>k_tokens` 阈值键选择价格（优先带档位的阈值键）。
  Claude 官方为统一价格，不套用阈值。
- 缓存价格缺失：非 Claude 模型按输入价计费；Claude 按官方倍率（写 5m 1.25x、写 1h 2x、读 0.1x）推导。

## 手动更新快照

```bash
curl -s https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json \
  -o resources/model-pricing/model_prices_and_context_window.json
```

Last updated: 2026-10-11
