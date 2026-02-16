import React, { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef } from 'react';
import { Typography, TextField, IconButton, Box, Chip, List, ListItem, ListItemIcon, ListItemText, Avatar, Tooltip } from '@mui/material';
import { ArrowUpward as ArrowUpwardIcon, Stop as StopIcon, CheckCircle, RadioButtonUnchecked, Schedule, Person, SmartToy } from '@mui/icons-material';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { observer } from 'mobx-react-lite';
import CardSelector from './CardSelector';
import ThinkingAnimation from './ThinkingAnimation';
import CardRefCollapsed from './CardRefCollapsed';
import type { CardRef, CardReference } from '../../../stores/CardType';
import { cardStore } from '../../../stores/CardStore';
import { chatStore } from '../../../stores/ChatStore';
import './ChatView.scss';

// 扩展全局 Window 接口
declare global {
  interface Window {
    addCardToReference?: (agentId: string, cardId: string, selectedContent?: string | null) => void;
  }
}

// 待办事项项接口
interface TodoItem {
  status: 'pending' | 'in_progress' | 'completed' | 'interrupted';
  content: string;
}

// 工具消息接口
interface ToolMessage {
  first_tool_description: string;
  second_tool_description: string;
  detail: string | null;
  bind_card_id: string | null;
  status?: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

// 聊天消息接口 - 支持新的消息类型
interface Message {
  type: 'user_message' | 'assistant_message' | 'todo_list' | 'tool_message' | 'system_message' | 'error' | 'thinking' | 'progress_summary_message';
  content: string | TodoItem[] | ToolMessage | React.ReactElement | { progress_summary: string; status?: string } | any; // any for user_message chat_content
  reference_list?: CardReference[]; // 用户消息的引用列表
}

interface ToolMessageClickPayload {
  cardId: string;
  messageId: string;
  color?: string;
  isAutoClick?: boolean; // 新增：标识是否为系统自动点击
}

interface ChatViewProps {
  messages: Message[];
  onSendMessage?: (message: string, cardRef: CardReference[]) => void;
  researchCompleted?: boolean;
  errorInterrupt?: boolean;
  isProcessing?: boolean;
  onStopProcessing?: () => void;
  currentAgentId?: string; // 新增：当前Agent ID
  currentProjectId?: string; // 新增：当前项目ID，用于检测项目切换
  onToolMessageClick?: (payload: ToolMessageClickPayload) => void; // 新增：工具消息点击回调
  onToolMessageHover?: (payload: { cardId: string; color?: string } | null) => void; // 新增：工具消息悬浮回调
  isAutoMode?: boolean; // 新增：是否为自动模式
  onCollapseCard?: (cardId: string) => void; // 新增：收缩卡片回调
}

// ChatView 的 ref 接口
export interface ChatViewRef {
  handleShortcutCardClick: (cardId: string) => Promise<void>;
  clearShortcutState: () => void; // 清除快捷键的 current/previous 状态
  scrollToToolMessage: (messageId: string, direction: 'next' | 'previous') => void; // 滚动到指定的 tool message
  scrollToLatestMessage: () => void; // 滚动到最新的消息
}

// 自定义 hook 用于跟踪之前的值
function usePrevious<T>(value: T): T | undefined {
  const ref = useRef<T>();
  useEffect(() => {
    ref.current = value;
  });
  return ref.current;
}

const ChatView = forwardRef<ChatViewRef, ChatViewProps>(({ 
  messages, 
  onSendMessage, 
  researchCompleted, 
  errorInterrupt,
  isProcessing = false,
  onStopProcessing,
  currentAgentId,
  currentProjectId,
  onToolMessageClick,
  onToolMessageHover,
  isAutoMode = false,
  onCollapseCard
}, ref) => {
  const [inputValue, setInputValue] = useState<string>('');
  const [selectedCards, setSelectedCards] = useState<CardReference[]>([]);
  const [showCardSelector, setShowCardSelector] = useState<boolean>(false);
  const [selectorPosition, setSelectorPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [mentionStartIndex, setMentionStartIndex] = useState<number>(-1);
  const [mentionSearchTerm, setMentionSearchTerm] = useState<string>('');
  
  // 跟踪新增消息的状态和打字机效果
  const [newMessageIndices, setNewMessageIndices] = useState<Set<number>>(new Set());
  const [typewriterMessages, setTypewriterMessages] = useState<Map<number, string>>(new Map());
  // 跟踪 tool message 的悬浮状态
  const [hoveredToolMessageId, setHoveredToolMessageId] = useState<string | null>(null);
  const previousMessages = usePrevious(messages);
  const previousAgentId = usePrevious(currentAgentId); // 跟踪之前的Agent ID
  const previousProjectId = usePrevious(currentProjectId); // 跟踪之前的项目ID
  // 使用 ref 来跟踪项目ID，确保在项目切换时立即检测到
  const projectIdRef = useRef<string | undefined>(currentProjectId);
  // 使用 ref 来标记是否刚刚切换了项目
  const isProjectSwitchingRef = useRef<boolean>(false);
  // 使用 ref 来标记是否等待项目切换后的第一次更新（用于处理空项目首次加载的情况）
  const waitingFirstUpdateRef = useRef<boolean>(false);

  // 过滤出有效消息，避免读取未定义的 message.type 造成运行时错误
  const safeMessages = React.useMemo(() => (
    Array.isArray(messages) ? messages.filter((m) => m && typeof (m as any).type === 'string') : []
  ), [messages]);
  
  // 动画队列状态管理
  const [animationQueue, setAnimationQueue] = useState<number[]>([]);
  const [currentAnimatingIndex, setCurrentAnimatingIndex] = useState<number>(-1);
  const [isAnimationPlaying, setIsAnimationPlaying] = useState<boolean>(false);
  const animationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // 使用 ref 立即跟踪待动画的消息索引，避免状态更新延迟导致的闪烁
  const pendingAnimationIndicesRef = useRef<Set<number>>(new Set());
  // 使用 ref 跟踪已确认显示的消息索引（这些消息已经完成动画或不需要动画）
  const confirmedMessageIndicesRef = useRef<Set<number>>(new Set());
  // 使用 ref 跟踪已经处理过的消息索引（避免重复处理）
  const processedMessageIndicesRef = useRef<Set<number>>(new Set());
  
  // Auto 模式相关：跟踪当前激活的 tool message cardId
  const activeToolMessageCardIdRef = useRef<string | null>(null);
  // Auto 模式相关：跟踪前一个 tool message 的 cardId（用于收起逻辑）
  const previousToolMessageCardIdRef = useRef<string | null>(null);
  // Auto 模式相关：跟踪已自动点击的 tool message 索引（避免重复点击）
  const autoClickedToolMessageIndicesRef = useRef<Set<number>>(new Set());
  // Auto 模式相关：跟踪正在等待重试的 tool message（等待 status 变为 completed）
  const pendingRetryToolMessagesRef = useRef<Map<number, { startTime: number; retryCount: number }>>(new Map());
  
  // 快捷键专属：跟踪当前激活的卡片 cardId
  const activeShortcutCardIdRef = useRef<string | null>(null);
  // 快捷键专属：跟踪前一个卡片的 cardId（用于收起逻辑）
  const previousShortcutCardIdRef = useRef<string | null>(null);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // 新增：消息列表容器引用与是否在底部状态
  const messagesListRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState<boolean>(true);
  const AUTO_SCROLL_THRESHOLD = 10; // 距离底部阈值（px），用于判断"接近底部"
  // 打字机期间的自动跟随控制与节流
  const isAtBottomRef = useRef<boolean>(true);
  const autoFollowRef = useRef<boolean>(false);
  const lastScrollTimeRef = useRef<number>(0);
  // 打字机期间每 3 秒复查一次是否在底部
  const AUTOFOLLOW_RECHECK_MS = 3000;
  const lastAutoFollowCheckRef = useRef<number>(0);
  // 标记是否正在进行快捷键滚动（用于阻止自动下拉）
  const isShortcutScrollingRef = useRef<boolean>(false);

  useEffect(() => {
    isAtBottomRef.current = isAtBottom;
  }, [isAtBottom]);

  const scrollToBottomFast = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  };

  const updateIsAtBottom = useCallback(() => {
    const el = messagesListRef.current;
    if (!el) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - AUTO_SCROLL_THRESHOLD;
    setIsAtBottom(nearBottom);
  }, []);

  // 记录内容高度，用于检测变化
  const lastContentHeightRef = useRef<number>(0);

  const handleMessagesScroll = useCallback(() => {
    updateIsAtBottom();
    if (!isAtBottomRef.current) {
      autoFollowRef.current = false;
    }
  }, [updateIsAtBottom]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    // 仅在用户位于底部或接近底部时自动下拉，否则认为用户正在阅读
    // 但如果正在进行快捷键滚动，则不执行自动下拉
    if (isAtBottom && !isShortcutScrollingRef.current) {
      // 无论消息类型，位于底部时快速追底
      scrollToBottomFast();
    }
    // 注意：不在这里更新 isAtBottom，避免因内容增长导致"已在底部"的状态被误判为不在底部
  }, [messages, isAtBottom]);

  // 监听内容高度变化，处理新消息导致的自动滚动
  useEffect(() => {
    const el = messagesListRef.current;
    if (!el) return;

    const currentHeight = el.scrollHeight;
    const heightDiff = currentHeight - lastContentHeightRef.current;

    // 如果内容高度增加了
    if (heightDiff > 10) { // 10px 阈值，避免微小变化
      // 检查变化前是否在底部附近
      const wasNearBottom = lastContentHeightRef.current > 0 &&
        (lastContentHeightRef.current - (el.scrollTop + el.clientHeight) <= AUTO_SCROLL_THRESHOLD * 2);

      if (wasNearBottom) {
        // 延迟执行，确保渲染完成
        setTimeout(() => {
          scrollToBottomFast();
          // 重新计算底部状态
          updateIsAtBottom();
        }, 0);
      }
    }

    // 更新记录的高度
    lastContentHeightRef.current = currentHeight;
  }, [messages, updateIsAtBottom]);

  // 根据 first_tool_description 和 status 获取颜色（提前定义，供 processAnimationQueue 使用）
  const getToolColor = (firstToolDescription: string, status?: string): string => {
    // 如果状态是 cancelled，固定返回灰色
    if (status === 'cancelled') {
      return '#C4C4C4';
    }
    
    // 删除末尾所有的冒号和空格，直到遇到第一个非空格、非冒号的字符
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
  };

  // 动画队列处理函数
  const processAnimationQueue = useCallback(() => {
    if (animationQueue.length === 0 || isAnimationPlaying) {
      return;
    }

    const nextMessageIndex = animationQueue[0];
    // 如果这条消息已经处理过了，跳过它
    if (processedMessageIndicesRef.current.has(nextMessageIndex)) {
      setAnimationQueue(prev => prev.slice(1));
      return;
    }
    
    setCurrentAnimatingIndex(nextMessageIndex);
    setIsAnimationPlaying(true);

    // 从队列中移除当前处理的消息
    setAnimationQueue(prev => prev.slice(1));
    // 从 ref 中移除，因为已经开始播放动画了
    pendingAnimationIndicesRef.current.delete(nextMessageIndex);
    // 标记为正在处理
    processedMessageIndicesRef.current.add(nextMessageIndex);

    const message = messages[nextMessageIndex];
    
    if (message.type === 'assistant_message') {
      // 处理打字机效果
      const fullText = String(message.content);
      
      // 立即设置空字符串
      setTypewriterMessages(prev => {
        const newMap = new Map(prev);
        newMap.set(nextMessageIndex, '');
        return newMap;
      });

      // 打字机开始时，如果用户在底部，则启用自动跟随
      autoFollowRef.current = isAtBottomRef.current;

      // 启动打字机动画
      setTimeout(() => {
        let currentIndex = 0;
        const typewriterInterval = setInterval(() => {
          currentIndex += 3; // 每次显示3个字符
          // 确保不超过文本长度
          const displayIndex = Math.min(currentIndex, fullText.length);
          if (displayIndex <= fullText.length) {
            setTypewriterMessages(prev => {
              const newMap = new Map(prev);
              newMap.set(nextMessageIndex, fullText.substring(0, displayIndex));
              return newMap;
            });
            // 每隔 1 秒复查一次是否在底部，动态更新自动跟随开关
            {
              const now = Date.now();
              if (now - lastAutoFollowCheckRef.current >= AUTOFOLLOW_RECHECK_MS) {
                updateIsAtBottom();
                autoFollowRef.current = isAtBottomRef.current;
                lastAutoFollowCheckRef.current = now;
              }
            }
            // 若启用自动跟随，则以更快滚动追底（节流控制）
            if (autoFollowRef.current) {
              const now = Date.now();
              if (now - lastScrollTimeRef.current > 50) {
                scrollToBottomFast();
                lastScrollTimeRef.current = now;
              }
            }
            // 如果已经显示完所有文本，清除定时器
            if (displayIndex >= fullText.length) {
              clearInterval(typewriterInterval);
              // 打字机动画完成
              setTimeout(() => {
                setTypewriterMessages(prev => {
                  const newMap = new Map(prev);
                  newMap.delete(nextMessageIndex);
                  return newMap;
                });
                lastAutoFollowCheckRef.current = 0;
                // 打字机结束后，检查用户是否仍然在底部
              // 如果仍然在底部，保持自动跟随；否则关闭
              if (isAtBottomRef.current) {
                // 不改变 autoFollowRef.current，保持 true
              } else {
                autoFollowRef.current = false;
              }
                // 将消息索引添加到已确认集合中
                confirmedMessageIndicesRef.current.add(nextMessageIndex);
                // 从 pendingAnimationIndicesRef 中移除（如果还在的话）
                pendingAnimationIndicesRef.current.delete(nextMessageIndex);
                // 消息已经处理完成，保持在 processedMessageIndicesRef 中（避免重复处理）
                // 标记当前动画完成，处理下一个
                setIsAnimationPlaying(false);
                setCurrentAnimatingIndex(-1);
              }, 500);
            }
          } else {
            clearInterval(typewriterInterval);
            // 打字机动画完成
            setTimeout(() => {
              setTypewriterMessages(prev => {
                const newMap = new Map(prev);
                newMap.delete(nextMessageIndex);
                return newMap;
              });
              lastAutoFollowCheckRef.current = 0;
              // 打字机结束后，检查用户是否仍然在底部
              // 如果仍然在底部，保持自动跟随；否则关闭
              if (isAtBottomRef.current) {
                // 不改变 autoFollowRef.current，保持 true
              } else {
              autoFollowRef.current = false;
              }
              // 将消息索引添加到已确认集合中
              confirmedMessageIndicesRef.current.add(nextMessageIndex);
              // 从 pendingAnimationIndicesRef 中移除（如果还在的话）
              pendingAnimationIndicesRef.current.delete(nextMessageIndex);
              // 消息已经处理完成，保持在 processedMessageIndicesRef 中（避免重复处理）
              // 标记当前动画完成，处理下一个
              setIsAnimationPlaying(false);
              setCurrentAnimatingIndex(-1);
            }, 500);
          }
        }, 7); // 每7ms显示3个字符
      }, 0);
    } else {
      // 非打字机消息，显示普通动画效果
       setNewMessageIndices(prev => new Set(Array.from(prev).concat([nextMessageIndex])));
      
      // 设置动画完成时间（比打字机短）
      animationTimeoutRef.current = setTimeout(() => {
        setNewMessageIndices(prev => {
          const newSet = new Set(prev);
          newSet.delete(nextMessageIndex);
          return newSet;
        });
        if (message.type === 'progress_summary_message') {
          setProgressRevealed(prev => {
            const next = new Set(prev);
            next.add(nextMessageIndex);
            return next;
          });
        }
        // 将消息索引添加到已确认集合中
        confirmedMessageIndicesRef.current.add(nextMessageIndex);
        // 从 pendingAnimationIndicesRef 中移除（如果还在的话）
        pendingAnimationIndicesRef.current.delete(nextMessageIndex);
        // 消息已经处理完成，保持在 processedMessageIndicesRef 中（避免重复处理）
        
        // Auto 模式：tool message 和 user message 动画完成后自动点击和收起前一个卡片
        // 重要：从最新的 messages 数组重新读取消息，而不是使用闭包中捕获的旧对象
        // 因为 bind_card_id 可能在动画期间才更新
        const currentMessage = messages[nextMessageIndex]; // 重新读取最新消息
            
            // 处理 tool message 的自动点击逻辑
        const handleToolMessageAutoClick = (toolMsg: ToolMessage, msgIndex: number) => {
            const toolColor = getToolColor(toolMsg.first_tool_description, toolMsg.status || 'completed');
            const messageId = toolMsg.bind_card_id || 
              `${toolMsg.first_tool_description}-${toolMsg.second_tool_description}`;
            
            // 标记为已自动点击，避免重复
            autoClickedToolMessageIndicesRef.current.add(msgIndex);
            // 从重试列表中移除
            pendingRetryToolMessagesRef.current.delete(msgIndex);
            
            // 重要：如果 cardId 不为 null，先更新 ref（把当前的 cardId 变成 previousCardId，新的 cardId 变成 currentCardId）
            // 这样 previousCardId 就不可能意外地为 null 了
            const newCardId = toolMsg.bind_card_id;
            if (newCardId && newCardId.trim() !== '') {
              // 只有当 cardId 不为 null 时才更新 ref
              previousToolMessageCardIdRef.current = activeToolMessageCardIdRef.current;
              activeToolMessageCardIdRef.current = newCardId;
            }
            
            // 保存前一个 cardId（用于收起逻辑）
            const previousCardId = previousToolMessageCardIdRef.current;
            
            
            
            // 等待 tool message 完全渲染到 DOM 后再点击，确保连接线能正确显示
            requestAnimationFrame(() => {
              setTimeout(() => {
                // 执行点击
                onToolMessageClick?.({
                  cardId: toolMsg.bind_card_id!,
                  messageId,
                  color: toolColor,
                  isAutoClick: true // 标记为系统自动点击
                });
                
                // 处理前一个卡片的收起逻辑（和点击逻辑在同一时机执行）
                if (previousCardId && onCollapseCard) {
                  const previousCard = cardStore.getCard(previousCardId);
                  if (previousCard) {
                    // 根据 unfold_at_start 字段判断是否保持展开
                    // 如果 unfold_at_start 为 true，则保持展开；否则折叠
                    const shouldKeepExpanded = previousCard.unfold_at_start === true;
                    
                    if (!shouldKeepExpanded) {
                      // 延迟一小段时间后收缩，确保新消息的点击已经完成，然后等待动画完成
                      setTimeout(async () => {
                        await onCollapseCard(previousCardId);
                      }, 100);
                    }
                  }
                }
              }, 200); // 延迟 200ms 确保渲染完成
            });
          };

        if (isAutoMode && currentMessage && !autoClickedToolMessageIndicesRef.current.has(nextMessageIndex)) {
          if (currentMessage.type === 'tool_message') {
            const currentToolMessage = currentMessage.content as ToolMessage;
            const status = currentToolMessage?.status || 'completed';

            // 如果 status 是 cancelled，直接跳过，不处理
            if (status === 'cancelled') {
              // 标记为已处理，避免重复检查
              autoClickedToolMessageIndicesRef.current.add(nextMessageIndex);
              // 直接跳过，不执行后续的点击或重试逻辑
            } else {
              const hasBindCard = currentToolMessage?.bind_card_id && currentToolMessage.bind_card_id.trim() !== '';
          
          // 如果 status 是 completed 且有 bind_card_id，立即点击
          if (status === 'completed' && hasBindCard && onToolMessageClick) {
                handleToolMessageAutoClick(currentToolMessage, nextMessageIndex);
          } 
          // 如果 status 是 in_progress 或 cardId 为 null，启动重试机制
          else if (status === 'in_progress' || !hasBindCard) {
            // 记录到重试列表
            pendingRetryToolMessagesRef.current.set(nextMessageIndex, {
              startTime: Date.now(),
              retryCount: 0
            });
            
            // 启动重试机制：定期检查消息状态
            const checkAndRetry = () => {
              // 从 chatStore 获取最新消息（不依赖闭包中的 messages）
              const latestMessages = chatStore.getChatMessages();
              const latestMessage = latestMessages[nextMessageIndex];
              
              if (!latestMessage || latestMessage.type !== 'tool_message') {
                // 消息不存在或类型不对，停止重试
                pendingRetryToolMessagesRef.current.delete(nextMessageIndex);
                return;
              }
              
              const latestToolMessage = latestMessage.content as ToolMessage;
              const latestStatus = latestToolMessage?.status || 'completed';
              const latestHasBindCard = latestToolMessage?.bind_card_id && latestToolMessage.bind_card_id.trim() !== '';
              
              const retryInfo = pendingRetryToolMessagesRef.current.get(nextMessageIndex);
              if (!retryInfo) {
                // 已从重试列表中移除，停止重试
                return;
              }
              
              // 检查是否超时（最多等待 30 秒）
              const elapsed = Date.now() - retryInfo.startTime;
              const MAX_WAIT_TIME = 30000; // 30 秒
              
              if (elapsed > MAX_WAIT_TIME) {
                pendingRetryToolMessagesRef.current.delete(nextMessageIndex);
                return;
              }
              
              // 如果 status 变为 completed 且有 bind_card_id，执行点击
              if (latestStatus === 'completed' && latestHasBindCard && onToolMessageClick) {
                // handleToolMessageAutoClick 内部会更新 ref，这里不需要重复更新
                handleToolMessageAutoClick(latestToolMessage, nextMessageIndex);
              } else {
                // 继续等待，500ms 后再次检查
                retryInfo.retryCount++;
                setTimeout(checkAndRetry, 500);
              }
            };
            
            // 延迟 500ms 后开始第一次检查
            setTimeout(checkAndRetry, 500);
          }
          }
          } else if (currentMessage.type === 'user_message') {
            const hasBindCard = (currentMessage.content as any)?.bind_card_id && (currentMessage.content as any).bind_card_id.trim() !== '';

            // user message 通常是立即可用的，不需要 status 检查
            if (hasBindCard && onToolMessageClick) {
              handleUserMessageAutoClick(currentMessage.content, nextMessageIndex);
          }
          }
        }
        
        setIsAnimationPlaying(false);
        setCurrentAnimatingIndex(-1);
      }, 800); // 普通消息动画时长
    }
  }, [animationQueue, isAnimationPlaying, messages, isAutoMode, onToolMessageClick]);

  // 监听队列变化，自动处理下一个动画
  useEffect(() => {
    if (!isAnimationPlaying && animationQueue.length > 0) {
      processAnimationQueue();
    }
  }, [animationQueue, isAnimationPlaying, processAnimationQueue]);

  // 单独监听项目ID变化，立即清空动画状态并设置标志
  useEffect(() => {
    const prevProjectId = projectIdRef.current;
    // 检测项目切换：包括从 undefined 到项目ID，从项目ID到 undefined，以及项目ID之间的切换
    // 特别注意：当 prevProjectId 是 undefined 且 currentProjectId 不是 undefined 时，这是从"没有项目"切换到第一个项目
    const isProjectSwitch = prevProjectId !== currentProjectId;
    
    if (isProjectSwitch) {
      // 项目切换时，立即清空所有动画状态
      setNewMessageIndices(new Set());
      setTypewriterMessages(new Map());
      setAnimationQueue([]);
      setIsAnimationPlaying(false);
      setCurrentAnimatingIndex(-1);
      pendingAnimationIndicesRef.current.clear();
      processedMessageIndicesRef.current.clear();
      // Auto 模式相关：清空激活的 tool message 状态
      activeToolMessageCardIdRef.current = null;
      previousToolMessageCardIdRef.current = null;
      autoClickedToolMessageIndicesRef.current.clear();
      pendingRetryToolMessagesRef.current.clear();
      // 项目切换时，将所有现有消息索引添加到已确认集合中
      // 在清空 timeout 之前，先确认当前正在播放的消息（如果存在）
      if (animationTimeoutRef.current && currentAnimatingIndex >= 0) {
        confirmedMessageIndicesRef.current.add(currentAnimatingIndex);
      }
      confirmedMessageIndicesRef.current.clear();
      for (let i = 0; i < messages.length; i++) {
        confirmedMessageIndicesRef.current.add(i);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      // 设置标志，表示刚刚切换了项目
      isProjectSwitchingRef.current = true;
      // 设置标志，表示等待第一次更新（用于处理空项目首次加载的情况）
      // 特别处理：从 undefined 切换到项目ID时，无论消息是否已存在，都跳过动画
      waitingFirstUpdateRef.current = true;
    }
    
    // 更新 ref
    projectIdRef.current = currentProjectId;
  }, [currentProjectId]);

  // 处理 user message 的自动点击逻辑
  const handleUserMessageAutoClick = useCallback((userMsgContent: any, msgIndex: number) => {
    const bindCardId = userMsgContent?.bind_card_id;
    const messageId = bindCardId || `user_message_${msgIndex}`;

    // 标记为已自动点击，避免重复
    autoClickedToolMessageIndicesRef.current.add(msgIndex);

    // 对于 user message，我们不更新 previousToolMessageCardIdRef，因为这通常是引用现有卡片
    // 也不需要收起前一个卡片，因为 user message 通常不创建新卡片

    // 等待 user message 完全渲染到 DOM 后再点击，确保连接线能正确显示
    requestAnimationFrame(() => {
      setTimeout(() => {
        // 执行点击 - user message 使用黑色连接线
        onToolMessageClick?.({
          cardId: bindCardId,
          messageId,
          color: '#000000', // user message 固定使用黑色
          isAutoClick: true // 标记为系统自动点击
        });

        // user message 不需要收起前一个卡片的逻辑，因为它们通常是引用而不是创建
      }, 200); // 延迟 200ms 确保渲染完成
    });
  }, [onToolMessageClick]);

  // 检测新增的消息并添加到动画队列
  useEffect(() => {
    // 检查是否刚刚切换了项目
    if (isProjectSwitchingRef.current) {
      // 清除标志，但不清空动画状态（已经在项目切换的 useEffect 中处理了）
      isProjectSwitchingRef.current = false;
      // 特别处理：从 undefined 切换到项目ID时，无论消息是否已存在，都跳过动画
      // 如果 previousMessages 是 undefined（首次渲染）或空数组，且 messages 有内容，这是第一次加载，跳过动画
      if ((!previousMessages || previousMessages.length === 0) && messages.length > 0) {
        waitingFirstUpdateRef.current = false;
        // 直接返回，不触发新动画
        return;
      }
      // 如果项目切换时项目已经有消息了，清除等待第一次更新的标志
      // 因为这种情况下，消息已经存在，不需要等待第一次更新
      if (messages.length > 0) {
        waitingFirstUpdateRef.current = false;
        // 项目切换时，将所有现有消息索引添加到已确认集合中
        confirmedMessageIndicesRef.current.clear();
        for (let i = 0; i < messages.length; i++) {
          confirmedMessageIndicesRef.current.add(i);
        }
      }
      // 直接返回，不触发新动画（无论什么情况，项目切换时都跳过动画）
      return;
    }
    
    // 检查是否是项目切换后的第一次更新（从空到有内容）
    // 这种情况发生在：切换到空项目后，接收到第一次 update，消息从空数组变成有内容
    if (waitingFirstUpdateRef.current) {
      // 如果消息从空变成有内容，这是第一次更新
      // 特别处理：previousMessages 是 undefined 的情况（首次渲染）
      if ((!previousMessages || previousMessages.length === 0) && messages.length > 0) {
        waitingFirstUpdateRef.current = false;

        // Auto 模式：即使是第一次加载，也要处理自动点击
        if (isAutoMode) {
          // 对于第一次加载的消息，直接处理自动点击逻辑，而不是跳过
          for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg && msg.type === 'user_message') {
              const hasBindCard = (msg.content as any)?.bind_card_id && (msg.content as any).bind_card_id.trim() !== '';
              if (hasBindCard && onToolMessageClick) {
                setTimeout(() => {
                  handleUserMessageAutoClick(msg.content, i);
                }, 100 * i); // 错开处理时间
              }
            }
          }
        }

        // 首次加载时，将所有现有消息索引添加到已确认集合中
        confirmedMessageIndicesRef.current.clear();
        for (let i = 0; i < messages.length; i++) {
          confirmedMessageIndicesRef.current.add(i);
        }
        // 如果不是 auto 模式，直接返回，不触发动画
        if (!isAutoMode) {
        return;
        }
        // 如果是 auto 模式，继续处理（因为上面已经处理了自动点击）
      }
      // 如果消息已经有内容了，说明不是第一次更新，清除标志
      if (previousMessages && previousMessages.length > 0) {
        waitingFirstUpdateRef.current = false;
      }
    }
    
    // 备用检查：如果项目ID在消息更新时发生了变化，也认为是项目切换
    // 使用 previousProjectId 来检测（虽然可能有时序问题，但作为双重保险）
    // 包括从 undefined 到项目ID，从项目ID到 undefined，以及项目ID之间的切换
    if (previousProjectId !== currentProjectId) {
      // 项目切换，清空动画状态
      setNewMessageIndices(new Set());
      setTypewriterMessages(new Map());
      setAnimationQueue([]);
      setIsAnimationPlaying(false);
      setCurrentAnimatingIndex(-1);
      pendingAnimationIndicesRef.current.clear();
      processedMessageIndicesRef.current.clear();
      // 项目切换时，将所有现有消息索引添加到已确认集合中
      // 在清空 timeout 之前，先确认当前正在播放的消息（如果存在）
      if (animationTimeoutRef.current && currentAnimatingIndex >= 0) {
        confirmedMessageIndicesRef.current.add(currentAnimatingIndex);
      }
      confirmedMessageIndicesRef.current.clear();
      for (let i = 0; i < messages.length; i++) {
        confirmedMessageIndicesRef.current.add(i);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      // 设置等待第一次更新的标志，防止后续消息更新触发动画
      waitingFirstUpdateRef.current = true;
      // Auto 模式相关：清空激活的 tool message 状态
      activeToolMessageCardIdRef.current = null;
      previousToolMessageCardIdRef.current = null;
      autoClickedToolMessageIndicesRef.current.clear();
      pendingRetryToolMessagesRef.current.clear();
      return;
    }
    
    // 检查是否是Agent切换导致的消息变化
    const isAgentSwitch = previousAgentId !== undefined && 
                         currentAgentId !== undefined && 
                         previousAgentId !== currentAgentId;
    
    // 如果是Agent切换，清空所有动画状态，不触发新动画
    if (isAgentSwitch) {
      setNewMessageIndices(new Set());
      setTypewriterMessages(new Map());
      setAnimationQueue([]);
      setIsAnimationPlaying(false);
      setCurrentAnimatingIndex(-1);
      pendingAnimationIndicesRef.current.clear();
      // Agent切换时，将所有现有消息索引添加到已确认集合中
      // 在清空 timeout 之前，先确认当前正在播放的消息（如果存在）
      if (animationTimeoutRef.current && currentAnimatingIndex >= 0) {
        confirmedMessageIndicesRef.current.add(currentAnimatingIndex);
      }
      confirmedMessageIndicesRef.current.clear();
      for (let i = 0; i < messages.length; i++) {
        confirmedMessageIndicesRef.current.add(i);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      // Auto 模式相关：清空激活的 tool message 状态
      activeToolMessageCardIdRef.current = null;
      previousToolMessageCardIdRef.current = null;
      autoClickedToolMessageIndicesRef.current.clear();
      pendingRetryToolMessagesRef.current.clear();
      return;
    }
    
    // 新增：当消息长度变短时，重置动画状态，避免队列索引失效
    // 这通常发生在项目切换时（旧项目的消息被新项目的消息替换）
    if (previousMessages && messages.length < previousMessages.length) {
      setNewMessageIndices(new Set());
      setTypewriterMessages(new Map());
      setAnimationQueue([]);
      setIsAnimationPlaying(false);
      setCurrentAnimatingIndex(-1);
      pendingAnimationIndicesRef.current.clear();
      // 消息变短时，重置已确认集合，只保留当前存在的消息索引
      // 在清空 timeout 之前，先确认当前正在播放的消息（如果存在且有效）
      if (animationTimeoutRef.current && currentAnimatingIndex >= 0 && currentAnimatingIndex < messages.length) {
        confirmedMessageIndicesRef.current.add(currentAnimatingIndex);
      }
      confirmedMessageIndicesRef.current.clear();
      for (let i = 0; i < messages.length; i++) {
        confirmedMessageIndicesRef.current.add(i);
      }
      if (animationTimeoutRef.current) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      // Auto 模式相关：清空激活的 tool message 状态
      activeToolMessageCardIdRef.current = null;
      previousToolMessageCardIdRef.current = null;
      autoClickedToolMessageIndicesRef.current.clear();
      pendingRetryToolMessagesRef.current.clear();
      return;
    }
    
    // 检测消息数组的突变：如果消息数组从非空变成完全不同的内容（不是简单的追加），可能是项目切换
    // 这种情况发生在：旧项目有消息，新项目也有消息，但内容完全不同
    if (previousMessages && previousMessages.length > 0 && messages.length > 0) {
      // 检查是否是突变：第一条消息的内容完全不同，且消息数量变化较大
      const firstMessageChanged = previousMessages[0]?.content !== messages[0]?.content;
      const messageCountChangedSignificantly = Math.abs(messages.length - previousMessages.length) > 2;
      
      // 如果第一条消息内容完全不同，且不是简单的追加（消息数量变化较大），认为是项目切换
      if (firstMessageChanged && messageCountChangedSignificantly) {
        setNewMessageIndices(new Set());
        setTypewriterMessages(new Map());
        setAnimationQueue([]);
        setIsAnimationPlaying(false);
        setCurrentAnimatingIndex(-1);
        pendingAnimationIndicesRef.current.clear();
        // 项目切换时，将所有现有消息索引添加到已确认集合中
        // 在清空 timeout 之前，先确认当前正在播放的消息（如果存在）
        if (animationTimeoutRef.current && currentAnimatingIndex >= 0) {
          confirmedMessageIndicesRef.current.add(currentAnimatingIndex);
        }
        confirmedMessageIndicesRef.current.clear();
        for (let i = 0; i < messages.length; i++) {
          confirmedMessageIndicesRef.current.add(i);
        }
        if (animationTimeoutRef.current) {
          clearTimeout(animationTimeoutRef.current);
          animationTimeoutRef.current = null;
        }
        // Auto 模式相关：清空激活的 tool message 状态
        activeToolMessageCardIdRef.current = null;
        autoClickedToolMessageIndicesRef.current.clear();
        return;
      }
    }
    
    // 使用 ref 来检测新消息，更可靠，不依赖 previousMessages 的更新时机
    const currentMessageCount = messages.length;
    const confirmedIndices = confirmedMessageIndicesRef.current;
    
    // 找出新增的消息索引（不在已确认集合中的消息）
    const newIndices: number[] = [];
    
    for (let i = 0; i < currentMessageCount; i++) {
      const msg = messages[i];
      // 只添加不在已确认集合中、不在队列中、不在 pendingAnimationIndicesRef 中、且未处理过的消息
      // 避免重复添加已经处理过的消息
      if (!confirmedIndices.has(i) && 
          !pendingAnimationIndicesRef.current.has(i) && 
          !processedMessageIndicesRef.current.has(i)) {
        newIndices.push(i);
      }
    }
    
    if (newIndices.length > 0) {
      
      if (newIndices.length > 0) {
        // Auto 模式：提前更新 activeToolMessageCardIdRef，确保新消息出现时能立即知道前一个 cardId
        if (isAutoMode) {
          // 检查新消息中是否有 tool message
          newIndices.forEach(idx => {
            const msg = messages[idx];
            if (msg && msg.type === 'tool_message') {
              const toolMessage = msg.content as ToolMessage;
              const hasBindCard = toolMessage?.bind_card_id && toolMessage.bind_card_id.trim() !== '';
              
              // 重要：如果 cardId 不为 null，就更新 ref（把当前的 cardId 变成 previousCardId，新的 cardId 变成 currentCardId）
              // 如果 cardId 是 null，就啥也不管
              const newCardId = toolMessage?.bind_card_id;
              if (newCardId && newCardId.trim() !== '') {
                // 只有当 cardId 不为 null 时才更新 ref
                const oldActiveCardId = activeToolMessageCardIdRef.current;
                previousToolMessageCardIdRef.current = oldActiveCardId;
                activeToolMessageCardIdRef.current = newCardId;
                // updated refs for new tool message
              } else {
                // bind_card_id empty, skip updating refs
              }
            }
          });
        }
        
        // 立即更新 ref，确保渲染时能立即判断是否隐藏
        newIndices.forEach(idx => {
          pendingAnimationIndicesRef.current.add(idx);
        });
        // 将新消息添加到动画队列（避免重复）
        setAnimationQueue(prev => {
          const existingSet = new Set(prev);
          const toAdd = newIndices.filter(idx => !existingSet.has(idx));
          return toAdd.length > 0 ? [...prev, ...toAdd] : prev;
        });
      }
    }
  }, [messages, previousMessages, currentAgentId, previousAgentId, currentProjectId, isAutoMode, onCollapseCard]);

  // 处理快捷键点击卡片：更新快捷键专属的 current/previous，并根据 type 决定是否收起 previous
  // 这个函数会被 MainLayout 通过 ref 调用
  const handleShortcutCardClick = useCallback(async (cardId: string): Promise<void> => {
    if (!cardId || cardId.trim() === '') {
      return;
    }
    
    // 更新 ref：把当前的 cardId 变成 previousCardId，新的 cardId 变成 currentCardId
    const oldActiveCardId = activeShortcutCardIdRef.current;
    previousShortcutCardIdRef.current = oldActiveCardId;
    activeShortcutCardIdRef.current = cardId;
    
    // 处理前一个卡片的收起逻辑
    const previousCardId = previousShortcutCardIdRef.current;
    let shouldCollapse = false;
    let cardType = null;
    
    if (previousCardId && onCollapseCard) {
      const previousCard = cardStore.getCard(previousCardId);
      if (previousCard) {
        cardType = previousCard.card_type;
        const shouldKeepExpanded = previousCard.unfold_at_start === true;
        shouldCollapse = !shouldKeepExpanded;
        
        if (shouldCollapse) {
          // 延迟一小段时间后收缩，确保新卡片的点击已经完成
          await new Promise(resolve => setTimeout(resolve, 100));
          await onCollapseCard(previousCardId);
        }
      }
    }
    
  }, [onCollapseCard]);

  // 清除快捷键状态
  const clearShortcutState = useCallback(() => {
    activeShortcutCardIdRef.current = null;
    previousShortcutCardIdRef.current = null;
  }, []);

  // 滚动到指定的 tool message
  const scrollToToolMessage = useCallback((messageId: string, direction: 'next' | 'previous') => {
    if (!messageId) return;
    
    // 先禁用自动跟随，避免与手动滚动冲突
    autoFollowRef.current = false;
    // 标记正在进行快捷键滚动，阻止自动下拉
    isShortcutScrollingRef.current = true;
    
    // 使用 requestAnimationFrame 确保 DOM 已更新
    requestAnimationFrame(() => {
      const container = messagesListRef.current;
      if (!container) return;
      
      // 查找 tool message 的 DOM 元素
      const safeMessageId = messageId.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
      const toolMessageElement = container.querySelector(`[data-tool-message-id="${safeMessageId}"]`) as HTMLElement | null;
      
      if (!toolMessageElement) {
        console.warn('[Shortcut] 未找到 tool message 元素', { messageId });
        // 即使没找到元素，也要在延迟后清除标记
        setTimeout(() => {
          isShortcutScrollingRef.current = false;
        }, 1000);
        return;
      }
      
      // 获取容器和元素的边界信息
      const containerRect = container.getBoundingClientRect();
      const elementRect = toolMessageElement.getBoundingClientRect();
      
      // 计算元素相对于容器的位置
      const elementTop = elementRect.top - containerRect.top + container.scrollTop;
      const elementBottom = elementTop + elementRect.height;
      const containerHeight = container.clientHeight;
      const containerScrollTop = container.scrollTop;
      
      let needsScroll = false;
      
      if (direction === 'next') {
        // 切换到下一个：如果元素在视窗下方，向下滚动直到它在视窗最下边
        const elementBottomRelativeToViewport = elementBottom - containerScrollTop;
        
        if (elementBottomRelativeToViewport > containerHeight) {
          // 元素在视窗下方，需要向下滚动
          const targetScrollTop = elementBottom - containerHeight;
          container.scrollTo({
            top: targetScrollTop,
            behavior: 'smooth'
          });
          needsScroll = true;
        }
      } else {
        // 切换到上一个：如果元素在视窗上方，向上滚动直到它在视窗最上边
        const elementTopRelativeToViewport = elementTop - containerScrollTop;
        
        if (elementTopRelativeToViewport < 0) {
          // 元素在视窗上方，需要向上滚动
          container.scrollTo({
            top: elementTop,
            behavior: 'smooth'
          });
          needsScroll = true;
        }
      }
      
      // 如果执行了滚动，等待滚动完成后再清除标记（smooth 滚动大约需要 500ms）
      // 如果没有滚动，立即清除标记
      if (needsScroll) {
        setTimeout(() => {
          isShortcutScrollingRef.current = false;
        }, 600);
      } else {
        // 即使不需要滚动，也稍微延迟一下，确保其他逻辑不会干扰
        setTimeout(() => {
          isShortcutScrollingRef.current = false;
        }, 100);
      }
    });
  }, []);

  // 使用 useImperativeHandle 暴露函数给父组件
  useImperativeHandle(ref, () => ({
    handleShortcutCardClick,
    clearShortcutState,
    scrollToToolMessage,
    scrollToLatestMessage: scrollToBottom
  }), [handleShortcutCardClick, clearShortcutState, scrollToToolMessage, scrollToBottom]);

  // 设置全局函数，用于从 CardNode 添加卡片到引用
  useEffect(() => {
    window.addCardToReference = (agentId: string, cardId: string, selectedContent?: string | null) => {
      // 检查是否已经存在相同的引用（基于 card_id）
      if (!selectedCards.some(card => card.card_id === cardId)) {
        const cardReference: CardReference = {
          card_id: cardId,
          selected_content: selectedContent || null
        };
        setSelectedCards(prev => [...prev, cardReference]);
      } else {
      }
    };

    // 清理函数
    return () => {
      delete window.addCardToReference;
    };
  }, [selectedCards]);

  // 处理卡片选择
  const handleCardSelect = (cardRef: CardRef) => {
    // 添加到选中的卡片列表（从 CardSelector 选择时，没有选中文本，所以 selected_content 为 null）
    if (!selectedCards.some(card => card.card_id === cardRef)) {
      const cardReference: CardReference = {
        card_id: cardRef,
        selected_content: null
      };
      setSelectedCards(prev => [...prev, cardReference]);
    }
    
    // 隐藏选择器并清空搜索
    setShowCardSelector(false);
    setMentionStartIndex(-1);
    setMentionSearchTerm('');
    
    // 重新聚焦到主输入框
    setTimeout(() => {
      if (inputRef.current) {
        const inputElement = inputRef.current.querySelector('input') || inputRef.current.querySelector('textarea');
        if (inputElement) {
          inputElement.focus();
        }
      }
    }, 0);
  };

  // 关闭卡片选择器
  const handleCloseCardSelector = () => {
    setShowCardSelector(false);
    setMentionStartIndex(-1);
    setMentionSearchTerm('');
  };

  // 移除卡片引用
  const removeCardRef = (cardRefToRemove: CardReference) => {
    setSelectedCards(prev => prev.filter(card => 
      card.card_id !== cardRefToRemove.card_id
    ));
  };


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault(); 

    if (onSendMessage && !isProcessing) {
      const message = inputValue.trim();       

      onSendMessage(message, selectedCards); 

      setInputValue('');      
      setSelectedCards([]);
      setShowCardSelector(false);
      inputRef.current?.focus(); 
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    } else if (e.key === 'Escape') {
      // 关闭卡片选择器
      handleCloseCardSelector();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
  };


  const handleStop = () => {
    onStopProcessing?.();
  };

  // 判断是否需要显示"Thinking..."提示
  const shouldShowThinking = () => {
    if (!isProcessing || safeMessages.length === 0) {
      return false;
    }
    const lastMessage = safeMessages[safeMessages.length - 1];
    if (!lastMessage) {
      return false;
    }
    // 如果最后一条不是工具消息，则显示思考中
    if (lastMessage.type !== 'tool_message') {
      return true;
    }
    // 如果是工具消息，检查状态
    const toolMessage = lastMessage.content as ToolMessage;
    const status = toolMessage?.status || 'completed';
    // 如果工具消息状态不是 pending 或 in_progress，则显示思考中
    return status !== 'pending' && status !== 'in_progress';
  };

  // 渲染待办事项列表
  const renderTodoList = (todos: TodoItem[]) => {
    return (
      <Box className="todo-list-container">
        <Typography 
          variant="caption" 
          sx={{ 
            fontSize: '12px',
            color: '#999',
            marginBottom: '4px',
            fontWeight: 500,
            letterSpacing: '0.5px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '2px',
            alignItems: 'flex-start'
          }}>
            <Box sx={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '3px'
            }}>
              <Box sx={{ 
                width: '3px', 
                height: '3px', 
                borderRadius: '50%', 
                backgroundColor: '#999' 
              }} />
              <Box sx={{ 
                width: '8px', 
                height: '1px', 
                backgroundColor: '#999' 
              }} />
            </Box>
            <Box sx={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '3px'
            }}>
              <Box sx={{ 
                width: '3px', 
                height: '3px', 
                borderRadius: '50%', 
                backgroundColor: '#999' 
              }} />
              <Box sx={{ 
                width: '8px', 
                height: '1px', 
                backgroundColor: '#999' 
              }} />
            </Box>
            <Box sx={{ 
              display: 'flex',
              alignItems: 'center',
              gap: '3px'
            }}>
              <Box sx={{ 
                width: '3px', 
                height: '3px', 
                borderRadius: '50%', 
                backgroundColor: '#999' 
              }} />
              <Box sx={{ 
                width: '8px', 
                height: '1px', 
                backgroundColor: '#999' 
              }} />
            </Box>
          </Box>
          Todos
        </Typography>
        <List dense className="todo-list">
        {todos.map((todo, index) => {
          let iconSrc;
          let chipColor: 'default' | 'primary' | 'secondary' = 'default';
          
          switch (todo.status) {
            case 'completed':
              iconSrc = '/resource/completed.svg';
              chipColor = 'default';
              break;
            case 'in_progress':
              iconSrc = '/resource/in_progress.svg';
              chipColor = 'primary';
              break;
            case 'pending':
              iconSrc = '/resource/pending.svg';
              chipColor = 'secondary';
              break;
            case 'interrupted':
              iconSrc = '/resource/interrupted.svg';
              chipColor = 'default';
              break;
          }
          
          return (
            <ListItem 
              key={index} 
              className="todo-item"
              sx={{ 
                padding: '5px 8px',
                fontSize: '12px',
                // 为已完成状态添加中划线效果
                ...(todo.status === 'completed' && {
                  textDecoration: 'line-through',
                  opacity: 0.7,
                  color: '#999'
                })
              }}
            >
              <ListItemIcon sx={{ 
                minWidth: '24px',
                // 图标也添加中划线效果
                ...(todo.status === 'completed' && {
                  opacity: 0.7
                })
              }}>
                <img 
                  src={iconSrc} 
                  alt={todo.status}
                  style={{ 
                    width: todo.status === 'in_progress' ? '18px' : '16px', 
                    height: todo.status === 'in_progress' ? '18px' : '16px',
                    display: 'block'
                  }} 
                />
              </ListItemIcon>
              <ListItemText 
                primary={todo.content}
                className={`todo-content todo-${todo.status}`}
                sx={{
                  '& .MuiListItemText-primary': {
                    fontSize: '12px !important',
                    lineHeight: '1.4',
                    color: todo.status === 'completed' ? '#999 !important' : '#666 !important'
                  }
                }}
              />
            </ListItem>
          );
        })}
        </List>
      </Box>
    );
  };

