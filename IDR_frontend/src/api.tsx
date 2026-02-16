import { io, Socket } from 'socket.io-client';
import { historyStore, requestKeyStore, chatStore, cardStore, traceStore } from './stores';
import type { Card, CardRef, CardReference, CitationSource } from './stores';

class API {
  private socket: Socket | null = null;
  private isConnected: boolean = false;
  private lastEventSentTime: number = 0; // 记录最后一次发送事件的时间
  private DELAY_THRESHOLD: number = 1000; // 延迟阈值，单位毫秒
  private reconnectTimer: number | null = null;
  private readonly RECONNECT_DELAY = 2000;
  
  // Trace 相关状态
  private currentTraceRequestId: string | null = null; // 当前正在处理的 trace 请求 ID
  private processedTraceRequestIds: Set<string> = new Set(); // 已处理过的 trace 请求 ID，避免重复处理
  
  // 将 Base64 字符串转换为 Blob 对象
  private base64ToBlob(base64: string, mimeType: string = 'application/octet-stream'): Blob {
    // 移除可能存在的 Base64 URL 前缀 (例如 "data:application/octet-stream;base64,")
    const base64Clean = base64.replace(/^data:.*,/, '');
    
    // 解码 Base64
    const byteCharacters = atob(base64Clean);
    const byteArrays = [];

    // 为了性能，分块处理（每块 512 字节）
    for (let offset = 0; offset < byteCharacters.length; offset += 512) {
      const slice = byteCharacters.slice(offset, offset + 512);
      
      const byteNumbers = new Array(slice.length);
      for (let i = 0; i < slice.length; i++) {
        byteNumbers[i] = slice.charCodeAt(i);
      }
      
      const byteArray = new Uint8Array(byteNumbers);
      byteArrays.push(byteArray);
    }

    return new Blob(byteArrays, { type: mimeType });
  }

  // 触发文件下载
  private triggerFileDownload(filename: string, blob: Blob): void {
    // 创建临时下载链接
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    
    link.href = url;
    link.setAttribute('download', filename);
    
    // 添加到文档并点击
    document.body.appendChild(link);
    link.click();
    
    // 清理资源
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  // 记录接收到的事件
  private logEvent(eventName: string, data: any) {
    console.log(`Received ${eventName}:`, data);
  }

  // 溯源结果状态变化的回调（由 UI 层注入）
  private onTraceSourceStatusChange: ((status: string | undefined) => void) | null = null;
  
  // 直接更新前端方法
  private updateFrontend(data: any) {
    console.log('Updating frontend with data for project:', data.project_id);
    
    // 直接更新聊天数据和卡片数据（新的数据结构）
    if (data.chat_list) {
      chatStore.updateChatListWithDiff(data.chat_list);
    }
    
    if (data.card_dict) {
      cardStore.updateCardsWithDiff(data.card_dict);
    }

    // 处理 trace 状态更新
    if (data.info_trace_state_dict) {
      this.handleTraceStateUpdate(data.info_trace_state_dict);
    }
  }

  // 处理 trace 状态更新
  private handleTraceStateUpdate(infoTraceStateDict: any) {
    // 遍历所有 trace state，找到第一个还未处理的 Success 或 Failed 状态
    for (const [requestId, state] of Object.entries(infoTraceStateDict) as [string, any][]) {
      const status = state.status;

      // 跳过已处理的请求
      if (this.processedTraceRequestIds.has(requestId)) {
        continue;
      }

      // 更新 UI 状态（使用当前处理的请求状态）
      if (this.onTraceSourceStatusChange) {
        this.onTraceSourceStatusChange(status);
      }

      // 只在第一次收到 Success 或 Failed 状态时处理 trace 结果
      // Running 状态不处理，Success 和 Failed 状态都要处理
      if (status === 'Success' || status === 'Failed') {
        try {
          traceStore.ingestTraceSource({
            project_id: historyStore.currentProjectId || '',
            status: status,
            trace_result_tree: state.trace_result_tree
          });

          // 标记为已处理，避免重复处理
          this.processedTraceRequestIds.add(requestId);

          // 如果这是当前正在处理的请求，清理状态
          if (this.currentTraceRequestId === requestId) {
            this.currentTraceRequestId = null;
          }

          // 只处理第一个找到的未处理状态
          break;
        } catch (e) {
          console.error('Error handling trace result:', e);
        }
      }

      // 如果状态为 Failed，记录警告日志
      if (status === 'Failed') {
        console.warn(`[TraceStateUpdate] Trace failed for requestId: ${requestId}`);
      }
    }
  }

  // 初始化连接
  connect() {
    if (this.socket) {
      if (this.socket.connected) {
        return;
      }
      if (this.socket.disconnected) {
        console.log('Existing socket disconnected, attempting to reconnect');
        this.socket.connect();
      }
      return;
    }

    this.clearReconnectTimer();
    
    // console.log('Connecting to socket server...');
    this.socket = io("http://localhost:5001", {
      path: "/socket.io",
      transports: ['websocket', 'polling'],
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      forceNew: true,
      reconnection: true,
      timeout: 10000
    });
    
    // 连接事件处理
    this.socket.on('connection_established', () => {
      console.log('Socket connected with ID:', this.socket?.id || 'unknown');
      this.clearReconnectTimer();
      this.isConnected = true;
    });
    
    // 重连成功事件处理
    this.socket.on('reconnect', (attemptNumber) => {
      console.log(`Socket reconnected after ${attemptNumber} attempts`);
      this.clearReconnectTimer();
      this.isConnected = true;
      
      // 重连成功后，如果有当前项目ID，自动请求最新数据
      const currentProjectId = historyStore.currentProjectId;
      if (currentProjectId) {
        console.log(`Reconnected, requesting latest data for project: ${currentProjectId}`);
        this.requestUpdate(currentProjectId);
      }
    });
    
    // 断开连接处理
    this.socket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      this.isConnected = false;
      
      if (reason === 'io client disconnect') {
        return;
      }

      const currentSocket = this.socket;
      currentSocket?.removeAllListeners();
      this.socket = null;
      this.scheduleReconnect();
    });
    
