import React, { useState, useEffect, useRef, useCallback } from 'react';
import { observer } from 'mobx-react-lite';
import { Box } from '@mui/material';
// import HistoryIcon from '@mui/icons-material/History';
// import HistoryView from './components/HistoryView'; // 暂时不使用
import DetailView from './components/DetailView';
import ReactFlowView, { ReactFlowViewRef } from './components/ReactFlowView';
import ChatView, { ChatViewRef } from './components/ChatView';
import WelcomeView from './components/WelcomeView';
import ActionInputBox from './components/ActionInputBox';
import { historyStore, chatStore, cardStore, traceStore } from '../../stores';
import type { Card, CardReference } from '../../stores/CardType';
import api from '../../api';
import './MainLayout.scss';

interface MainLayoutProps {}

const getTraceProcessCircleColor = (cardType?: string) => {
  switch (cardType) {
    case 'trace_result':
      return '#FF9900';
    case 'webpage':
      return '#50B230';
    case 'web_search':
    case 'web_search_result':
      return '#387BFF';
    case 'note':
    case 'report':
      return '#E73232';
    default:
      return '#000000';
  }
};

const getTraceProcessIcon = (cardType?: string) => {
  switch (cardType) {
    case 'trace_result':
      return '/resource/trace.svg';
    case 'target_task':
      return '/resource/target_task.svg';
    case 'user_requirement':
      return '/resource/user_requirement.svg';
    case 'web_search':
    case 'web_search_result':
      return '/resource/web_search.svg';
    case 'webpage':
      return '/resource/webpage.svg';
    case 'visualization':
      return '/resource/visualization.svg';
    case 'note':
    case 'report':
    default:
      return '/resource/note.svg';
  }
};