  // 渲染工具消息
  const renderToolMessage = (toolMessage: ToolMessage) => {
    const status = toolMessage.status || 'completed';
    const hasBindCard = toolMessage.bind_card_id && toolMessage.bind_card_id.trim() !== '';
    
    // 生成唯一标识用于跟踪悬浮状态
    const messageId = toolMessage.bind_card_id || 
      `${toolMessage.first_tool_description}-${toolMessage.second_tool_description}`;
    const isHovered = hoveredToolMessageId === messageId;
    
    // 获取工具颜色
    const toolColor = getToolColor(toolMessage.first_tool_description, status);
    
    // 根据状态添加动画类名
    const getStatusClasses = () => {
      const baseClass = `tool-message-container tool-status-${status}`;
      if (status === 'pending' || status === 'in_progress') {
        return `${baseClass} tool-breathing-animation`;
      }
      return baseClass;
    };

    // 处理左键点击事件
    const handleClick = (event: React.MouseEvent) => {
      if (hasBindCard && onToolMessageClick) {
        onToolMessageClick({
          cardId: toolMessage.bind_card_id!,
          messageId,
          color: toolColor
        });
      }
    };

    // 处理悬浮事件
    const handleMouseEnter = () => {
      if (hasBindCard) {
        setHoveredToolMessageId(messageId);
        onToolMessageHover?.({
          cardId: toolMessage.bind_card_id!,
          color: toolColor
        });
      }
    };

    const handleMouseLeave = () => {
      if (hasBindCard) {
        setHoveredToolMessageId(null);
        onToolMessageHover?.(null);
      }
    };

    return (
      <div 
        className={getStatusClasses()}
        onClick={hasBindCard ? handleClick : undefined}
        onMouseEnter={hasBindCard ? handleMouseEnter : undefined}
        onMouseLeave={hasBindCard ? handleMouseLeave : undefined}
        style={{
          cursor: hasBindCard ? 'pointer' : 'default'
        }}
        data-tool-card-id={hasBindCard ? toolMessage.bind_card_id! : undefined}
      >
        <div
          className="tool-message-click-surface"
          data-tool-message-id={hasBindCard ? messageId : undefined}
          data-tool-message-core={hasBindCard ? 'true' : undefined}
      >
        {/* 左侧彩色圆角矩形 - 显示工具描述 */}
        <Box
          sx={{
            backgroundColor: toolColor,
            color: 'white',
            padding: '2px 10px',
            borderRadius: '16px',
            fontSize: '13px',
            fontWeight: 500,
            whiteSpace: 'nowrap',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            lineHeight: '1.2',
            minHeight: '20px',
            height: 'fit-content'
          }}
        >
          {(() => {
            let displayText = toolMessage.first_tool_description;
            while (displayText.length > 0 && (displayText.endsWith(':') || displayText.endsWith(' '))) {
              displayText = displayText.slice(0, -1);
            }
            return (
              <>
                {displayText}
                {status === 'cancelled' && (
                  <span
                    style={{
                      marginLeft: '6px',
                      color: '#E73232',
                      fontWeight: 800,
                      fontSize: '18px',
                      lineHeight: 1,
                      transform: 'translateY(-2px)'
                    }}
                  >
                    ×
                  </span>
                )}
              </>
            );
          })()}
        </Box>

        {/* 右侧内容区域 */}
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          {/* 第一行：图标、第二工具描述、附件图标 */}
          <Box sx={{ display: 'flex', alignItems: 'center', lineHeight: '1.2' }}>
            {/* 第二工具描述 */}
            {toolMessage.second_tool_description && (
              <Typography 
                variant="body2" 
                sx={{ 
                  fontSize: '13px',
                  lineHeight: '1.2',
                  color: toolColor,
                  textShadow: isHovered && hasBindCard 
                    ? '0 2px 4px rgba(0, 0, 0, 0.04)' 
                    : 'none',
                  transform: isHovered && hasBindCard ? 'translateY(-2px)' : 'translateY(0)',
                  transition: hasBindCard ? 'text-shadow 0.2s ease, transform 0.2s ease' : 'none',
                  display: 'inline'
                }}
              >
                {toolMessage.second_tool_description}
              </Typography>
            )}
          </Box>

          {/* 详细信息 - 只有当detail存在且不为空时才渲染 */}
          {toolMessage.detail && toolMessage.detail.trim() !== '' ? (
            <Typography 
              className="tool-detail-content"
              variant="body2" 
              sx={{ 
                fontSize: '12px',
                color: toolColor,
                fontStyle: 'normal',
                lineHeight: '1.3',
                marginTop: '4px',
                opacity: 0.8,
                textShadow: isHovered && hasBindCard 
                  ? '0 2px 4px rgba(0, 0, 0, 0.04)' 
                  : 'none',
                transform: isHovered && hasBindCard ? 'translateY(-2px)' : 'translateY(0)',
                transition: hasBindCard ? 'text-shadow 0.2s ease, transform 0.2s ease, color 0.2s ease' : 'color 0.2s ease'
              }}
            >
              {toolMessage.detail}
            </Typography>
          ) : null}
        </Box>
        </div>
      </div>
    );
  };