    this.socket.on('reconnect_failed', () => {
      console.warn('Socket reconnection failed, scheduling fresh connection');
      const currentSocket = this.socket;
      currentSocket?.removeAllListeners();
      this.socket = null;
      this.scheduleReconnect(this.RECONNECT_DELAY * 2);
    });
    
    // 项目创建响应
    this.socket.on('b2f_start_research', (data) => {
      this.logEvent('b2f_start_research', data);
      
      const researchGoal = requestKeyStore.validateKey(data.request_key);
      
      // 如果request_key无效，直接返回
      if (!researchGoal) {
        console.log('Invalid request_key, ignoring b2f_start_research event');
        return;
      }
      
      // 只有当接收到的request_key与最新创建的request_key一致时，才更新当前项目ID
      if (data.request_key === requestKeyStore.latestRequestKey) {
        historyStore.setCurrentProjectId(data.project_id);
        // 清空消息的逻辑现在由AgentStore处理
      }
      
      // 请求更新项目列表，而不是手动添加项目
      this.getProjectList();
    });
    
    // 项目列表更新
    this.socket.on('b2f_provide_project_list', (data) => {
      this.logEvent('b2f_provide_project_list', data);
      
      // 检查数据格式，处理包含project_list字段的对象格式
      if (data && data.project_list) {
        // 将后端格式转换为前端HistoryProject格式
        // console.log('Received project_list:', data.project_list);
        const projects = data.project_list.map((item: {id: string, research_goal?: string}) => ({
          id: item.id, // 使用正确的字段名 id 而不是 project_id
          title: item.research_goal || `项目 ${item.id}`,
        }));
        historyStore.setProjects(projects);
      } else if (Array.isArray(data)) {
        // 兼容直接传递数组的情况
        console.log('Received project_list array:', data);
        historyStore.setProjects(data);
      } else {
        console.log('Received unknown project_list format:', data);
      }
    });
    
    // 处理 b2f_update 事件
    this.socket.on('b2f_update', (data) => {
      this.logEvent('b2f_update', data);
      // 检查后端发送的 project_id 与当前的 current project id 是否相同
      if (data.project_id !== historyStore.currentProjectId) {
        console.log('Received project_id does not match current project_id, ignoring update， id: ', data.project_id, 'current project id: ', historyStore.currentProjectId);
        return; // 如果不相同，不更新当前项目ID
      }
      
      // 立即更新前端
      this.updateFrontend(data);
      
      // 检查当前displayAgentId对应的agent的is_running状态，并同步到MainLayout的isProcessing状态
      this.syncAgentRunningState(data);
    });
    
