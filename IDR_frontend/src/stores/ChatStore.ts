import { makeAutoObservable } from 'mobx';

// 待办事项项接口
interface TodoItem {
  status: 'pending' | 'in_progress' | 'completed';
  content: string;
}

// 工具消息接口
interface ToolMessageContent {
  first_tool_description: string;
  second_tool_description: string;
  detail: string | null;
  bind_card_id: string | null;
}

// 卡片引用接口
interface CardReference {
  card_id: string;
  selected_content: string | null;
}

// 聊天项接口 - 对应后端的chat_list中的每一项
interface ChatItem {
  chat_type: 'user_message' | 'assistant_message' | 'system_message' | 'todo_list' | 'tool_message' | 'progress_summary_message';
  chat_content: {
    // 用户消息
    user_message?: string;
    reference_list?: CardReference[];
    // 助手消息
    assistant_message?: string;
    // 系统消息
    system_message?: string;
    // 待办事项列表
    todo_list?: TodoItem[];
    // 工具消息
    first_tool_description?: string;
    second_tool_description?: string;
    status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
    detail?: string | null;
    bind_card_id?: string | null;
    // 进度摘要消息
    progress_summary?: string;
    agent_message?: string;
  };
}

/**
 * ChatStore - 管理聊天消息数据
 */
class ChatStore {
  // 聊天消息列表
  chat_list: ChatItem[] = [];
  
  // 时间戳 - 用于追踪任何数据变化
  lastUpdateTimestamp: number = Date.now();

  constructor() {
    makeAutoObservable(this);
  }

  // 私有方法：更新时间戳
  private updateTimestamp() {
    this.lastUpdateTimestamp = Date.now();
  }

  // Actions - Chat相关
  addChat(chatItem: ChatItem) {
    this.chat_list.push(chatItem);
    this.updateTimestamp();
  }

  updateChatList(chatList: ChatItem[]) {
    this.chat_list = chatList;
    this.updateTimestamp();
  }

  clearChatList() {
    this.chat_list = [];
    this.updateTimestamp();
  }

  // 设置聊天列表（用于从后端同步数据）
  setChatList(chatList: ChatItem[]) {
    this.chat_list = chatList;
    this.updateTimestamp();
  }

  // 差异化更新聊天列表
  updateChatListWithDiff(newChatList: ChatItem[]) {
    this.chat_list = newChatList;
    this.updateTimestamp();
  }

  // Getters
  get chatList() {
    return this.chat_list;
  }

  get chatCount() {
    return this.chat_list.length;
  }

  // 获取聊天消息（转换为新的消息格式）
  getChatMessages() {
    const mapped = this.chat_list.map(chatItem => {
      // 根据chat_type转换为新的消息格式
      switch (chatItem.chat_type) {
        case 'user_message':
          return {
            type: 'user_message' as const,
            content: chatItem.chat_content, // 传递整个 chat_content 对象以包含 bind_card_id
            reference_list: chatItem.chat_content.reference_list || []
          };
          
        case 'assistant_message':
          return {
            type: 'assistant_message' as const,
            content: chatItem.chat_content.assistant_message || ''
          };
          
        case 'system_message':
          return {
            type: 'system_message' as const,
            content: chatItem.chat_content.system_message || ''
          };
          
        case 'todo_list':
          return {
            type: 'todo_list' as const,
            content: chatItem.chat_content.todo_list || []
          };
          
        case 'tool_message':
          return {
            type: 'tool_message' as const,
            content: {
              first_tool_description: chatItem.chat_content.first_tool_description || '',
              second_tool_description: chatItem.chat_content.second_tool_description || '',
              status: chatItem.chat_content.status || 'completed', // Use actual status from backend, fallback to completed
              detail: chatItem.chat_content.detail || null,
              bind_card_id: chatItem.chat_content.bind_card_id || null
            }
          };
          
        case 'progress_summary_message':
          return {
            type: 'progress_summary_message' as const,
            content: {
              progress_summary: chatItem.chat_content.progress_summary || '',
              status: chatItem.chat_content.status || 'completed'
            }
          };
          
        default:
          // 默认返回空消息
          return {
            type: 'assistant_message' as const,
            content: ''
          };
      }
    }).filter(msg => {
      // 过滤掉空消息，但保留todo_list和tool_message
      if (msg.type === 'todo_list') {
        return Array.isArray(msg.content) && msg.content.length > 0;
      }
      if (msg.type === 'tool_message') {
        return true; // 工具消息总是显示
      }
      return String(msg.content).trim() !== '';
    });

    // 直接返回后端提供的消息映射结果（后端已保证首个 progress_summary_message）
    return mapped;
  }

  // 获取特定类型的消息
  getChatMessagesByType(type: ChatItem['chat_type']) {
    return this.chat_list.filter(item => item.chat_type === type);
  }

  // 获取最后一条消息
  getLastMessage() {
    return this.chat_list[this.chat_list.length - 1] || null;
  }

  // 获取消息统计
  getChatStats() {
    const stats = {
      total: this.chat_list.length,
      user_message: 0,
      assistant_message: 0,
      system_message: 0,
      todo_list: 0,
      tool_message: 0,
      progress_summary_message: 0
    };

    this.chat_list.forEach(item => {
      stats[item.chat_type]++;
    });

    return stats;
  }
}

// 创建全局store实例
export const chatStore = new ChatStore();
export default ChatStore;
export type { ChatItem, TodoItem, ToolMessageContent, CardReference };