const MainLayout: React.FC<MainLayoutProps> = observer(() => {
  const [isDetailOpen, setIsDetailOpen] = useState<boolean>(false); // 右侧 Detail View
  const [showWelcome, setShowWelcome] = useState<boolean>(true);
  // const [leftPanelView, setLeftPanelView] = useState<'history' | 'detail'>('history'); // 暂时不使用
  const [selectedCard, setSelectedCard] = useState<Card | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isDetailFullscreen, setIsDetailFullscreen] = useState<boolean>(false);
  const [isToolConnectionVisible, setIsToolConnectionVisible] = useState<boolean>(false);
  
  // 当前显示的Agent ID状态管理
  const [currentDisplayAgentId, setCurrentDisplayAgentId] = useState<string>('1');
  
  // ReactFlow 视图的当前 Agent ID 状态管理
  const [currentReactFlowAgentId, setCurrentReactFlowAgentId] = useState<string>('1');
  
  // ActionInputBox 状态管理
  const [showActionInputBox, setShowActionInputBox] = useState<boolean>(false);
  const [actionType, setActionType] = useState<'report' | 'visualize' | null>(null);
  const [triggerCardId, setTriggerCardId] = useState<string>('');
  
  // 卡片选择状态管理
  const [isSelectionMode, setIsSelectionMode] = useState<boolean>(false);
  const [selectedCardsForAction, setSelectedCardsForAction] = useState<string[]>([]);
  const [hoveredToolCard, setHoveredToolCard] = useState<{ cardId: string; color?: string } | null>(null);
  const [activeToolConnection, setActiveToolConnection] = useState<{ cardId: string; messageId: string; color?: string } | null>(null);
  const [pendingToolConnection, setPendingToolConnection] = useState<{ cardId: string; messageId: string; color?: string } | null>(null);
  const [traceProcessState, setTraceProcessState] = useState<{ isVisible: boolean; cardTitle: string; cardType?: string; status?: 'Success' | 'Failed' | null }>({
    isVisible: false,
    cardTitle: '',
    cardType: undefined,
    status: null,
  });

  // 统一的折叠状态记录，用于右键消息和右键卡片都能恢复状态
  const [collapsedStateBeforeDetailView, setCollapsedStateBeforeDetailView] = useState<{ [cardId: string]: boolean }>({});
  const [traceProcessPosition, setTraceProcessPosition] = useState<{ x: number; y: number }>({
    x: 16,
    y: 16,
  });
  const [traceProcessDragOffset, setTraceProcessDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [isTraceProcessDragging, setIsTraceProcessDragging] = useState(false);
  const traceProcessRef = useRef<HTMLDivElement | null>(null);
  const [globalBanner, setGlobalBanner] = useState<{ message: string; type: 'error' | 'info'; visible: boolean }>({
    message: '',
    type: 'info',
    visible: false,
  });
  const bannerTimeoutRef = useRef<number | null>(null);

  // 全屏拖拽 traceProcess：在 document 上监听 mousemove / mouseup，避免快速拖动时事件丢失
  useEffect(() => {
    if (!isTraceProcessDragging || !traceProcessDragOffset) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - traceProcessDragOffset.x;
      const newY = e.clientY - traceProcessDragOffset.y;

      setTraceProcessPosition({
        x: newX,
        y: Math.max(0, newY),
      });
    };

    const handleMouseUp = () => {
      setIsTraceProcessDragging(false);
      setTraceProcessDragOffset(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isTraceProcessDragging, traceProcessDragOffset]);
  
  // 隐藏的文件输入引用，挂载在DOM中确保可点击
  const importInputRef = useRef<HTMLInputElement | null>(null);
  
  // ReactFlowView 的引用，用于调用聚焦方法
  const reactFlowViewRef = useRef<ReactFlowViewRef | null>(null);
  // ChatView 的 ref，用于调用快捷键处理函数
  const chatViewRef = useRef<ChatViewRef | null>(null);

  // Auto 模式状态管理
  const [isAutoMode, setIsAutoMode] = useState<boolean>(false);

  // 连接线坐标 refocus 的防抖机制
  const connectionRefocusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  // 监听 ReactFlowView 的 viewMode 变化
  useEffect(() => {
    let previousViewMode: 'auto' | 'manual' | null = null;

    const checkViewMode = () => {
      const viewMode = reactFlowViewRef.current?.getViewMode() || null;
      const isAutoMode = viewMode === 'auto';
      setIsAutoMode(isAutoMode);

      // 当 viewMode 从非 auto 变为 auto 时，滚动 ChatView 到最新消息
      if (viewMode === 'auto' && previousViewMode !== 'auto') {
        chatViewRef.current?.scrollToLatestMessage();
      }

      previousViewMode = viewMode;
    };
    
    // 定期检查 viewMode（因为 ReactFlowView 内部管理，无法直接订阅）
    const interval = setInterval(checkViewMode, 100);
    checkViewMode(); // 立即检查一次
    
    return () => clearInterval(interval);
  }, []);

  // 根据 Detail 面板状态清理工具消息连接
  useEffect(() => {
    if (!isDetailOpen || !selectedCard) {
      setActiveToolConnection(null);
      setPendingToolConnection(null);
      setIsToolConnectionVisible(false);
      return;
    }
    setActiveToolConnection(prev => {
      if (prev && prev.cardId !== selectedCard.card_id) {
        return null;
      }
      return prev;
    });
  }, [isDetailOpen, selectedCard]);

  // 当详情打开或卡片切换时重置工具连接可见性
  useEffect(() => {
    if (isDetailOpen && selectedCard) {
      setIsToolConnectionVisible(true);
      return;
    }
    setIsToolConnectionVisible(false);
  }, [isDetailOpen, selectedCard?.card_id]);

  const handlePointerDownOutsideDetail = useCallback((event?: PointerEvent) => {
    if (!event?.target) {
      return;
    }
    const detailViewElements = document.querySelectorAll('.detail-view');
    if (!detailViewElements.length) {
      return;
    }
    const targetNode = event.target as Node | null;
    
    // 排除 ReactFlow Controls 区域的点击（包括 auto 按钮）
    // auto 按钮会通过 onHideToolConnection 回调主动隐藏连接线
    const reactFlowControls = document.querySelector('.react-flow__controls');
    if (reactFlowControls && reactFlowControls.contains(targetNode)) {
      return; // 点击了 Controls 区域，不处理（由 Controls 按钮自己处理）
    }
    
    const clickedInside = Array.from(detailViewElements).some(element => element.contains(targetNode));
    if (!clickedInside) {
      setIsToolConnectionVisible(false);
    }
  }, []);

  // 监听 detailView 外部点击以隐藏工具连接
  useEffect(() => {
    if (!isDetailOpen || !selectedCard) {
      return;
    }

    document.addEventListener('pointerdown', handlePointerDownOutsideDetail, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDownOutsideDetail, true);
    };
  }, [handlePointerDownOutsideDetail, isDetailOpen, selectedCard?.card_id]);

  useEffect(() => {
    if (!pendingToolConnection) return;
    if (!isDetailOpen) return;
    if (selectedCard?.card_id !== pendingToolConnection.cardId) {
      return;
    }
    setActiveToolConnection(pendingToolConnection);
    setPendingToolConnection(null);
  }, [isDetailOpen, pendingToolConnection, selectedCard]);
  
  // 全局函数：显示ActionInputBox
  useEffect(() => {
    (window as any).showActionInputBox = (type: 'report' | 'visualize', cardId: string) => {
      setActionType(type);
      setTriggerCardId(cardId);
      setSelectedCardsForAction([cardId]); // 初始化选中卡片列表
      setShowActionInputBox(true);
    };
    
    // 全局函数：切换卡片选择（在选择模式下点击卡片时调用）
    (window as any).toggleCardSelection = (cardId: string) => {
      if (isSelectionMode) {
        setSelectedCardsForAction(prev => {
          if (prev.includes(cardId)) {
            return prev.filter(id => id !== cardId);
          } else {
            return [...prev, cardId];
          }
        });
      }
    };
    
    // 清理函数
    return () => {
      delete (window as any).showActionInputBox;
      delete (window as any).toggleCardSelection;
    };
  }, [isSelectionMode]);
  
  // 初始化socket连接和请求数据
  useEffect(() => {
    // 初始化socket.io连接
    if (!api.isSocketConnected()) {
      api.connect();
      // console.log('Socket.io connection initialized from MainLayout');
    }
    
    // 设置运行状态变化的回调函数
    api.setAgentRunningStateChangeCallback((isRunning: boolean) => {
      // 直接使用传入的 is_running 状态
      // console.log(`[MainLayout] is_running: ${isRunning}`);
      setIsProcessing(isRunning);
    });

    // 设置溯源状态变化的回调函数，用于更新 traceProcess 的展示
    api.setTraceSourceStatusChangeCallback((status: string | undefined) => {
      setTraceProcessState(prev => {
        if (!prev.isVisible) {
          return prev;
        }

        let normalizedStatus: 'Success' | 'Failed' | null = null;
        if (status === 'Success') {
          normalizedStatus = 'Success';
        } else if (status === 'Failed') {
          normalizedStatus = 'Failed';
        }

        return {
          ...prev,
          status: normalizedStatus,
        };
      });
    });
    
    // 当currentDisplayAgentId变化时，手动同步一次agent运行状态
    api.syncCurrentAgentRunningState();
  }, [currentDisplayAgentId]); // 添加currentDisplayAgentId作为依赖

  // 监听 traceStore 更新，自动展开所有 trace 卡片
  useEffect(() => {
    const traceLastUpdateTimestamp = traceStore.lastUpdateTimestamp;
    
    // 当 traceStore 更新时，找到所有 trace 卡片的宿主卡片并展开它们
    // 由于 trace 卡片会与宿主卡片同步展开/折叠状态，展开宿主卡片即可
    const traceDict = traceStore.traces;
    const hostCardIds = new Set<string>();
    
    // 收集所有 trace 节点的宿主卡片 ID
    Object.values(traceDict).forEach((traceNode) => {
      if (traceNode.card_id) {
        hostCardIds.add(traceNode.card_id);
      }
    });
    
    // 延迟执行展开操作，确保 trace 卡片已经在 ReactFlowView 中生成
    if (hostCardIds.size > 0 && reactFlowViewRef.current) {
      // 使用 setTimeout 确保在下一个渲染周期执行，此时 trace 卡片应该已经生成
      const timeoutId = setTimeout(() => {
        hostCardIds.forEach((cardId) => {
          reactFlowViewRef.current?.expandCard(cardId);
        });
      }, 100); // 延迟 100ms，确保 ReactFlowView 已经重新渲染并生成了 trace 卡片
      
      return () => clearTimeout(timeoutId);
    }
  }, [traceStore.lastUpdateTimestamp]); // 依赖 traceStore 的更新时间戳

  // 监听卡片数量变化，在 auto 模式下自动聚焦到当前 DetailView 卡片
  const prevCardCountRef = useRef<number>(0);
  // 使用 ref 跟踪最新的 selectedCard，避免闭包陷阱
  const latestSelectedCardRef = useRef<Card | null>(selectedCard);

  // 更新 latestSelectedCardRef
  useEffect(() => {
    latestSelectedCardRef.current = selectedCard;
  }, [selectedCard]);
  useEffect(() => {
    const currentCardCount = cardStore.cardList.length;

    // 检查卡片数量是否增加
    if (currentCardCount > prevCardCountRef.current) {
      // 检查是否处于 auto 模式且有打开的 DetailView
      const isAutoMode = reactFlowViewRef.current?.getViewMode() === 'auto';
      const hasOpenDetailView = isDetailOpen && selectedCard;

      if (isAutoMode && hasOpenDetailView && selectedCard?.card_id) {
        const currentDetailCardId = selectedCard.card_id;
        // 等待布局稳定后再聚焦到当前打开的 DetailView 卡片，不退出 auto 模式
        setTimeout(() => {
          // 使用 ref 获取最新的 selectedCard，避免闭包陷阱
          const latestSelectedCard = latestSelectedCardRef.current;
          if (latestSelectedCard?.card_id === currentDetailCardId) {
            // selectedCard 没有变化，执行自动聚焦
            reactFlowViewRef.current?.focusCard(currentDetailCardId, true);
          }
          // 如果 selectedCard 发生了变化，取消自动聚焦（不执行任何操作）
        }, 200);
      }
    }

    // 更新记录的卡片数量
    prevCardCountRef.current = currentCardCount;
  }, [cardStore.cardList.length, isDetailOpen, selectedCard]); // 依赖卡片列表长度、DetailView状态和选中卡片

  // 处理发送消息
  const handleSendMessage = (message: string, referenceList: CardReference[]) => {
    
    setIsProcessing(true);
    
    // 发送消息到服务器
    api.sendUserMessage(message, referenceList);
  };

  // 处理停止消息
  const handleStopProcessing = () => {
    // 发送中断请求到后端
    api.interruptAgent(historyStore.currentProjectId);
    // 注意：后端agent的is_running状态更新后，会通过b2f_update事件同步回来
  };

  // 处理选择聊天
  const handleSelectProject = (projectId: string) => {
    // console.log('Selected project:', projectId);
    if(projectId === historyStore.currentProjectId) {
      return;
    }
    historyStore.setCurrentProjectId(projectId);
    // 请求更新项目数据
    api.requestUpdate(projectId);
    // 选择项目后隐藏欢迎界面
    setShowWelcome(false);
  };

  // 处理新建聊天
  const handleNewProject = () => {
    historyStore.setCurrentProjectId('');
    // 新建聊天时显示欢迎界面
    setShowWelcome(true);
  };

  // 隐藏 input 的 change 处理（读取 JSON、尝试后端导入、前端回退）
  const handleImportInputChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
  
    try {
      // === 分支 A: 处理 Pickle 文件 (.pkl) ===
      if (file.name.endsWith('.pkl')) {
        console.log('Detected Pickle file, forwarding to api.importProjectData (no frontend base64 conversion)');

        try {
          setShowWelcome(false); 
          // Pass the raw File and metadata to api.importProjectData. The API layer will handle
          // converting to base64 or sending as multipart/form-data as appropriate.
          await api.importProjectData({
            file, // pass File object
            filename: file.name,
          } as any);
          // Hide welcome view on successful import
        } catch (e) {
          console.error('importProjectData failed for .pkl:', e);
          alert('导入 .pkl 文件失败');
        }

        return;
      }

      // === 分支 B: 处理 JSON 文件 (保留原有逻辑) ===
      // 如果不是 pkl，默认当作 JSON 处理
      const text = await file.text();
      const jsonData = JSON.parse(text);
      const data: any = jsonData;
  
      // 兼容 agent_dict 为对象或字符串的情况
      let agentDict = data?.agent_dict;
      if (typeof agentDict === 'string') {
        try {
          agentDict = JSON.parse(agentDict);
        } catch (e) {
          alert('agent_dict 字符串不是有效 JSON');
          return;
        }
      }
  
      // JSON 可以在前端做基础校验
      const hasRequiredFields =
        typeof data?.research_goal === 'string' &&
        typeof data?.root_agent_id === 'string' &&
        typeof data?.created_at === 'string' &&
        typeof data?.agent_counter === 'number' &&
        typeof agentDict === 'object' && agentDict !== null;
  
      if (!hasRequiredFields) {
        alert('JSON 缺少必要字段或类型不正确');
        return;
      }
  
      // 发送 JSON 数据
      api.importJsonProjectData({ 
          ...data, 
          agent_dict: agentDict,
      });
      setShowWelcome(false); // 导入成功后隐藏欢迎界面

    } catch (err) {
      console.error(err);
      alert('读取文件失败或格式无效');
    }
  };

  // 处理导入聊天：触发隐藏 input 的点击
  const handleImportProject = () => {
    // console.log("Importing chat...")
    importInputRef.current?.click();
  };


  // 处理导出聊天
  const handleExportProject = (project_id: string) => {
    api.exportProject(project_id);
  };

  // 处理帮助按钮
  const handleHelp = () => {
    // TODO: 实现帮助功能
    console.log("Help clicked");
  };

  // 处理删除聊天
  const handleDeleteProject = (project_id: string) => {
    api.deleteProject(project_id);
    if(project_id === historyStore.currentProjectId) {
      handleNewProject();
    }
  };

  // 处理显示卡片详情
  const handleShowCardDetail = (card: Card, agentId: string) => {
    setSelectedCard(card);
    setSelectedAgentId(agentId);
    setIsDetailOpen(true); // 确保右侧详情栏打开
  };

  // 处理关闭详情视图
  const handleCloseDetail = () => {
    console.log(`[DEBUG] handleCloseDetail 被调用! selectedCard:`, selectedCard);
    console.log(`[DEBUG] 当前 collapsedStateBeforeDetailView:`, collapsedStateBeforeDetailView);

    // 检查是否有强制折叠的状态（从左键点击传递过来）
    const forceCollapseState = (window as any).forceCollapseStateForCard;
    if (forceCollapseState) {
      // 清除全局状态
      delete (window as any).forceCollapseStateForCard;
    }

    // 在关闭 DetailView 前恢复卡片的折叠状态
    if (selectedCard?.card_id) {
      const cardId = selectedCard.card_id;

      // 恢复主卡片状态：优先使用强制折叠状态，否则使用记录的状态
      const shouldCollapse = forceCollapseState?.[cardId] ?? collapsedStateBeforeDetailView[cardId];
      console.log(`[DEBUG] 卡片 ${cardId} 的 shouldCollapse:`, shouldCollapse, forceCollapseState ? '(强制折叠)' : '(记录状态)');

      if (shouldCollapse !== undefined) {
        // 恢复到原来的折叠状态
        // 通过 ReactFlowView 的方法设置折叠状态
        console.log(`[DEBUG] 恢复卡片 ${cardId} 到折叠状态:`, shouldCollapse);
        if (shouldCollapse) {
          reactFlowViewRef.current?.collapseCard(cardId);
        } else {
          reactFlowViewRef.current?.expandCard(cardId);
        }
      }

      // 对于 trace 卡片，还需要恢复宿主卡片状态
      if (cardId.startsWith('trace_')) {
        const hostKey = `host_${cardId}`;
        const hostShouldCollapse = collapsedStateBeforeDetailView[hostKey];
        if (hostShouldCollapse !== undefined) {
          const traceId = parseInt(cardId.replace('trace_', ''));
          const traceData = traceStore.traces[traceId];
          if (traceData?.card_id) {
            console.log(`[DEBUG] 恢复 trace 卡片 ${cardId} 的宿主卡片 ${traceData.card_id} 到折叠状态:`, hostShouldCollapse);
            if (hostShouldCollapse) {
              reactFlowViewRef.current?.collapseCard(traceData.card_id);
            } else {
              reactFlowViewRef.current?.expandCard(traceData.card_id);
            }
          }
        }
      }

      // 清除记录的状态
      setCollapsedStateBeforeDetailView(prev => {
        const newState = { ...prev };
        delete newState[cardId];
        delete newState[`host_${cardId}`]; // 也清除宿主卡片的状态记录
        console.log(`[DEBUG] 清除卡片 ${cardId} 的记录状态, 剩余状态:`, newState);
        return newState;
      });
    } else {
      console.log(`[DEBUG] 没有选中的卡片，跳过恢复逻辑`);
    }

    setSelectedCard(null);
    setSelectedAgentId('');
    setIsDetailOpen(false); // 关闭详情面板
    setIsDetailFullscreen(false); // 关闭详情时重置全屏状态
    setActiveToolConnection(null);
    setPendingToolConnection(null);
  };

  // 处理切换全屏
  const handleToggleDetailFullscreen = () => {
    setIsDetailFullscreen(!isDetailFullscreen);
  };

  // 处理当前显示Agent变化
  const handleCurrentAgentChange = (agentId: string) => {
    // console.log('[MainLayout] 当前显示Agent变化:', agentId);
    setCurrentDisplayAgentId(agentId);
  };

  // 处理 ReactFlow Agent 切换
  const handleReactFlowAgentSwitch = (agentId: string) => {
    setCurrentReactFlowAgentId(agentId);
    setCurrentDisplayAgentId(agentId); // 同时更新当前显示的 Agent ID
  };

  // 处理ActionInputBox关闭
  const handleCloseActionInputBox = () => {
    setShowActionInputBox(false);
    setActionType(null);
    setTriggerCardId('');
    setIsSelectionMode(false); // 关闭时退出选择模式
    setSelectedCardsForAction([]); // 清空选中卡片
  };

  // 处理切换选择模式
  const handleToggleSelectionMode = () => {
    setIsSelectionMode(prev => !prev);
  };

  // 处理ActionInputBox发送
  const handleActionInputBoxSend = (message: string, selectedCards: string[], actionType: 'report' | 'visualize') => {
    // console.log('ActionInputBox发送:', { message, selectedCards, actionType });
    // TODO: 实现具体的发送逻辑
    // 这里可以调用相应的API或更新store
  };

  // 处理开始研究
  const handleStartResearch = (message: string) => {
    setShowWelcome(false);
    setIsProcessing(true);
    api.startResearch(message);
  };

  // 引用卡片时展开并聚焦 ReactFlow 节点，同时打开详情
  const revealCardFromReference = async (cardId: string, skipModeSwitch: boolean = false): Promise<void> => {
    if (!cardId) return;

    const card = cardStore.getCard(cardId);
    if (!card) {
      console.warn('[MainLayout] 未找到引用对应的卡片:', cardId);
      return;
    }

    setShowWelcome(false);
    await reactFlowViewRef.current?.expandCard(cardId);

    // 先打开 DetailView，让它完成动画
    handleShowCardDetail(card, card.card_id || cardId);

    // 等待 500ms 让 DetailView 动画完成，确保布局稳定后再执行 focus
    await new Promise(resolve => setTimeout(resolve, 500));

    // 总是聚焦（移动卡片到中间），但如果是系统自动点击（skipModeSwitch=true），则不退出 auto 模式
    reactFlowViewRef.current?.focusCard(cardId, skipModeSwitch);
  };

  // 隐藏所有连接线
  const hideConnections = useCallback(() => {
    reactFlowViewRef.current?.hideConnections();
  }, []);

  // 显示所有连接线
  const showConnections = useCallback(() => {
    reactFlowViewRef.current?.showConnections();
  }, []);

  // 统一的右键处理函数（用于右键消息和右键卡片）
  const handleUnifiedCardRightClick = useCallback(async (cardId: string, skipModeSwitch: boolean = false): Promise<void> => {
    console.log(`[DEBUG] handleUnifiedCardRightClick 被调用, cardId: ${cardId}, skipModeSwitch: ${skipModeSwitch}, 当前选中卡片:`, selectedCard);

    // 隐藏所有连接线，避免整个右键过程中的动画显示
    hideConnections();

    if (!cardId) {
      showConnections();
      return;
    }

    let card: Card;

    // 检查是否是 trace 卡片
    if (cardId.startsWith('trace_')) {
      // 从 traceStore 中构造虚拟卡片
      const traceId = parseInt(cardId.replace('trace_', ''));
      const traceData = traceStore.traces[traceId];

      if (!traceData) {
        console.warn('[MainLayout] 未找到 trace 数据:', traceId);
        showConnections();
        return;
      }

      // 获取宿主卡片
      const hostCard = cardStore.getCard(traceData.card_id!);
      if (!hostCard) {
        console.warn('[MainLayout] 未找到 trace 宿主卡片:', traceData.card_id);
        showConnections();
        return;
      }

      // 构造虚拟 trace 卡片（与 ReactFlowView 中的逻辑保持一致）
      const traceSupportContentList = Array.isArray(traceData.support_content_list)
        ? traceData.support_content_list
        : [];
      const hostTitle = hostCard.card_content?.card_title || hostCard.card_type || 'Trace Result';
      const hostCardContentClone: any = hostCard.card_content ? JSON.parse(JSON.stringify(hostCard.card_content)) : {};

      card = {
        card_id: cardId,
        card_type: 'trace_result',
        displayed_card_type: hostCard.displayed_card_type || hostCard.card_type,
        status: 'completed',
        card_content: {
          ...hostCardContentClone,
          card_title: hostTitle,
          trace_support_content_list: traceSupportContentList,
          trace_host_card_id: hostCard.card_id,
          trace_host_card_type: hostCard.card_type,
          trace_host_card_title: hostTitle,
          trace_host_card_content: hostCardContentClone,
          card_main_content_with_highlight: traceData.card_main_content_with_highlight,
          card_type_description: hostCard.card_content?.card_type_description || hostCard.displayed_card_type || hostCard.card_type,
        },
        card_ref: [],
      };
    } else {
      // 普通卡片从 cardStore 获取
      card = cardStore.getCard(cardId);
      if (!card) {
        console.warn('[MainLayout] 未找到卡片:', cardId);
        showConnections();
        return;
      }
    }

    // 直接获取当前选中的卡片ID（避免异步状态问题）
    const currentSelectedCardId = selectedCard?.card_id;

    // 如果当前有选中的卡片且不是同一个卡片，先恢复之前卡片的状态
    if (currentSelectedCardId && currentSelectedCardId !== cardId) {
      const prevCardId = currentSelectedCardId;
      const shouldCollapse = collapsedStateBeforeDetailView[prevCardId];
      console.log(`[DEBUG] 右键新卡片前，先恢复之前卡片 ${prevCardId} 的状态:`, shouldCollapse);

      if (shouldCollapse !== undefined) {
        console.log(`[DEBUG] 恢复之前卡片 ${prevCardId} 到折叠状态:`, shouldCollapse);

        if (shouldCollapse) {
          await reactFlowViewRef.current?.collapseCard(prevCardId);
        } else {
          await reactFlowViewRef.current?.expandCard(prevCardId);
        }
      }

      // 如果之前卡片是 trace 卡片，也恢复其宿主卡片状态
      if (prevCardId.startsWith('trace_')) {
        const hostKey = `host_${prevCardId}`;
        const hostShouldCollapse = collapsedStateBeforeDetailView[hostKey];
        if (hostShouldCollapse !== undefined) {
          const traceId = parseInt(prevCardId.replace('trace_', ''));
          const traceData = traceStore.traces[traceId];
          if (traceData?.card_id) {
            console.log(`[DEBUG] 恢复之前 trace 卡片 ${prevCardId} 的宿主卡片 ${traceData.card_id} 到折叠状态:`, hostShouldCollapse);
            if (hostShouldCollapse) {
              await reactFlowViewRef.current?.collapseCard(traceData.card_id);
            } else {
              await reactFlowViewRef.current?.expandCard(traceData.card_id);
            }
          }
        }
      }

      // 清除记录的状态
      setCollapsedStateBeforeDetailView(prev => {
        const newState = { ...prev };
        delete newState[prevCardId];
        delete newState[`host_${prevCardId}`]; // 也清除宿主卡片的状态记录
        console.log(`[DEBUG] 清除之前卡片 ${prevCardId} 的记录状态, 剩余状态:`, newState);
        return newState;
      });
    }

    // 记录当前折叠状态
    const isCurrentlyCollapsed = reactFlowViewRef.current?.getCardCollapsedState(cardId) ?? false;
    setCollapsedStateBeforeDetailView(prev => {
      const newState = {
        ...prev,
        [cardId]: isCurrentlyCollapsed
      };
      return newState;
    });

    setShowWelcome(false);

    // 如果卡片是折叠的，先展开它
    if (isCurrentlyCollapsed) {
      await reactFlowViewRef.current?.expandCard(cardId);
    }

    // 对于 trace 卡片，额外确保宿主卡片也是展开的
    if (cardId.startsWith('trace_')) {
      const traceId = parseInt(cardId.replace('trace_', ''));
      const traceData = traceStore.traces[traceId];
      if (traceData?.card_id) {
        const hostCardId = traceData.card_id;
        const hostCollapsed = reactFlowViewRef.current?.getCardCollapsedState(hostCardId) ?? false;

        // 记录宿主卡片的原始状态
        setCollapsedStateBeforeDetailView(prev => ({
          ...prev,
          [`host_${cardId}`]: hostCollapsed // 用特殊 key 记录宿主卡片状态
        }));

        if (hostCollapsed) {
          console.log(`[DEBUG] Trace 卡片 ${cardId} 的宿主卡片 ${hostCardId} 是折叠的，正在展开`);
          await reactFlowViewRef.current?.expandCard(hostCardId);
        }
      }
    }

    // 检查是否需要打开 DetailView
    const needOpenDetailView = !isDetailOpen;

    // 先打开 DetailView
    handleShowCardDetail(card, card.card_id || cardId);

    if (needOpenDetailView) {
      // 如果需要打开 DetailView，等待动画完成后再 focus 和显示连接线
      setTimeout(() => {
        // 聚焦到当前卡片
        reactFlowViewRef.current?.focusCard(cardId, skipModeSwitch);
        // 显示连接线
        showConnections();
      }, 500); // DetailView 动画时间
    } else {
      // 如果 DetailView 已经打开，立即 focus 和显示连接线
      reactFlowViewRef.current?.focusCard(cardId, skipModeSwitch);
      showConnections();
    }
  }, [cardStore, setCollapsedStateBeforeDetailView, setShowWelcome, reactFlowViewRef, selectedCard, hideConnections, showConnections, isDetailOpen]);


  // 处理工具消息点击
  const handleToolMessageClick = useCallback(async (payload: { cardId: string; messageId: string; color?: string; isAutoClick?: boolean; isShortcutClick?: boolean }) => {
    if (!payload?.cardId) return;

    // 如果是快捷键触发的，先调用 ChatView 的处理函数，更新 current/previous 并处理收起逻辑
    if (payload.isShortcutClick === true) {
      if (chatViewRef.current) {
        await chatViewRef.current.handleShortcutCardClick(payload.cardId);
      }
    }

    // 如果是手动点击（既不是 auto 模式触发的，也不是快捷键触发的），清除快捷键状态
    if (payload.isAutoClick !== true && payload.isShortcutClick !== true) {
      if (chatViewRef.current) {
        chatViewRef.current.clearShortcutState();
      }
    }

    // 如果是系统自动点击（isAutoClick=true），则聚焦但不退出 auto 模式
    // 如果是人类点击，则正常聚焦并退出 auto 模式
    const skipModeSwitch = payload.isAutoClick === true;

    // 使用统一的右键处理逻辑（会记录折叠状态）
    await handleUnifiedCardRightClick(payload.cardId, skipModeSwitch);
  }, [handleUnifiedCardRightClick]);

  // 处理快捷键点击卡片：更新快捷键专属的 current/previous，并根据 type 决定是否收起 previous

  // 处理引用点击（与工具消息点击逻辑相同）
  const handleCitationClick = (cardId: string) => {
    revealCardFromReference(cardId);
  };

  const handleToolMessageHover = (payload: { cardId: string; color?: string } | null) => {
    setHoveredToolCard(payload);
  };

  // 处理收缩卡片（用于 Auto 模式）
  const handleCollapseCard = useCallback(async (cardId: string): Promise<void> => {
    await reactFlowViewRef.current?.collapseCard(cardId);
  }, []);

  // 处理连接线坐标计算 - 用于智能 refocus
  const handleConnectionCalculated = useCallback((startX: number, targetX: number, cardId: string) => {
    // 如果连接线起点在右侧，终点在左侧（startX > targetX），说明连接线从右到左
    // 这通常意味着卡片在左侧，消息在右侧，用户可能需要重新聚焦到卡片
    if (startX > targetX) {
      // 清除之前的定时器，实现防抖（500ms 内最多触发一次）
      if (connectionRefocusTimeoutRef.current) {
        clearTimeout(connectionRefocusTimeoutRef.current);
      }

      connectionRefocusTimeoutRef.current = setTimeout(() => {
        // 检查是否处于 auto 模式且 DetailView 已打开
        const isAutoMode = reactFlowViewRef.current?.getViewMode() === 'auto';
        const hasOpenDetailView = isDetailOpen && selectedCard;

        if (isAutoMode && hasOpenDetailView && selectedCard?.card_id === cardId) {
          // 直接聚焦到当前 DetailView 卡片，不退出 auto 模式，不等待延迟
          reactFlowViewRef.current?.focusCard(cardId, true);
        }
      }, 500);
    }
  }, [isDetailOpen, selectedCard]);

  // 获取工具颜色的辅助函数
  const getToolColor = useCallback((firstToolDescription: string, status?: string): string => {
    if (status === 'cancelled') {
      return '#C4C4C4';
    }
    let normalizedDescription = firstToolDescription;
    while (normalizedDescription.length > 0 && (normalizedDescription.endsWith(':') || normalizedDescription.endsWith(' '))) {
      normalizedDescription = normalizedDescription.slice(0, -1);
    }
    if (normalizedDescription === 'Search Web') {
      return '#387BFF';
    } else if (normalizedDescription === 'Scrape Webpage') {
      return '#50B230';
    } else if (normalizedDescription === 'Create Note') {
      return '#E73232';
    } else if (normalizedDescription === 'Trace Source') {
      return '#FF9900';
    } else {
      return '#000000';
    }
  }, []);

  // 处理快捷键：跳转到下一条 tool message
  const handleNextToolMessage = useCallback(async () => {
    // 获取所有 tool message 中有 bind_card_id 的消息
    const toolMessages = chatStore.chatList.filter(msg =>
      msg.chat_type === 'tool_message' && msg.chat_content.bind_card_id
    );

    if (toolMessages.length === 0) {
      return;
    }

    // 找到当前显示的卡片ID（如果 detail view 打开的话）
    let currentCardId = selectedCard?.card_id || null;

    // 如果没有当前卡片，找第一个 tool message
    if (!currentCardId) {
      const firstToolMessage = toolMessages[0];
      if (firstToolMessage.chat_content.bind_card_id) {
        // 隐藏连接线，避免动画期间显示
        hideConnections();
        // 处理快捷键折叠逻辑
        if (chatViewRef.current) {
          await chatViewRef.current.handleShortcutCardClick(firstToolMessage.chat_content.bind_card_id);
        }
        await revealCardFromReference(firstToolMessage.chat_content.bind_card_id, false);
        // 显示连接线
        showConnections();
      }
      return;
    }

    // 找到当前卡片对应的 tool message 索引
    let currentIndex = -1;
    for (let i = 0; i < toolMessages.length; i++) {
      if (toolMessages[i].chat_content.bind_card_id === currentCardId) {
          currentIndex = i;
          break;
      }
    }

    // 如果找不到当前卡片，找第一个
    if (currentIndex === -1) {
      const firstToolMessage = toolMessages[0];
      if (firstToolMessage.chat_content.bind_card_id) {
        // 隐藏连接线，避免动画期间显示
        hideConnections();
        // 处理快捷键折叠逻辑
        if (chatViewRef.current) {
          await chatViewRef.current.handleShortcutCardClick(firstToolMessage.chat_content.bind_card_id);
        }
        await revealCardFromReference(firstToolMessage.chat_content.bind_card_id, false);
        // 显示连接线
        showConnections();
      }
      return;
    }

    // 找下一个（循环）
    const nextIndex = (currentIndex + 1) % toolMessages.length;
    const nextToolMessage = toolMessages[nextIndex];
    if (nextToolMessage.chat_content.bind_card_id) {
      // 隐藏连接线，避免动画期间显示
      hideConnections();
      // 处理快捷键折叠逻辑
          if (chatViewRef.current) {
        await chatViewRef.current.handleShortcutCardClick(nextToolMessage.chat_content.bind_card_id);
      }
      await revealCardFromReference(nextToolMessage.chat_content.bind_card_id, false);
      // 显示连接线
      showConnections();
          }
  }, [selectedCard]);

  // 处理快捷键：跳转到上一条 tool message
  const handlePreviousToolMessage = useCallback(async () => {
    // 获取所有 tool message 中有 bind_card_id 的消息
    const toolMessages = chatStore.chatList.filter(msg =>
      msg.chat_type === 'tool_message' && msg.chat_content.bind_card_id
    );

    if (toolMessages.length === 0) {
          return;
        }

    // 找到当前显示的卡片ID（如果 detail view 打开的话）
    let currentCardId = selectedCard?.card_id || null;

    // 如果没有当前卡片，从最后一个开始
    if (!currentCardId) {
      const lastToolMessage = toolMessages[toolMessages.length - 1];
      if (lastToolMessage.chat_content.bind_card_id) {
        // 隐藏连接线，避免动画期间显示
        hideConnections();
        // 处理快捷键折叠逻辑
        if (chatViewRef.current) {
          await chatViewRef.current.handleShortcutCardClick(lastToolMessage.chat_content.bind_card_id);
        }
        await revealCardFromReference(lastToolMessage.chat_content.bind_card_id, false);
        // 显示连接线
        showConnections();
      }
      return;
            }

    // 找到当前卡片对应的 tool message 索引
    let currentIndex = -1;
    for (let i = 0; i < toolMessages.length; i++) {
      if (toolMessages[i].chat_content.bind_card_id === currentCardId) {
          currentIndex = i;
          break;
      }
    }

    // 如果找不到当前卡片，从最后一个开始
    if (currentIndex === -1) {
      const lastToolMessage = toolMessages[toolMessages.length - 1];
      if (lastToolMessage.chat_content.bind_card_id) {
        // 隐藏连接线，避免动画期间显示
        hideConnections();
        // 处理快捷键折叠逻辑
        if (chatViewRef.current) {
          await chatViewRef.current.handleShortcutCardClick(lastToolMessage.chat_content.bind_card_id);
        }
        await revealCardFromReference(lastToolMessage.chat_content.bind_card_id, false);
        // 显示连接线
        showConnections();
      }
      return;
    }

    // 找上一个（循环）
    const prevIndex = currentIndex === 0 ? toolMessages.length - 1 : currentIndex - 1;
    const prevToolMessage = toolMessages[prevIndex];
    if (prevToolMessage.chat_content.bind_card_id) {
      // 隐藏连接线，避免动画期间显示
      hideConnections();
      // 处理快捷键折叠逻辑
          if (chatViewRef.current) {
        await chatViewRef.current.handleShortcutCardClick(prevToolMessage.chat_content.bind_card_id);
          }
      await revealCardFromReference(prevToolMessage.chat_content.bind_card_id, false);
      // 显示连接线
      showConnections();
    }
  }, [selectedCard]);

  // 监听键盘快捷键
  useEffect(() => {
    // 使用 keyup 事件，因为某些浏览器在 keydown 时会拦截组合键
    // 只监听 keyup 可以避免重复触发（keydown 和 keyup 都会触发会导致执行两次）
    const handleKeyUp = (event: KeyboardEvent) => {
      // 检查是否按下了 ctrl+shift+x 或 alt+shift+x（下移到下一个 tool message）
      const isX = event.key === 'X' || event.key === 'x' || event.code === 'KeyX';
      const isCtrlShiftX = event.ctrlKey && event.shiftKey && isX;
      const isAltShiftX = event.altKey && event.shiftKey && isX;
      
      if (isCtrlShiftX || isAltShiftX) {
        event.preventDefault();
        event.stopPropagation();
        handleNextToolMessage();
        return;
      }

      // 检查是否按下了 ctrl+shift+z 或 alt+shift+z（上移到上一个 tool message）
      const isZ = event.key === 'Z' || event.key === 'z' || event.code === 'KeyZ';
      const isCtrlShiftZ = event.ctrlKey && event.shiftKey && isZ;
      const isAltShiftZ = event.altKey && event.shiftKey && isZ;

      if (isCtrlShiftZ || isAltShiftZ) {
        event.preventDefault();
        event.stopPropagation();
        handlePreviousToolMessage();
        return;
      }

      // 检查是否按下了 ctrl+shift+i（中断代理）
      const isI = event.key === 'I' || event.key === 'i' || event.code === 'KeyI';
      const isCtrlShiftI = event.ctrlKey && event.shiftKey && isI;

      if (isCtrlShiftI) {
        event.preventDefault();
        event.stopPropagation();
        handleStopProcessing();
        return;
      }
    };

    // 使用 capture 模式，确保能捕获到事件（即使被其他元素拦截）
    document.addEventListener('keyup', handleKeyUp, true);
    return () => {
      document.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [handleNextToolMessage, handlePreviousToolMessage, handleStopProcessing]);

  const handleTraceProcessStart = useCallback(
    ({ cardTitle, cardType, position }: { cardTitle: string; cardType?: string; position?: { x: number; y: number } }) => {
      if (position) {
        // 让 traceProcess 的右半部分与 Trace 按钮对齐：
        // DetailView 传进来的 position.x 是“按钮右侧”的绝对坐标。
        // 这里用它减去自身宽度，得到 traceProcess 的 left。
        const TRACE_PROCESS_WIDTH = 180; // 与 .trace-process 的宽度保持一致
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;

        let nextX = position.x - TRACE_PROCESS_WIDTH;
        // 防止完全出右侧边界，同时也避免跑到屏幕左侧太远
        nextX = Math.min(Math.max(nextX, 8), Math.max(viewportWidth - TRACE_PROCESS_WIDTH - 8, 8));

        setTraceProcessPosition({
          x: nextX,
          y: Math.max(0, position.y),
        });
      }

      setTraceProcessState({
        isVisible: true,
        cardTitle,
        cardType,
        status: null,
      });
    },
    []
  );

  const showGlobalBanner = useCallback(
    (message: string, type: 'error' | 'info' = 'info', duration = 3000) => {
      setGlobalBanner({
        message,
        type,
        visible: true,
      });

      if (bannerTimeoutRef.current) {
        window.clearTimeout(bannerTimeoutRef.current);
      }

      bannerTimeoutRef.current = window.setTimeout(() => {
        setGlobalBanner(prev => ({
          ...prev,
          visible: false,
        }));
      }, duration);
    },
    []
  );

  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current) {
        window.clearTimeout(bannerTimeoutRef.current);
      }
    };
  }, []);

  const handleCloseTraceProcess = useCallback(() => {
    setTraceProcessState({
      isVisible: false,
      cardTitle: '',
      cardType: undefined,
      status: null,
    });
  }, []);

  useEffect(() => {
    if (!historyStore.currentProjectId || showWelcome) {
      setTraceProcessState({
        isVisible: false,
        cardTitle: '',
        cardType: undefined,
        status: null,
      });
    }
  }, [historyStore.currentProjectId, showWelcome]);

  const traceProcessCircleColor = getTraceProcessCircleColor(traceProcessState.cardType);
  const traceProcessIconSrc = getTraceProcessIcon(traceProcessState.cardType);

  return (
    <Box className="main-layout">
      {globalBanner.visible && globalBanner.message && (
        <div className={`global-banner ${globalBanner.type}`}>
          {globalBanner.message}
        </div>
      )}
      {/* 隐藏文件输入，挂载在 DOM，确保点击可用 */}
      <input
        type="file"
        accept="application/json,.pkl"
        ref={importInputRef}
        onChange={handleImportInputChange}
        style={{ position: 'fixed', left: '-10000px', top: '-10000px', opacity: 0 }}
      />
      
      {/* 顶部 Head Bar */}
      <Box className="head-bar">
        <img 
          src="/resource/VisualDeepResearch.svg" 
          alt="Visual Deep Research Logo" 
          className="head-bar-logo"
        />
        <img 
          src="/resource/visualdeeprsearchtxt.svg" 
          alt="Visual Deep Research Text Logo" 
          className="head-bar-title"
        />
        <div className="head-bar-actions">
          <button 
            className="head-bar-button"
            onClick={handleImportProject}
            title="Import"
          >
            <img src="/resource/import.svg" alt="Import" />
          </button>
          <button 
            className="head-bar-button"
            onClick={() => handleExportProject(historyStore.currentProjectId)}
            title="Export"
            disabled={!historyStore.currentProjectId}
          >
            <img src="/resource/export.svg" alt="Export" />
          </button>
          <div className="head-bar-divider"></div>
          <button 
            className="head-bar-button"
            onClick={handleHelp}
            title="Help"
          >
            <img src="/resource/help.svg" alt="Help" />
          </button>
        </div>
      </Box>
      
      {/* 内容区域 */}
      <Box className="content-area">
        {/* 左侧聊天面板 - 只在非欢迎界面时显示 */}
        {!showWelcome && (
          <Box className="chat-panel">
            <ChatView
              ref={chatViewRef}
              messages={chatStore.getChatMessages()}
              onSendMessage={handleSendMessage}
              researchCompleted={false}
              errorInterrupt={false}
              isProcessing={isProcessing}
              onStopProcessing={handleStopProcessing}
              currentAgentId={currentDisplayAgentId}
              currentProjectId={historyStore.currentProjectId}
              onToolMessageClick={handleToolMessageClick}
              onToolMessageHover={handleToolMessageHover}
              isAutoMode={isAutoMode}
              onCollapseCard={handleCollapseCard}
            />
          </Box>
        )}

        {/* 中间ReactFlow视图 */}
        <Box className="reactflow-panel">
          {showWelcome ? (
            <WelcomeView 
              onStartResearch={handleStartResearch} 
              isProcessing={isProcessing}
            />
          ) : (
            <ReactFlowView
              ref={reactFlowViewRef}
              onCardClick={handleShowCardDetail}
              isSelectionMode={isSelectionMode}
              selectedCardsForAction={selectedCardsForAction}
              onCurrentCardChange={handleCurrentAgentChange}
              currentCardId={currentReactFlowAgentId}
              onCardSwitch={handleReactFlowAgentSwitch}
              onHideToolConnection={() => {
                // ToolMessageConnection 现在会自动显示，不需要手动隐藏
              }}
              selectedCardId={selectedCard?.card_id || ''}
              isDetailOpen={isDetailOpen}
              onCloseDetail={handleCloseDetail}
              hoveredToolCard={hoveredToolCard}
              detailConnectionCardId={selectedCard?.card_id || null}
              detailConnectionCardType={selectedCard?.card_type || null}
              detailConnectionOpen={isDetailOpen && !!selectedCard}
              onUnifiedRightClick={handleUnifiedCardRightClick}
              onConnectionCalculated={handleConnectionCalculated}
            />
          )}
        </Box>

        {/* 右侧详情面板 - 只在非欢迎界面时显示 */}
        {!showWelcome && (
          <Box className={`detail-panel ${isDetailOpen && selectedCard ? 'open' : 'closed'}`}>
            {isDetailOpen && selectedCard && (
              <DetailView
                card={selectedCard}
                agentId={selectedAgentId}
                onClose={handleCloseDetail}
                isFullscreen={isDetailFullscreen}
                onToggleFullscreen={handleToggleDetailFullscreen}
                onCitationHover={handleToolMessageHover}
                onCitationClick={handleCitationClick}
                onTraceProcessStart={handleTraceProcessStart}
                isTraceProcessBusy={traceProcessState.isVisible && !traceProcessState.status}
                onTraceProcessBlocked={() => showGlobalBanner('Please wait for the current trace to finish.', 'error')}
              />
            )}
          </Box>
        )}
      </Box>

      {/* ActionInputBox - 全局输入框 */}
      <ActionInputBox
        isVisible={showActionInputBox}
        actionType={actionType}
        triggerCardId={triggerCardId}
        onClose={handleCloseActionInputBox}
        onSend={handleActionInputBoxSend}
        isSelectionMode={isSelectionMode}
        onToggleSelectionMode={handleToggleSelectionMode}
        selectedCards={selectedCardsForAction}
      />


      {traceProcessState.isVisible && (
        <div
          className="trace-process"
          ref={traceProcessRef}
          style={{
            left: `${traceProcessPosition.x}px`,
            top: `${traceProcessPosition.y}px`,
          }}
          onMouseDown={e => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            setTraceProcessDragOffset({
              x: e.clientX - rect.left,
              y: e.clientY - rect.top,
            });
            setIsTraceProcessDragging(true);
          }}
        >
          {traceProcessState.status && (
            <button
              type="button"
              className="trace-process-close"
              aria-label="Close trace process panel"
              onClick={e => {
                e.stopPropagation();
                handleCloseTraceProcess();
              }}
              onMouseDown={e => e.stopPropagation()}
            >
              ×
            </button>
          )}
          <div
            className="trace-process-icon"
            style={{ backgroundColor: traceProcessCircleColor }}
          >
            <img
              src={traceProcessIconSrc}
              alt="Trace process card type"
              className="trace-process-icon-image"
            />
          </div>

          {/* 内部内容矩形：显示标题 */}
          <div className="trace-process-body">
            <div className="trace-process-title" title={traceProcessState.cardTitle}>
              {traceProcessState.cardTitle || 'Tracing source'}
            </div>
          </div>

          {/* 外部矩形下半部分：显示加载中的 ... / 结果图标 和文字 */}
          <div className="trace-process-footer">
            {traceProcessState.status === 'Success' ? (
              <div className="trace-process-result-icon" aria-label="Trace success">
                <img src="/resource/complete.svg" alt="Trace success" />
              </div>
            ) : traceProcessState.status === 'Failed' ? (
              <div className="trace-process-result-icon" aria-label="Trace failed">
                <img src="/resource/failed.svg" alt="Trace failed" />
              </div>
            ) : (
              <div className="trace-process-dots" aria-label="Tracing source">
                <span />
                <span />
                <span />
              </div>
            )}
            <div className="trace-process-text">
              {traceProcessState.status === 'Success'
                ? 'Got support'
                : traceProcessState.status === 'Failed'
                ? 'Lacking support'
                : 'Finding support'}
            </div>
          </div>
        </div>
      )}
    </Box>
  );
});

export default MainLayout;