  // 获取卡片图标
  const getCardIcon = (cardRef: CardRef) => {
    // 通过cardStore获取完整的卡片信息
    const card = cardStore.getCard(cardRef);
    if (!card) {
      return '/resource/note.svg'; // 默认图标
    }
    
    // 根据card type获取对应的图标，与CardNode.tsx保持一致
    const cardType = card.card_type;
    switch (cardType) {
      case 'report':
        return '/resource/note.svg';
      case 'target_task':
        return '/resource/target_task.svg';
      case 'user_requirement':
        return '/resource/user_requirement.svg';
      case 'web_search':
        return '/resource/web_search.svg';
      case 'webpage':
        return '/resource/webpage.svg';
      case 'visualization':
        return '/resource/visualization.svg';
      default:
        return '/resource/note.svg'; // 默认图标
    }
  };

  // 辅助函数：过滤空白文本节点（用于表格元素）
  const filterWhitespaceNodes = (children: React.ReactNode[]): React.ReactNode[] => {
    const filtered: React.ReactNode[] = [];

    children.forEach((child) => {
      if (child == null) {
        return;
      }

      if (typeof child === 'string') {
        if (child.trim() !== '') {
          filtered.push(child);
        }
        return;
      }

      if (Array.isArray(child)) {
        const nested = filterWhitespaceNodes(child);
        if (nested.length > 0) {
          filtered.push(...nested);
        }
        return;
      }

      filtered.push(child);
    });

    return filtered;
  };

