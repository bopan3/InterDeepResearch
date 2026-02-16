import { makeAutoObservable } from 'mobx';

/**
 * 单个溯源节点的数据结构
 *
 * - trace_id: 前端生成的自增 ID，用于在前端内部标识和引用
 * - card_id: 后端返回的卡片 ID
 * - support_content: 后端返回的支撑内容
 * - card_main_content_with_highlight: 带高亮标签的主内容（字符串或数组）
 * - children: 子节点的 trace_id 数组（只记录 trace_id，不再嵌套复杂结构）
 */
export interface TraceNode {
  trace_id: number;
  card_id: string;
  support_content_list: string[];
  card_main_content_with_highlight?: string | Array<{ title: string; url: string; snippet: string }>;
  children: number[];
}

/**
 * 后端 b2f_trace_source 的树节点结构（只列出当前需要的字段）
 */
interface BackendTraceTreeNode {
  card_id: string;
  support_content_list: string[];
  card_main_content_with_highlight?: string | Array<{ title: string; url: string; snippet: string }>;
  children: BackendTraceTreeNode[];
}

/**
 * 后端 b2f_trace_source 接口结构（简化版）
 */
interface BackendTraceSourcePayload {
  project_id: string;
  status: string; // 暂时先不区分 Success / Failed，按需求忽略
  trace_result_tree: BackendTraceTreeNode;
}

/**
 * TraceStore - 管理 trace 溯源结果（扁平化结构）
 */
class TraceStore {
  // 使用 trace_id 作为 key 的字典，便于快速索引
  trace_dict: { [traceId: number]: TraceNode } = {};

  // 简单的自增 trace_id 计数器
  private nextTraceId: number = 1;

  // 记录最近一次更新的时间戳，便于触发观察者更新
  lastUpdateTimestamp: number = Date.now();

  constructor() {
    makeAutoObservable(this);

    // 调试：每隔 20s 输出一次完整 trace_dict 内容
    if (typeof window !== 'undefined') {
      const w = window as any;
      if (!w.__TRACE_STORE_LOGGER__) {
        w.__TRACE_STORE_LOGGER__ = true;
        setInterval(() => {
          try {
            // 使用 JSON 深拷贝，避免 Proxy 结构输出为 [object Object]
            const snapshot = JSON.parse(JSON.stringify(this.trace_dict));
          } catch (e) {
          }
        }, 20000);
      }
    }
  }

  // 私有方法：更新时间戳
  private updateTimestamp() {
    this.lastUpdateTimestamp = Date.now();
  }

  // 私有方法：生成一个新的 trace_id
  private generateTraceId() {
    const id = this.nextTraceId;
    this.nextTraceId += 1;
    return id;
  }

  // 私有方法：将后端的树节点递归扁平化为 TraceNode，并返回根节点的 trace_id
  private flattenTraceTree(node: BackendTraceTreeNode, map: { [traceId: number]: TraceNode }): number {
    const currentTraceId = this.generateTraceId();

    // 先占位当前节点，children 先用空数组，等递归完子节点再填充
    const currentNode: TraceNode = {
      trace_id: currentTraceId,
      card_id: node.card_id,
      support_content_list: Array.isArray(node.support_content_list) ? node.support_content_list : [],
      card_main_content_with_highlight: node.card_main_content_with_highlight,
      children: [],
    };

    map[currentTraceId] = currentNode;

    // 递归处理子节点，收集其 trace_id
    const childTraceIds: number[] = [];
    if (Array.isArray(node.children)) {
      node.children.forEach((child) => {
        const childTraceId = this.flattenTraceTree(child, map);
        childTraceIds.push(childTraceId);
      });
    }

    currentNode.children = childTraceIds;

    return currentTraceId;
  }

  /**
   * 接收后端的 b2f_trace_source，扁平化并存入 store
   *
   * 注意：
   * - 不直接保存后端的树结构
   * - 只为每个节点保存：trace_id（前端自增）、card_id、support_content、children(trace_id[])
   */
  ingestTraceSource(payload: BackendTraceSourcePayload) {
    const { trace_result_tree } = payload;
    if (!trace_result_tree) {
      return;
    }

    // 这里可以考虑是否要清空旧的 trace_dict
    // 当前实现：每次新请求追加到已有的 trace_dict 中，trace_id 全局递增
    const newTraceDict: { [traceId: number]: TraceNode } = {};

    const rootTraceId = this.flattenTraceTree(trace_result_tree, newTraceDict);

    // 将新生成的节点合并进全局 trace_dict
    this.trace_dict = {
      ...this.trace_dict,
      ...newTraceDict,
    };

    // 更新时间戳，便于触发观察者
    this.updateTimestamp();

    // 返回根 trace_id，方便调用方在 UI 中定位根节点
    return rootTraceId;
  }

  // 清空所有 trace 结果，并重置 trace_id 计数器
  clearTraces() {
    this.trace_dict = {};
    this.nextTraceId = 1;
    this.updateTimestamp();
  }

  // Getters
  get traces() {
    return this.trace_dict;
  }

  // 根据 trace_id 获取节点
  getTrace(traceId: number) {
    return this.trace_dict[traceId];
  }

  // 根据 card_id 获取节点（可能有多个，返回第一个匹配的）
  getTraceByCardId(cardId: string): TraceNode | undefined {
    for (const traceNode of Object.values(this.trace_dict)) {
      if (traceNode.card_id === cardId) {
        return traceNode;
      }
    }
    return undefined;
  }
}

// 创建全局 store 实例
export const traceStore = new TraceStore();
export default TraceStore;
export type { BackendTraceSourcePayload, BackendTraceTreeNode };


