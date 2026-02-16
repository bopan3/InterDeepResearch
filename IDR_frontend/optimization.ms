Optimization plan for IDR_frontend
===========================================

Context
-------
- 前端在卡片数量增多时出现卡顿，主要集中在卡片节点渲染、详情展示和 ReactFlow 布局。
- 代码参考：`src/pages/main/components/CardNode.tsx`, `DetailView.tsx`, `ReactFlowView.tsx` 等。

主要瓶颈与成因
--------------
1) 反复的 Markdown 解析与渲染
   - `CardNode` 和 `DetailView` 内部每次渲染都会重新做 Markdown/AST 解析与 ReactMarkdown 渲染。
   - 引用/Excerpt 解析使用正则 + AST，在卡片多时线性累积 CPU。

2) 大量观察器与事件监听
   - `CardNode` 的 citation `<span>` 为每个引用挂 `MutationObserver` + `ResizeObserver` + 事件监听。引用多/卡片多时，观察器数量指数增长，布局或样式变化触发大量回调。

3) 组件过度观察/重渲染
   - `CardNode`, `DetailView`, `ReactFlowView` 都是 `observer` 组件，依赖 store 变化时整体重渲染。`cardStore.lastUpdateTimestamp`/全量 card 对象变化会让所有节点刷新。
   - 传入子组件的回调/对象缺少 memo/stable 引用，导致子组件 diff 失败。

4) ReactFlow 节点/边数量线性增长
   - 没有列表/节点虚拟化，所有卡片都挂在 ReactFlow 中，DOM 和计算成本随规模快速上升。
   - 节点宽度测量、ELK 布局、多次 setState（如折叠状态切换）会触发布局重算。

5) 详情视图渲染开销
   - `DetailView` 对长内容重复跑 Markdown + 高亮逻辑，没有懒加载/折叠，且包含 trace 按钮定位、滚动监听。

6) 事件节流/批处理不足
   - 滚动、选择、布局更新等回调多数未节流，频繁触发时增加主线程压力。

针对性的优化方案
----------------
高优先级（快速收益）
- Markdown 结果缓存：按 `card_id + updated_at` 缓存解析结果；组件中 `useMemo` 读取，避免每次渲染重算。
- 子组件 `React.memo` + 自定义比较：正文区单独拆分组件，只比较内容哈希/版本号，避免因父级状态变化重渲。
- 稳定 props：对传入子组件的回调/对象使用 `useCallback`/`useMemo` 固定引用，减少不必要的 diff。
- 限制 citation 观察器：合并为单个共享 `ResizeObserver`/`MutationObserver` 或仅在可见/hover 时启用；减少每 citation 的独立实例。
- 列表/节点虚拟化：对卡片列表/ReactFlow 视图引入虚拟化或分页；至少默认折叠旧卡和长文本。

中优先级（结构性改进）
- Store 粒度拆分：将大 store 的变化拆分为局部 observable，避免一个时间戳让所有卡片 rerender。
- 渲染分层：交互层（选中/hover）与正文渲染层拆分；交互变化不触发正文重渲。
- 布局与测量去抖：对宽度/高度测量、ELK 布局触发加 debounce/throttle，合并连续 setState。
- 详情懒加载：DetailView 对长内容做折叠+“展开全文”，Markdown 懒渲染；切换卡片时复用缓存。

低优先级（进一步打磨）
- 使用 `useDeferredValue`/`startTransition` 平滑大列表状态切换。
- Web Worker 预解析 Markdown（如数据量特别大时）。
- 仅在需要时开启 trace 支持的定位/滚动监听，其他情况禁用。

落地建议（执行顺序）
-------------------
1) 缓存 Markdown 解析结果（工具函数 + store 缓存），正文组件 `React.memo`。
2) 稳定 props：梳理 `CardNode`/`DetailView`/`ReactFlowView` 对子组件的回调与数据引用，全部 memo。
3) 合并/精简 citation 观察器，减少监听器数量。
4) 为卡片列表/ReactFlow 引入虚拟化或强制折叠策略；长文本默认折叠。
5) 对布局/测量/滚动等事件加 throttle/debounce，避免频繁重算。