  // Markdown 表格渲染器配置
  const markdownTableComponents = {
    table: (props: any) => {
      const children = React.Children.toArray(props.children);
      return <table className="markdown-table">{filterWhitespaceNodes(children)}</table>;
    },
    thead: (props: any) => {
      const children = React.Children.toArray(props.children);
      return <thead>{filterWhitespaceNodes(children)}</thead>;
    },
    tbody: (props: any) => {
      const children = React.Children.toArray(props.children);
      return <tbody>{filterWhitespaceNodes(children)}</tbody>;
    },
    tr: (props: any) => {
      const children = React.Children.toArray(props.children);
      return <tr>{filterWhitespaceNodes(children)}</tr>;
    },
    th: (props: any) => <th>{props.children}</th>,
    td: (props: any) => <td>{props.children}</td>,
  };

  // 渲染消息内容
  const renderMessageContent = (message: Message, messageIndex: number) => {
    // 守卫：确保 message 存在且具有有效类型
    if (!message || typeof (message as any).type !== 'string') {
      return <Typography>{String((message as any)?.content ?? '')}</Typography>;
    }
    const messageType = message.type;
    switch (messageType) {
      case 'todo_list':
        if (Array.isArray(message.content)) {
          return renderTodoList(message.content as TodoItem[]);
        }
        return <Typography>{String(message.content)}</Typography>;
      
      case 'tool_message':
        if (typeof message.content === 'object' && !Array.isArray(message.content)) {
          return renderToolMessage(message.content as ToolMessage);
        }
        return <Typography>{String(message.content)}</Typography>;
      
      case 'user_message':
        const userMessageReferences2 = message.reference_list || [];
        const userMessageBindCardId2 = (message.content as any)?.bind_card_id;
        const hasUserBindCard2 = userMessageBindCardId2 && userMessageBindCardId2.trim() !== '';

        // 生成唯一标识用于跟踪悬浮状态
        const userMessageId = userMessageBindCardId2 || `user_message_${messageIndex}`;
        const isUserMessageHovered = hoveredToolMessageId === userMessageId;

        // 处理 user message 的左键点击事件
        const handleUserMessageClick = (event: React.MouseEvent) => {
          if (hasUserBindCard2 && onToolMessageClick) {
            onToolMessageClick({
              cardId: userMessageBindCardId2,
              messageId: userMessageId,
              color: '#000000' // user message 固定使用黑色
            });
          }
        };

        // 处理 user message 的悬浮事件
        const handleUserMessageMouseEnter = () => {
          if (hasUserBindCard2) {
            setHoveredToolMessageId(userMessageId);
            onToolMessageHover?.({
              cardId: userMessageBindCardId2,
              color: '#000000' // user message 固定使用黑色
            });
          }
        };

        const handleUserMessageMouseLeave = () => {
          if (hasUserBindCard2) {
            setHoveredToolMessageId(null);
            onToolMessageHover?.(null);
          }
        };

        return (
          <div 
            className="user-message-content"
            style={{ 
              fontSize: '13px', 
              lineHeight: '1.4',
              color: '#333',
              backgroundColor: isUserMessageHovered ? '#e3f2fd' : '#f0f8ff', // 悬停时改变背景色
              border: isUserMessageHovered ? '1px solid #2196f3' : '1px solid #90caf9', // 悬停时改变边框色
              borderRadius: '8px',
              padding: '6px 14px',
              margin: '4px 0',
              boxShadow: isUserMessageHovered
                ? '0 2px 8px rgba(33, 150, 243, 0.3)'
                : '0 1px 3px rgba(144, 202, 249, 0.2)', // 悬停时增强阴影
              cursor: hasUserBindCard2 ? 'pointer' : 'default',
              transition: 'all 0.2s ease' // 添加过渡效果
            }}
            data-tool-message-id={hasUserBindCard2 ? userMessageBindCardId2 : undefined}
            data-tool-message-core={hasUserBindCard2 ? 'true' : undefined}
            onClick={hasUserBindCard2 ? handleUserMessageClick : undefined}
            onMouseEnter={hasUserBindCard2 ? handleUserMessageMouseEnter : undefined}
            onMouseLeave={hasUserBindCard2 ? handleUserMessageMouseLeave : undefined}
          >
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownTableComponents}>
              {message.content.user_message || ''}
            </ReactMarkdown>
          </div>
        );
      case 'assistant_message':
        // 检查是否有打字机效果
        const typewriterText = typewriterMessages.get(messageIndex);
        // 如果正在打字机效果中，显示打字机文本；否则显示完整内容
        const displayText = typewriterText !== undefined ? typewriterText : String(message.content);
        
        return (
          <div style={{ 
            fontSize: '13px', 
            lineHeight: '1.1',
            margin: '0',
            padding: '0',
            minHeight: '1.1em' // 确保即使是空字符串也有高度，避免布局跳动
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownTableComponents}>
              {displayText}
            </ReactMarkdown>
          </div>
        );
      case 'progress_summary_message':
        // content 可能是对象，取 progress_summary 字段，否则转为字符串
        const progressText =
          typeof (message as any).content === 'object' && (message as any).content !== null
            ? (message as any).content.progress_summary ?? ''
            : String(message.content);
        return (
          <div style={{ 
            fontSize: '16px', 
            lineHeight: '1.4',
            margin: '0',
            padding: '0',
            color: '#000000',
            fontWeight: 'bold'
          }}>
            {progressText}
          </div>
        );
      case 'system_message':
      case 'error':
      case 'thinking':
        // 如果是thinking类型且content是React组件，直接渲染
        if (message.type === 'thinking' && React.isValidElement(message.content)) {
          return (
            <div style={{ 
              fontSize: '13px', 
              lineHeight: '1.1',
              margin: '0',
              padding: '0',
              opacity: 0.7,
              color: '#999',
              fontStyle: 'italic'
            }}>
              {message.content}
            </div>
          );
        }
        
        return (
          <div style={{ 
            fontSize: '13px', 
            lineHeight: '1.1',
            margin: '0',
            padding: '0',
            // thinking 类型的特殊样式
            ...(message.type === 'thinking' && {
              opacity: 0.7,
              color: '#999',
              fontStyle: 'italic'
            })
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownTableComponents}>
              {String(message.content)}
            </ReactMarkdown>
          </div>
        );
      default:
        return (
          <div style={{ 
            fontSize: '13px', 
            lineHeight: '1.1',
            margin: '0',
            padding: '0'
          }}>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownTableComponents}>
              {String(message.content)}
            </ReactMarkdown>
          </div>
        );
    }
  };