    // 处理导出结果事件：触发浏览器下载 JSON
    this.socket.on('b2f_export_project', (data: any) => {
      this.logEvent('b2f_export_project', data);
      try {
        const projectId: string = data?.project_id ?? historyStore.currentProjectId ?? 'unknown';
        
        // 1. 获取文件名，后端现在应该传回 .pkl 后缀
        const filename: string = data?.filename ?? `project_${projectId}.pkl`;
        
        // 2. 获取 Base64 数据字符串
        const base64Content = data?.data ?? data?.export_data;

        if (!base64Content || typeof base64Content !== 'string') {
          throw new Error('Invalid data format: Expected Base64 string for pickle export');
        }

        // 3. 将 Base64 转换为二进制 Blob 对象
        const blob = this.base64ToBlob(base64Content, 'application/octet-stream');

        // 4. 触发文件下载 (注意：这里调用的是通用的文件下载，而不是 JsonDownload)
        this.triggerFileDownload(filename, blob);

      } catch (e) {
        console.error('Error handling b2f_export_project payload:', e);
        // 可以在这里加一个 UI 提示，告诉用户下载失败
      }
    });

    // 处理导入完成事件：设置当前项目并请求更新
    this.socket.on('b2f_import_project', (data: any) => {
      this.logEvent('b2f_import_project', data);
      try {
        const projectId: string = data?.project_id ?? data?.id ?? historyStore.currentProjectId;
        if (projectId) {
          // 请求最新的项目列表与数据
          historyStore.setCurrentProjectId(projectId);
          this.getProjectList();
          this.requestUpdate(projectId);
        } else {
          console.warn('b2f_import_project payload missing project_id:', data);
        }
      } catch (e) {
        console.error('Error handling b2f_import_project payload:', e);
      }
    });
    
