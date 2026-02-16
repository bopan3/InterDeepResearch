# Card 组件文档

## 1. 概述

Card 组件是 Visual Deep Research 前端应用中的核心组件，用于可视化研究过程中的各个任务节点。每个卡片代表一个研究任务或结果，可以通过连接线表示它们之间的关系。卡片系统支持创建、编辑、连接和状态管理等功能。

## 2. 卡片数据结构

### 2.1 Card 接口定义

```typescript
interface Card {
  card_id: string;                // 卡片唯一标识符
  card_topic: string;             // 卡片标题
  card_task: string;              // 卡片任务描述
  card_ref: CardRef[];            // 卡片引用关系
  card_status: CardStatus;        // 卡片状态
  output_type: 'Report' | 'Source'; // 卡片输出类型
  output_summary: string | null;  // 输出摘要
  output_content: string | null;  // 输出内容
  output_cite: CitationSource[] | null; // 引用来源
  position?: { x: number; y: number }; // 卡片在画布中的位置
}

// 卡片引用接口
interface CardRef {
  target_card_id: string;         // 引用的目标卡片ID
}

// 引用来源接口
interface CitationSource {
  web_source_link: string;        // 网页来源链接
  source_snippet: string;         // 来源摘要
  source_content: string;         // 来源内容
  supporting_clips: {             // 支持片段
    from_source_snippet: string[];
    from_source_content: string[];
  };
}

// 卡片状态类型
type CardStatus = 'creating' | 'executing' | 'finished';
```

### 2.2 CardNode 组件数据结构

```typescript
interface CardNodeData {
  cardId: string;                 // 卡片ID
  title: string;                  // 卡片标题
  content: string;                // 卡片内容
  status: CardStatus;             // 卡片状态
  originalTask: string;           // 原始任务描述
  output_type: 'Report' | 'Source'; // 输出类型
}
```

## 3. 卡片状态和生命周期

卡片有四种状态，每种状态对应不同的视觉效果和交互行为：

1. **creating**: 系统创建中状态，显示加载动画，内容为任务描述
2. **executing**: 执行中状态，显示加载动画，内容为任务描述
3. **finished**: 完成状态，显示输出内容，不可编辑

卡片生命周期：
- 创建 → 编辑内容 → 确认创建 → 执行任务 → 完成

## 4. 卡片交互功能

### 4.1 创建卡片

卡片创建有两种方式：
- **用户手动创建**：在ReactFlow画布上点击创建（需开启创建模式）
- **系统自动创建**：通过API响应自动创建卡片

创建流程：
1. 用户开启创建模式（点击右上角"创建模式"按钮）
2. 在画布空白处点击
3. 系统调用`cardStore.createNewCard(position)`创建新卡片

### 4.2 编辑卡片

只有`creating`状态的卡片可以编辑：
1. 点击卡片上的编辑按钮（铅笔图标）
2. 打开编辑模态框
3. 修改内容并保存
4. 系统调用`cardStore.updateCard()`更新卡片内容

### 4.3 确认卡片

#### 4.3.1 用户创建的卡片确认

用户创建的卡片需要确认后才会执行：
1. 点击卡片右上角的确认按钮（✓图标）
2. 系统调用`cardStore.updateCardStatus(cardId, 'executing')`
3. 卡片状态变为`executing`，开始执行任务

#### 4.3.2 后端创建的卡片确认

对于状态为`creating`（由后端创建）的卡片，用户确认流程：
1. 用户点击卡片上的确认按钮
2. 系统向后端发送`f2b_confirm_card`事件
3. 事件参数包含完整的卡片信息，格式如下：
```json
{
    "project_id": "1",
    "confirm_card": {
        "card_id": "1",
        "card_topic": "中国中产现状分析",
        "card_task": "收集整理目前中国9阶层实际收入和财务状况，特别研究得出中国的中产有哪些特点，实际中产人数，财力等等",
        "card_ref": [],
        "card_status": "creating",
        "output_type": "Report",
        "output_summary": null,
        "output_content": null,
        "output_cite": null
    }
}
```

**注意**：发送给后端的卡片信息保持原样，不做任何修改。如果卡片原本有引用关系(`card_ref`)，则保留这些引用关系一并发送。

### 4.4 卡片连接

卡片之间可以建立连接关系：
1. 从源卡片底部的连接点拖动到目标卡片顶部的连接点
2. 系统调用`cardStore.addCardConnection(sourceId, targetId)`
3. 连接关系保存在目标卡片的`card_ref`数组中
4. 连接线根据卡片状态显示不同样式

### 4.5 引用处理

卡片内容中可以包含两种引用：
- **卡片引用**：格式为`<cardId>ID</cardId>`，显示为卡片链接
- **引用来源**：格式为`<citeId>ID</citeId/>`，显示为引用链接

点击引用来源可以创建Source卡片：
1. 点击引用链接
2. 弹出确认对话框
3. 确认后调用`cardStore.createSourceCard(cardId, citeId)`
4. 系统创建新的Source类型卡片

## 5. CardStore 与卡片交互

CardStore是管理卡片数据的核心存储，提供以下功能：

### 5.1 卡片管理方法

- `addCard(card)`: 添加新卡片
- `updateCard(cardId, updates)`: 更新卡片属性
- `updateCardStatus(cardId, status)`: 更新卡片状态
- `removeCard(cardId)`: 删除卡片
- `updateCardsWithDiff(newCards)`: 差异化更新卡片列表

### 5.2 卡片创建方法

- `createNewCard(position)`: 创建新的用户卡片
- `createSourceCard(targetCardId, citeId)`: 创建引用来源卡片

### 5.3 卡片连接管理

- `addCardConnection(sourceCardId, targetCardId)`: 添加卡片连接
- `removeCardConnection(sourceCardId, targetCardId)`: 移除卡片连接

### 5.4 卡片查询方法

- `getCard(cardId)`: 获取指定ID的卡片
- `getCardsByStatus(status)`: 获取指定状态的卡片
- `get cardList()`: 获取所有卡片列表
- `get executingCardsCount()`: 获取执行中卡片数量
- `get finishedCardsCount()`: 获取已完成卡片数量

## 6. ReactFlow 与卡片视图

ReactFlowView组件负责卡片的可视化展示和交互：

### 6.1 节点和边的生成

- 从cardStore获取卡片数据生成节点
- 从卡片引用关系生成边
- 使用自定义CardNode组件渲染节点

### 6.2 布局功能

- 支持ELK自动布局算法
- 支持手动拖拽调整位置
- 位置变化自动保存到CardStore

### 6.3 交互功能

- 创建模式开关
- 连接节点
- 删除连接
- 点击空白区域创建卡片

## 7. 卡片样式和视觉效果

卡片根据状态显示不同的视觉效果：
- **creating**: 蓝色边框，显示加载动画和编辑按钮
- **executing**: 黄色边框，显示加载动画
- **finished**: 绿色边框，显示完成状态

连接线也根据卡片状态显示不同样式：
- 如果连接的卡片有creating状态，显示蓝色虚线
- 其他状态显示灰色虚线

## 8. 总结

Card组件系统是Visual Deep Research应用的核心功能，通过可视化的卡片和连接，展示研究过程中的任务和结果。系统支持丰富的交互功能，包括创建、编辑、连接和状态管理，为用户提供直观的研究体验。