  // 获取消息发送者信息
  const getMessageSender = (message: Message) => {
    const type = (message as any)?.type as Message['type'] | undefined;
    switch (type) {
      case 'user_message':
        return {
          name: 'You',
          avatar: <Person />,
          isUser: true
        };
      case 'assistant_message':
        return {
          name: 'Assistant',
          avatar: <SmartToy />,
          isUser: false
        };
      case 'system_message':
        return {
          name: 'System',
          avatar: <SmartToy />,
          isUser: false
        };
      case 'todo_list':
        return {
          name: 'Task List',
          avatar: <Schedule />,
          isUser: false
        };
      case 'tool_message':
        return {
          name: 'Tool',
          avatar: <CheckCircle />,
          isUser: false
        };
      case 'thinking':
        return {
          name: 'Assistant',
          avatar: <SmartToy />,
          isUser: false
        };
      default:
        return {
          name: 'Unknown',
          avatar: <SmartToy />,
          isUser: false
        };
    }
  };

  // 渲染单个卡片引用（折叠样式）- 使用可复用组件
  const renderCardRef = (cardReference: CardReference, index: number) => {
    return (
      <CardRefCollapsed
        key={`${cardReference.card_id}-${index}`}
        cardReference={cardReference}
        index={index}
        onRemove={removeCardRef}
      />
    );
  };

