# IDR Frontend 架构介绍

## 1. 项目概述

IDR Frontend 是 Visual Deep Research 项目的前端，采用现代化的 React 技术栈和 TypeScript 构建。该项目旨在提供一个可视化的研究工具，支持用户进行深度研究和数据分析。

## 2. 技术栈

项目采用以下核心技术：

- **框架**: React 18
- **语言**: TypeScript
- **状态管理**: MobX
- **路由**: React Router v7
- **UI 组件库**: Material-UI (MUI)
- **样式处理**: SCSS
- **数据可视化**: D3.js, ReactFlow
- **网络通信**: Socket.io-client
- **构建工具**: React Scripts (基于 Create React App)

## 3. 项目结构

```
IDR_frontend/
├── public/                 # 静态资源
├── src/                    # 源代码
│   ├── App.tsx             # 应用入口组件
│   ├── api.tsx             # API 交互层
│   ├── index.tsx           # 应用渲染入口
│   ├── pages/              # 页面组件
│   │   ├── api-test/       # API 测试页面
│   │   └── main/           # 主界面
│   ├── stores/             # 状态管理
│   │   ├── CardStore.ts    # 卡片数据管理
│   │   ├── ChatStore.ts    # 聊天数据管理
│   │   ├── HistoryStore.ts # 历史记录管理
│   │   └── index.ts        # Store 导出
│   └── styles/             # 全局样式
└── tsconfig.json           # TypeScript 配置
```

## 4. 核心架构

### 4.1 应用架构

项目采用组件化架构，主要分为以下几个部分：

1. **路由层**: 通过 React Router 实现页面路由，支持主页面和 API 测试页面的切换
2. **状态管理层**: 使用 MobX 进行响应式状态管理
3. **UI 组件层**: 基于 Material-UI 构建统一的用户界面
4. **API 交互层**: 通过 Socket.io 实现与后端的实时通信

### 4.2 页面结构

主要页面包括：

- **MainLayout**: 主界面布局，包含历史记录、可视化流程图和聊天界面
- **ApiTestPage**: API 测试页面，用于开发和调试后端接口

### 4.3 组件设计

主界面由三个主要组件构成：

1. **HistoryView**: 显示历史研究项目列表
2. **ReactFlowView**: 可视化流程图，展示研究过程和数据关系
3. **ChatView**: 聊天界面，用于与系统交互

## 5. 状态管理

项目使用 MobX 进行状态管理，主要包含三个 Store：

1. **ChatStore**: 管理聊天消息数据
   - 存储用户与系统的对话历史
   - 提供添加和更新消息的方法

2. **CardStore**: 管理卡片数据
   - 存储研究过程中生成的数据卡片
   - 管理卡片之间的引用关系

3. **HistoryStore**: 管理历史项目
   - 存储用户的历史研究项目
   - 提供项目切换和管理功能

## 6. API 交互

项目通过 Socket.io 与后端进行实时通信：

1. **连接管理**: 处理 WebSocket 连接的建立、断开和重连
2. **消息处理**: 发送用户消息并接收系统响应
3. **数据同步**: 实时同步卡片数据和研究进度

主要通信事件包括：
- `connection_established`: 连接建立
- `disconnect`: 连接断开
- `message`: 接收消息
- `card_update`: 卡片数据更新
- `research_progress`: 研究进度更新

## 7. 主题与样式

项目使用 Material-UI 的 ThemeProvider 实现全局主题定制：

- **主色调**: #7BBCBE (青绿色)
- **次要色**: #6c757d (灰色)
- **背景色**: #ffffff (白色) / #f8f9fa (浅灰色)

样式处理采用 SCSS 与 Material-UI 的 styled 组件相结合的方式。

## 8. 数据可视化

项目使用多种可视化技术：

1. **ReactFlow**: 构建交互式流程图，展示研究过程
2. **D3.js**: 实现复杂的数据可视化图表
3. **elkjs**: 提供自动布局算法支持

## 9. 总结

IDR Frontend 采用现代化的前端技术栈，实现了一个功能完善、交互友好的研究可视化平台。通过组件化设计、响应式状态管理和实时通信，为用户提供流畅的研究体验。项目架构清晰，代码组织合理，便于后续功能扩展和维护。