    // 请求初始项目列表
    this.getProjectList();
  }
  
  // 断开连接
  disconnect() {
    if (!this.socket) return;
    this.socket.disconnect();
    this.socket = null;
    this.isConnected = false;
  }
  
  // 获取项目列表
  getProjectList() {
    if (!this.socket) return;
    console.log('Emitting f2b_get_project_list');
    this.sendEvent('f2b_get_project_list', {});
  }
  
  // 通用的事件发送方法
  private sendEvent(eventName: string, data: any) {
    if (!this.socket) return;
    
    console.log(`Emitting ${eventName}:`, data);
    // 记录发送事件的时间
    this.lastEventSentTime = Date.now();
    this.socket.emit(eventName, data);
  }
  
  startResearch(message: string) {
    if (!this.socket) return;
    
    // 开始新研究时清空 ChatStore 和 CardStore
    chatStore.clearChatList();
    cardStore.clearCards();
    
    const randomKey = generateRandomKey();
    requestKeyStore.addKey({ research_goal: message, request_key: randomKey });
    this.sendEvent('f2b_start_research', { request_key: randomKey, research_goal: message });
  }

  // 发送用户消息
  sendUserMessage(message: string, referenceList: CardReference[]) {
    if (!this.socket) return;
    
    const projectId = historyStore.currentProjectId;
    console.log('Sending message for project:', projectId);
    console.log('Reference list:', referenceList);
    
    // 将 CardReference[] 转换为后端期望的格式
    const reference_list = referenceList.map(ref => ({
      card_id: ref.card_id,
      selected_content: ref.selected_content
    }));
    
    const sendData = { 
      project_id: projectId, 
      message: message, 
      reference_list: reference_list 
    };
    
    console.log('=== Sending User Message ===');
    console.log('Event: f2b_send_message_to_agent');
    console.log('Data:', JSON.stringify(sendData, null, 2));
    console.log('Reference list details:', reference_list);
    console.log('===========================');
    
    this.sendEvent('f2b_send_message_to_agent', sendData);
  } 

  // 请求检索引用来源
  traceSource(projectId: string, cardId: string, contentToTrace: string) {
    if (!this.socket) return;

    if (!projectId || !cardId) {
      console.warn('traceSource requires both projectId and cardId');
      return;
    }

    // 生成唯一的请求ID
    const requestId = `trace_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 记录当前正在处理的 trace 请求 ID
    this.currentTraceRequestId = requestId;

    const payload = {
      project_id: projectId,
      card_id: cardId,
      content_to_trace: contentToTrace,
      request_id: requestId
    };

    this.sendEvent('f2b_trace_source', payload);
  }


  // 请求更新
  requestUpdate(projectId: string) {
    if (!this.socket) return;
    this.sendEvent('f2b_request_update', { project_id: projectId });
  }
  
  // 导出项目（聊天会话）
  exportProject(projectId: string) {
    if (!this.socket) return;
    this.sendEvent('f2b_export_project', { project_id: projectId });
  }
  
  // 删除项目（聊天会话）
  deleteProject(projectId: string) {
    if (!this.socket) return;
    this.sendEvent('f2b_delete_project', { project_id: projectId });
  }

  // 以文件方式导入项目（读取文件为JSON后发送）
  importProject(file: File) {
    if (!this.socket) return;
    file.text()
      .then((text) => {
        const data = JSON.parse(text);
        this.sendEvent('f2b_import_project', data);
      })
      .catch((e) => {
        console.error('Failed to read import file:', e);
      });
  }

  // 直接以数据对象方式导入项目（前端已解析与校验）
  importJsonProjectData(data: any) {
    if (!this.socket) return;
    this.sendEvent('f2b_import_json_project', data);
  }

  importProjectData(data: any) {    
    // 仅处理 .pkl 文件的导入。
    // 输入要求：data 为 { file: File, filename?: string } 且文件名以 .pkl 结尾。
  // 行为：使用 FileReader 将文件读取为 dataURL，提取 Base64 部分，然后通过 socket 事件
  // 'f2b_import_project' 发送 payload { data }，其中 data 为纯 Base64 字符串（不包含 filename）。
    // 错误：如果未提供 File 或文件不是 .pkl，该函数会 reject 并返回错误信息。
    return new Promise<void>((resolve, reject) => {
      if (!this.socket) {
        reject(new Error('Socket not connected'));
        return;
      }

        try {
          // Only accept a File input (expected to be .pkl)
          if (!data || !(data.file instanceof File || (typeof File !== 'undefined' && data.file && data.file.constructor && data.file.constructor.name === 'File'))) {
            reject(new Error('importProjectData expects an object with a File in `.file`'));
            return;
          }

          const file: File = data.file;
          const filename = data.filename || file.name;

          if (!filename.toLowerCase().endsWith('.pkl')) {
            reject(new Error('importProjectData only accepts .pkl files'));
            return;
          }

          const reader = new FileReader();
          reader.onload = () => {
            try {
              const result = reader.result as string;
              const base64 = result.replace(/^data:.*;base64,/, '');

              // Send only the Base64 data to backend; filename is not required
              this.sendEvent('f2b_import_project', { data: base64 });
              resolve();
            } catch (e) {
              reject(e);
            }
          };

          reader.onerror = (err) => {
            reject(err);
          };

          reader.readAsDataURL(file);
        } catch (e) {
          reject(e);
        }
    });
  }
  
  // 用户衍生卡片
  sendUserDeriveCard(cardRefs: Array<{agent_id: string, card_id: string}>, prompt: string | null, deriveType: string = 'general_derive') {
    if (!this.socket) return;
    
    const eventData = {
      card_ref: cardRefs,
      prompt: prompt,
      derive_type: deriveType
    };
    
    this.sendEvent('f2b_user_derive_card', eventData);
  }

  interruptAgent(projectId: string) {
    if (!this.socket) return;
    this.sendEvent('f2b_interrupt_agent', {project_id: projectId});
  }
  
  // 同步is_running状态到MainLayout的isProcessing状态
  private syncAgentRunningState(data: any) {
    // 直接检查最外层的is_running字段
    if (typeof data.is_running === 'boolean') {
      if (this.onAgentRunningStateChange) {
        this.onAgentRunningStateChange(data.is_running);
      }
    }
  }
  
  // 设置运行状态变化的回调函数
  private onAgentRunningStateChange: ((isRunning: boolean) => void) | null = null;
  
  setAgentRunningStateChangeCallback(callback: (isRunning: boolean) => void) {
    this.onAgentRunningStateChange = callback;
  }

  // 设置溯源状态变化的回调函数
  setTraceSourceStatusChangeCallback(callback: (status: string | undefined) => void) {
    this.onTraceSourceStatusChange = callback;
  }
  
  // 手动同步运行状态（用于currentDisplayAgentId变化时）
  syncCurrentAgentRunningState() {
    if (this.onAgentRunningStateChange) {
      // 由于新的数据结构中没有直接的运行状态信息，
      // 这个方法现在主要用于触发状态检查，具体状态通过 b2f_update 事件获取
      // 暂时传递 false 作为默认值，实际状态会通过后续的 b2f_update 事件更新
      this.onAgentRunningStateChange(false);
    }
  }
  
  private scheduleReconnect(delay: number = this.RECONNECT_DELAY) {
    if (this.reconnectTimer !== null) {
      return;
    }
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer() {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  // 检查连接状态
  isSocketConnected(): boolean {
    return this.socket?.connected ?? this.isConnected;
  }
}

// 生成随机密钥
function generateRandomKey(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    const randomIndex = Math.floor(Math.random() * chars.length);
    result += chars[randomIndex];
  }
  return result;
}


// 创建单例实例
const api = new API();
export default api;