  // 渲染选中的卡片引用
  const renderSelectedCards = () => {
    return (
      <Box className="selected-cards-container">
        <Box className="selected-cards-content">
          {/* 选中的卡片列表 */}
          {selectedCards.length > 0 && (
            <Box className="selected-cards-list">
              {selectedCards.map((cardRef, index) => renderCardRef(cardRef, index))}
            </Box>
          )}
        </Box>
      </Box>
    );
  };

  // 渲染单个消息
  const renderMessage = (message: Message, index: number) => {
    // 如果消息无效，跳过渲染，防止运行时错误
    if (!message || typeof (message as any).type !== 'string') {
      return null;
    }
    const sender = getMessageSender(message);
    const isNewMessage = newMessageIndices.has(index);
    const isCurrentlyAnimating = currentAnimatingIndex === index;
    const isInQueue = animationQueue.includes(index);
    // 检查 ref 中是否包含此索引（立即生效，不依赖状态更新）
    const isPendingAnimation = pendingAnimationIndicesRef.current.has(index);
    // 检查消息索引是否在已确认集合中
    const isConfirmed = confirmedMessageIndicesRef.current.has(index);
    
    // 特殊处理：动态添加的 thinking 消息（索引 >= safeMessages.length）应该始终显示
    // 因为它不是真实消息列表中的消息，不需要经过动画队列检查
    const isDynamicThinkingMessage = message.type === 'thinking' && index >= safeMessages.length;
    
    // 如果消息在队列中等待动画，且不是当前正在播放的消息，则隐藏
    // 或者如果消息在 ref 中（待动画），且不是当前正在播放的消息，则隐藏
    // 或者如果消息未确认（不在已确认集合中），且不在当前播放的动画中，则隐藏
    // 但动态添加的 thinking 消息不受此限制
    if (!isDynamicThinkingMessage && (isInQueue || isPendingAnimation || !isConfirmed) && !isCurrentlyAnimating) {
      return null;
    }
    
    // 如果是思考中消息，且有其他消息正在播放动画，则隐藏思考状态
    // 但动态添加的 thinking 消息不受此限制（因为它本身就是用来表示"正在思考"的）
    if (!isDynamicThinkingMessage && message.type === 'thinking' && isAnimationPlaying && !isCurrentlyAnimating) {
      return null;
    }
    
    // 根据消息类型确定额外的CSS类
    const getBubbleClass = () => {
      let baseClass = sender.isUser ? 'user-bubble' : 'agent-bubble';
      
      // 只为特定消息类型添加气泡样式
      switch (message.type) {
        case 'todo_list':
          baseClass += ' todo-list-bubble';
          break;
        case 'tool_message':
          baseClass += ' tool-message-bubble';
          break;
        case 'system_message':
          baseClass += ' system-message-bubble';
          break;
        case 'user_message':
          baseClass += ' user-message-bubble';
          break;
        // assistant_message 不添加气泡样式
        default:
          baseClass += ' default-message-bubble';
          break;
      }
      
      return baseClass;
    };
    
    // 构建消息容器的类名
    const getMessageContainerClass = () => {
      let containerClass = `message-container ${sender.isUser ? 'user-message' : 'agent-message'}`;
      
      // 为thinking类型消息添加特殊类名
      if (message.type === 'thinking') {
        containerClass += ' thinking-message';
      }
      
      if (isNewMessage || isCurrentlyAnimating) {
        // 根据消息类型添加不同的动画类
        if (message.type === 'assistant_message') {
          // assistant_message 使用 JavaScript 打字机效果，只需要基础样式
          containerClass += ' typewriter-message';
        } else {
          containerClass += ' fade-in-animation';
        }
      }
      return containerClass;
    };
    
    // 为 progress_summary_message 类型的消息注册引用
    const messageRef = message.type === 'progress_summary_message' 
      ? (element: HTMLDivElement | null) => {
          const messageRefs = React.useRef<Map<number, HTMLDivElement>>(new Map());
          if (element) {
            messageRefs.current.set(index, element);
          }
        }
      : undefined;
    
    return (
      <div 
        key={index} 
        className={getMessageContainerClass()}
        data-message-index={index}
        data-message-type={message.type}
      >
        <div className="message-wrapper">
          <div className="message-content-wrapper">
            <div className={getBubbleClass()}>
              {renderMessageContent(message, index)}
            </div>
          </div>
        </div>
      </div>
    );
  };


  // 进度点揭示状态
  const [progressRevealed, setProgressRevealed] = React.useState<Set<number>>(new Set());
  
  // 存储每个消息行的实际高度（用于计算虚线偏移量）
  const messageRowHeightsRef = React.useRef<Map<number, number>>(new Map());
  const [messageRowHeights, setMessageRowHeights] = React.useState<Map<number, number>>(new Map());
  
  // 进度指示采用与消息并排的布局，不再依赖滚动时的 DOM 测量

  // 补全已显示的进度点：未在动画队列中的进度点，除了最新一个，自动视为已显示
  React.useEffect(() => {
    setProgressRevealed((prev) => {
      const next = new Set(prev);
      const progressIdx = safeMessages
        .map((m, i) => (m.type === 'progress_summary_message' ? i : -1))
        .filter(i => i >= 0)
        .sort((a, b) => a - b);

      const latestIdx = progressIdx.length ? progressIdx[progressIdx.length - 1] : null;
      const firstIdx = progressIdx.length ? progressIdx[0] : null;

      // 默认将自动插入的首个进度点视为已揭示
      if (firstIdx !== null) {
        next.add(firstIdx);
      }

      progressIdx.forEach((idx) => {
        const inQueue = animationQueue.includes(idx) || currentAnimatingIndex === idx;
        const message = safeMessages[idx];
        const isCompletedProgress = message?.type === 'progress_summary_message' &&
          ((message as any)?.content?.status === 'completed' || (message as any)?.content?.status === 'cancelled');

        // 不是正在动画中，且(不是最后一个进度点 或 是已完成的进度点)
        if (!inQueue && (idx !== latestIdx || isCompletedProgress)) {
          next.add(idx);
          // 确保 progress_summary_message 在 progressRevealed 中时，也在 confirmedMessageIndicesRef 中
          confirmedMessageIndicesRef.current.add(idx);
        }
      });

      return next;
    });
  }, [safeMessages, animationQueue, currentAnimatingIndex]);

  // 找到所有 progress_summary_message 的索引
  const progressIndices = React.useMemo(() => {
    const indices: number[] = [];
    safeMessages.forEach((message, index) => {
      if (message.type === 'progress_summary_message') {
        indices.push(index);
      }
    });
    return indices;
  }, [safeMessages]);

  const lastRevealedIndex = React.useMemo(() => {
    let idx: number | null = null;
    progressIndices.forEach((i) => {
      if (progressRevealed.has(i)) {
        idx = idx === null ? i : Math.max(idx, i);
      }
    });
    return idx;
  }, [progressIndices, progressRevealed]);

  // 测量消息行高度的 useEffect（使用防抖和延迟，避免阻塞渲染）
  React.useEffect(() => {
    let updateTimeoutId: NodeJS.Timeout | null = null;
    const observers: ResizeObserver[] = [];
    
    // 防抖更新函数
    const debouncedUpdate = () => {
      if (updateTimeoutId) {
        clearTimeout(updateTimeoutId);
      }
      updateTimeoutId = setTimeout(() => {
        setMessageRowHeights(new Map(messageRowHeightsRef.current));
      }, 100); // 100ms 防抖
    };
    
    // 延迟创建 ResizeObserver，确保 DOM 已经渲染
    const timeoutId = setTimeout(() => {
      const heights = new Map<number, number>();
      
      // 为每个消息行创建 ResizeObserver
      safeMessages.forEach((_, index) => {
        const rowElement = document.querySelector(`[data-message-index="${index}"]`);
        if (rowElement) {
          // 立即记录初始高度（取整到像素以避免小数像素抖动）
          const initialHeightRaw = (rowElement as HTMLElement).offsetHeight;
          const initialHeight = Math.round(initialHeightRaw);
          if (initialHeight > 0) {
            messageRowHeightsRef.current.set(index, initialHeight);
            heights.set(index, initialHeight);
          }
          
          let hasChange = false;
          const observer = new ResizeObserver((entries) => {
            for (const entry of entries) {
              const rawHeight = entry.contentRect.height;
              const intHeight = Math.round(rawHeight);
              if (intHeight > 0) {
                const prev = messageRowHeightsRef.current.get(index);
                if (prev !== intHeight) {
                  messageRowHeightsRef.current.set(index, intHeight);
                  hasChange = true;
                }
              }
              
            }
            // 仅当有高度变化时触发防抖状态更新，减少不必要的重算/重渲染
            if (hasChange) {
              debouncedUpdate();
            }
          });
          observer.observe(rowElement);
          observers.push(observer);
        }
      });
      
      // 如果有初始高度，立即更新一次
      if (heights.size > 0) {
        setMessageRowHeights(new Map(heights));
      }
    }, 0); // 使用 setTimeout 0 延迟到下一个事件循环
    
    return () => {
      clearTimeout(timeoutId);
      observers.forEach(observer => observer.disconnect());
      if (updateTimeoutId) {
        clearTimeout(updateTimeoutId);
      }
    };
  }, [safeMessages]);

  // 预计算时间线元数据（逐行渲染，避免滚动测量）
  const timelineMeta = React.useMemo(() => {
    type SegmentClass = 'timeline-seg-solid' | 'timeline-seg-dashed' | null;
    type SegmentVariant = 'start' | 'mid' | 'end' | 'full' | null;
    type DotClass = 'timeline-dot timeline-dot-latest' | 'timeline-dot timeline-dot-milestone' | null;

    const meta: Array<{
      segmentClass: SegmentClass;
      segmentVariant: SegmentVariant;
      dotClass: DotClass;
      splitTopClass?: SegmentClass;
      splitBottomClass?: SegmentClass;
      isSplit?: boolean;
      dashedOffset?: number; // 虚线偏移量（用于对齐）
      splitTopOffset?: number; // 分裂上半段偏移量
      splitBottomOffset?: number; // 分裂下半段偏移量
    }> = safeMessages.map(() => ({
      segmentClass: null,
      segmentVariant: null,
      dotClass: null,
      isSplit: false,
    }));

    const combineVariant = (prev: SegmentVariant, next: SegmentVariant, rowIndex?: number): SegmentVariant => {
      if (prev === null) return next;
      if (next === null) return prev;
      
      // 特殊处理：如果当前行是最后一条消息且是 progress_summary_message，优先使用 end
      if (rowIndex !== undefined && rowIndex === lastMsgIdx && safeMessages[rowIndex]?.type === 'progress_summary_message') {
        // 如果 next 是 end，直接返回 end（覆盖之前的 full）
        if (next === 'end') return 'end';
      }
      
      // 如果同一行既是上一段的 end 又是下一段的 start，使用 full 覆盖
      if ((prev === 'end' && next === 'start') || (prev === 'start' && next === 'end')) return 'full';
      // 其他组合，保持 full 优先
      if (prev === 'full' || next === 'full') return 'full';
      return next;
    };

    if (progressIndices.length === 0) {
      // 没有进度消息，仅在最后一条消息放空心点
      if (safeMessages.length > 0) {
        meta[safeMessages.length - 1].dotClass = 'timeline-dot timeline-dot-latest';
      }
      return meta;
    }

    const lastMsgIdx = safeMessages.length - 1;
    let prevSegmentClass: SegmentClass = null;

    // 虚线周期：6px 实线 + 4px 透明 = 10px 一个周期
    const DASHED_PATTERN_SIZE = 10;

    // 计算虚线偏移量：使用实际消息行高度计算累积偏移量
    // 第一遍：计算每个消息行在整个虚线段中的累积高度
    let cumulativeHeight = 0; // 累积高度（用于计算偏移量）
    
    for (let i = 0; i < progressIndices.length; i++) {
      const currIdx = progressIndices[i];
      const nextIdx = i + 1 < progressIndices.length ? progressIndices[i + 1] : null;

      const status = ((safeMessages[currIdx] as any)?.content?.status as string | undefined) || 'completed';
      const segmentClass: SegmentClass = status === 'in_progress' ? 'timeline-seg-dashed' : 'timeline-seg-solid';
      const topClass: SegmentClass = i === 0 ? null : prevSegmentClass ?? segmentClass;
      if (prevSegmentClass === null) prevSegmentClass = segmentClass;

      const endIdx = nextIdx !== null ? nextIdx : lastMsgIdx;

      // 检测虚线段的变化，重置累积高度
      const isDashedSegment = segmentClass === 'timeline-seg-dashed';
      const wasDashedSegment = prevSegmentClass === 'timeline-seg-dashed';
      
      if (isDashedSegment && !wasDashedSegment) {
        // 新的虚线段开始，重置累积高度
        cumulativeHeight = 0;
      } else if (!isDashedSegment && wasDashedSegment) {
        // 虚线段结束，重置累积高度
        cumulativeHeight = 0;
      }

      for (let row = currIdx; row <= endIdx; row++) {
        // 获取该行的实际高度
        const rowHeight = messageRowHeightsRef.current.get(row) || 0;
        const rowTopOffset = cumulativeHeight;
        const rowMidOffset = cumulativeHeight + rowHeight / 2;
        const topOffset = rowTopOffset % DASHED_PATTERN_SIZE;
        const midOffset = rowMidOffset % DASHED_PATTERN_SIZE;
        
        if (row === currIdx) {
          // 检查最后一条消息是否是 progress_summary_message
          const isLastMessage = row === endIdx && nextIdx === null;
          const isLastMessageProgress = isLastMessage && safeMessages[row]?.type === 'progress_summary_message';
          
          // 如果当前行也是结束行（最后一条消息），且不需要 split（topClass 和 segmentClass 相同或 topClass 为 null）
          // 只有当最后一条消息是 progress_summary_message 时才使用 end，否则使用 full
          if (isLastMessage && (topClass === null || topClass === segmentClass)) {
            meta[row].segmentClass = segmentClass;
            meta[row].segmentVariant = combineVariant(meta[row].segmentVariant, isLastMessageProgress ? 'end' : 'full', row);
            meta[row].isSplit = false;
            
            // 计算虚线偏移量
            if (segmentClass === 'timeline-seg-dashed') {
              meta[row].dashedOffset = Math.round(topOffset);
            }
          } else {
            // 当前进度行，分裂成上半段（上一进度的线型）与下半段（当前线型）
            meta[row].isSplit = true;
            meta[row].splitTopClass = topClass;
            meta[row].splitBottomClass = segmentClass;
            meta[row].segmentClass = segmentClass; // 备用
            
            // 如果当前行也是结束行（最后一条消息），只有当它是 progress_summary_message 时才使用 end，否则使用 full
            if (isLastMessage) {
              meta[row].segmentVariant = combineVariant(meta[row].segmentVariant, isLastMessageProgress ? 'end' : 'full', row);
            } else {
              meta[row].segmentVariant = combineVariant(meta[row].segmentVariant, 'full', row);
            }
            
            // 计算分裂段的偏移量
            if (topClass === 'timeline-seg-dashed') {
              // 上半段：从行顶部开始，使用累积高度的偏移量（取整）
              meta[row].splitTopOffset = Math.round(topOffset);
            }
            if (segmentClass === 'timeline-seg-dashed') {
              // 下半段：从行中部开始，使用累积高度+半行高的偏移量（取整）
              meta[row].splitBottomOffset = Math.round(midOffset);
            }
          }
        } else if (row === endIdx) {
          meta[row].segmentClass = segmentClass;
          // 只有当最后一条消息是 progress_summary_message 时才使用 end，否则使用 full
          const isLastMessageProgress = nextIdx === null && safeMessages[row]?.type === 'progress_summary_message';
          meta[row].segmentVariant = combineVariant(meta[row].segmentVariant, isLastMessageProgress ? 'end' : 'full', row);
          
          // 计算虚线偏移量
          if (segmentClass === 'timeline-seg-dashed') {
            // end 段：从行顶部到中部，使用累积高度的偏移量（取整）
            // full 段：整行，使用累积高度的偏移量（取整）
            meta[row].dashedOffset = Math.round(topOffset);
          }
        } else {
          meta[row].segmentClass = segmentClass;
          meta[row].segmentVariant = combineVariant(meta[row].segmentVariant, 'mid', row);
          
          // 计算虚线偏移量
          if (segmentClass === 'timeline-seg-dashed') {
            // mid 段：整行，使用累积高度的偏移量（取整）
            meta[row].dashedOffset = Math.round(topOffset);
          }
        }
        
        
        // 更新累积高度（用于下一行）
        cumulativeHeight += rowHeight;
      }
      
      // 处理 start 段的偏移量：需要让 start 段从中部位置开始，与上一行的 end 段对齐
      // 重新遍历，找到所有 start 段并设置正确的偏移量
      let startCumulativeHeight = 0;
      for (let row = 0; row < safeMessages.length; row++) {
        const rowHeight = messageRowHeightsRef.current.get(row) || 0;
        
        if (meta[row].segmentVariant === 'start' && meta[row].segmentClass === 'timeline-seg-dashed') {
          // start 段：从行中部到底部，使用累积高度+半行高的偏移量（与上一行的 end 段对齐）
          const rowMidOffset = startCumulativeHeight + rowHeight / 2;
          meta[row].dashedOffset = Math.round(rowMidOffset % DASHED_PATTERN_SIZE);
        }
        
        startCumulativeHeight += rowHeight;
      }

      // 更新上一段的线型为当前，用于下一条进度的上半段
      prevSegmentClass = segmentClass;
    }

    // 点：已揭示的进度为实心，最后一条消息（如果不是已完成的进度消息）为空心
    // 优先处理进度消息：已完成的进度消息显示实心点
    progressIndices.forEach((idx) => {
      if (progressRevealed.has(idx)) {
        meta[idx].dotClass = 'timeline-dot timeline-dot-milestone';
      }
    });

    // 最后一条消息：只有当它不是已完成的进度消息时才显示为空心点
    if (safeMessages.length > 0) {
      const lastMessage = safeMessages[lastMsgIdx];
      const isCompletedProgressSummary =
        lastMessage.type === 'progress_summary_message' &&
        (((lastMessage as any).content?.status === 'completed' || (lastMessage as any).content?.status === 'cancelled') || progressRevealed.has(lastMsgIdx));

      if (!isCompletedProgressSummary) {
        meta[lastMsgIdx].dotClass = 'timeline-dot timeline-dot-latest';
      }
    }

    return meta;
  }, [safeMessages, progressIndices, progressRevealed, messageRowHeights]);
  
  // 注意：即使 messageRowHeights 还没有完全测量完成，timelineMeta 也应该能正常计算
  // 使用 ref 而不是 state 来避免阻塞渲染

  return (
    <div className="chat-view">
      {/* 聊天区域 */}
      <div className="chat-messages-section">
        {messages.length === 0 ? null : (
          <div className="chat-messages-with-progress">
            {/* 消息列表（含时间线列） */}
          <div className="messages-list" ref={messagesListRef} onScroll={handleMessagesScroll}>
              {safeMessages.map((message, index) => {
                const rendered = renderMessage(message, index);
                const meta = timelineMeta[index];
                return (
                  <div 
                    key={index} 
                    className="messages-row"
                    data-message-index={index}
                    data-message-type={message.type}
                  >
                    <div className="timeline-cell">
                      {meta.isSplit ? (
                        <>
                          {meta.splitTopClass && (
                            <div 
                              className={`timeline-seg timeline-seg-split timeline-seg-top ${meta.splitTopClass === 'timeline-seg-solid' ? 'timeline-seg-solid' : 'timeline-seg-dashed'}`}
                              style={meta.splitTopClass === 'timeline-seg-dashed' && meta.splitTopOffset !== undefined
                                ? { backgroundPosition: `0 ${-meta.splitTopOffset}px` }
                                : undefined}
                            />
                          )}
                          {meta.splitBottomClass && (
                            <div 
                              className={`timeline-seg timeline-seg-split timeline-seg-bottom ${meta.splitBottomClass === 'timeline-seg-solid' ? 'timeline-seg-solid' : 'timeline-seg-dashed'}`}
                              style={meta.splitBottomClass === 'timeline-seg-dashed' && meta.splitBottomOffset !== undefined
                                ? { backgroundPosition: `0 ${-meta.splitBottomOffset}px` }
                                : undefined}
                            />
                          )}
                        </>
                      ) : (
                        meta.segmentClass && (
                          <div 
                            className={`timeline-seg ${meta.segmentClass}${meta.segmentVariant ? ` timeline-seg-${meta.segmentVariant}` : ''}`}
                            style={meta.segmentClass === 'timeline-seg-dashed' && meta.dashedOffset !== undefined
                              ? { backgroundPosition: `0 ${-meta.dashedOffset}px` }
                              : undefined}
                          />
                        )
                      )}
                      {meta.dotClass && <div className={meta.dotClass} />}
                    </div>
                    <div className="message-cell">
                      {rendered}
                    </div>
                  </div>
                );
              })}
            {/* 动态添加"Thinking..."消息 */}
            {shouldShowThinking() && renderMessage({
              type: 'thinking',
              content: <ThinkingAnimation />
            }, safeMessages.length)}
            <div ref={messagesEndRef} />
            </div>
          </div>
        )}
      </div>

      {/* 统一输入区域 - 动态高度 */}
      <div className="unified-input-area">
        {/* 统一的白色输入容器 */}
        <div className="unified-input-container">
          {/* 引用区域 */}
          <div className="reference-section">
            {renderSelectedCards()}
          </div>
          
          {/* 输入区域 */}
          <div className="input-section">
            <Box className="input-wrapper">
              <TextField
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyPress={handleKeyPress}
                placeholder="Type your message here"
                variant="outlined"
                multiline
                maxRows={3}
                className="message-input-field"
                fullWidth
              />
              {/* 右下角按钮 - Send/Stop */}
              <Box className="input-button-right">
              {isProcessing ? (
                <IconButton 
                  className="stop-button"
                  onClick={handleStop}
                  title="Stop"
                  size="small"
                >
                  <StopIcon />
                </IconButton>
              ) : (
                <IconButton 
                  type="submit" 
                  className="send-button"
                  disabled={inputValue.trim() === ""}
                  onClick={handleSubmit}
                  title="Send"
                  size="small"
                >
                  <ArrowUpwardIcon />
                </IconButton>
              )}
            </Box>
          </Box>
        </div>
      </div>
      </div>

      {/* 卡片选择器 */}
      <CardSelector
        isVisible={showCardSelector}
        position={selectorPosition}
        searchTerm={mentionSearchTerm}
        onSelectCard={handleCardSelect}
        onClose={handleCloseCardSelector}
      />
    </div>
  );
});

const ChatViewWithObserver = observer(ChatView);
export default ChatViewWithObserver;