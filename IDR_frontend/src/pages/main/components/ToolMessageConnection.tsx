import React, { useEffect, useState, useRef, useCallback } from 'react';
import { chatStore } from '../../../stores';

interface ToolMessageConnectionProps {
  cardId: string | null;
  isDetailOpen: boolean;
  layoutVersion?: number;
  isVisible?: boolean;
  onConnectionCalculated?: (startX: number, targetX: number, cardId: string) => void;
}

interface PathState {
  d: string;
  color: string;
  start: { x: number; y: number };
}

const DEFAULT_COLOR = '#3473FF';

// 节流函数：限制函数执行频率
const throttle = <T extends (...args: any[]) => void>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let lastCall = 0;
  let timeoutId: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    const now = Date.now();
    const timeSinceLastCall = now - lastCall;
    
    if (timeSinceLastCall >= delay) {
      lastCall = now;
      func(...args);
    } else {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => {
        lastCall = Date.now();
        func(...args);
      }, delay - timeSinceLastCall);
    }
  };
};

// 防抖函数：延迟执行，直到停止触发一段时间
const debounce = <T extends (...args: any[]) => void>(
  func: T,
  delay: number
): ((...args: Parameters<T>) => void) => {
  let timeoutId: NodeJS.Timeout | null = null;
  
  return (...args: Parameters<T>) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      func(...args);
    }, delay);
  };
};

const ToolMessageConnection: React.FC<ToolMessageConnectionProps> = ({
  cardId,
  isDetailOpen,
  layoutVersion,
  isVisible = true,
  onConnectionCalculated
}) => {
  const [pathState, setPathState] = useState<PathState | null>(null);
  const rafRef = useRef<number | null>(null);
  const markerIdRef = useRef<string>(`tool-message-arrow-${Math.random().toString(36).slice(2)}`);

  const escapeSelector = useCallback((value: string) => {
    if (typeof window !== 'undefined' && window.CSS && typeof window.CSS.escape === 'function') {
      return window.CSS.escape(value);
    }
    return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }, []);

  const calculateConnection = useCallback(() => {
    if (!cardId || !isDetailOpen) {
      setPathState(null);
      return;
    }

    // 通过消息数据查找对应的消息（tool_message 或 user_message）
    const message = chatStore.chatList.find(msg =>
      (msg.chat_type === 'tool_message' || msg.chat_type === 'user_message') &&
      msg.chat_content.bind_card_id === cardId
    );

    if (!message) {
      setPathState(null);
      return;
    }

    // 获取 messageId
    const messageId = message.chat_content.bind_card_id || '';

    // 根据消息类型设置颜色
    let color = DEFAULT_COLOR;

    // 如果是 user_message，使用黑色
    if (message.chat_type === 'user_message') {
      color = '#000000';
    } else {
      // 对于 tool_message，根据 first_tool_description 设置颜色
      const firstToolDescription = message.chat_content.first_tool_description || '';

      // 简化版本的颜色逻辑，与 MainLayout 中的 getToolColor 保持一致
      if (firstToolDescription.includes('Search Web')) {
        color = '#387BFF';
      } else if (firstToolDescription.includes('Scrape Webpage')) {
        color = '#50B230';
      } else if (firstToolDescription.includes('Create Note')) {
        color = '#E73232';
      } else if (firstToolDescription.includes('Trace Source')) {
        color = '#FF9900';
      }
    }

    if (!messageId) {
      setPathState(null);
      return;
    }

    const safeMessageId = escapeSelector(messageId);
    const messageElement = document.querySelector(`[data-tool-message-id="${safeMessageId}"]`) as HTMLElement | null;

    if (!messageElement) {
      setPathState(null);
      return;
    }

    const directCore = messageElement.hasAttribute('data-tool-message-core') ? messageElement : null;
    const nestedCore = directCore ? null : (messageElement.querySelector('[data-tool-message-core="true"]') as HTMLElement | null);
    const anchorElement = directCore || nestedCore || messageElement;

    let cardNodeElement = document.querySelector(`[data-id="${cardId}"]`) as HTMLElement | null;

    if (!cardNodeElement) {
      const reactFlowNodes = document.querySelectorAll('.react-flow__node');
      reactFlowNodes.forEach(node => {
        if (!cardNodeElement) {
          const nodeId = node.getAttribute('data-id') || node.getAttribute('id');
          if (nodeId === cardId) {
            cardNodeElement = node as HTMLElement;
          }
        }
      });
    }

    if (!cardNodeElement) {
      setPathState(null);
      return;
    }

    const chatViewElement = document.querySelector('.chat-view') as HTMLElement | null;
    const anchorRect = anchorElement.getBoundingClientRect();
    const cardRect = cardNodeElement.getBoundingClientRect();
    const circleElement = cardNodeElement.querySelector('.card-circle') as HTMLElement | null;
    const circleRect = circleElement?.getBoundingClientRect();
    const chatRect = chatViewElement?.getBoundingClientRect();

    const startGap = 4;
    const startX = anchorRect.right + startGap;
    const startY = anchorRect.top + anchorRect.height / 2;

    const chatExitX = chatRect ? chatRect.right + 8 : startX + 40;
    const minHorizontalDelta = 20;
    const verticalOffset = 12;
    const cardLeftX = cardRect.left;
    const targetX = circleRect ? circleRect.left : cardLeftX;
    const cardCenterY = cardRect.top + cardRect.height / 2;
    const targetY = circleRect ? circleRect.top + circleRect.height / 2 : cardCenterY;
    const effectiveTargetX = Math.min(cardLeftX, targetX);
    const exitX = Math.max(startX + minHorizontalDelta, Math.min(chatExitX, effectiveTargetX - minHorizontalDelta));
    const elbowX = Math.min(exitX + verticalOffset, effectiveTargetX - minHorizontalDelta);
    const points = [
      { x: startX, y: startY },
      { x: elbowX, y: startY },
      { x: elbowX, y: targetY },
      { x: targetX, y: targetY },
    ];

    const buildRoundedPath = (pts: { x: number; y: number }[], radius = 12) => {
      if (pts.length < 2) return '';
      const commands: string[] = [`M ${pts[0].x} ${pts[0].y}`];

      for (let i = 1; i < pts.length; i++) {
        const prev = pts[i - 1];
        const current = pts[i];
        const next = pts[i + 1];

        if (!next) {
          commands.push(`L ${current.x} ${current.y}`);
          continue;
        }

        const isHorizontalPrev = prev.y === current.y;
        const isHorizontalNext = current.y === next.y;

        if (isHorizontalPrev === isHorizontalNext) {
          commands.push(`L ${current.x} ${current.y}`);
          continue;
        }

        const prevLength = isHorizontalPrev
          ? Math.abs(current.x - prev.x)
          : Math.abs(current.y - prev.y);
        const nextLength = isHorizontalNext
          ? Math.abs(next.x - current.x)
          : Math.abs(next.y - current.y);

        const cornerRadius = Math.min(radius, prevLength / 2, nextLength / 2);

        const beforeCorner = isHorizontalPrev
          ? {
              x: current.x - Math.sign(current.x - prev.x) * cornerRadius,
              y: current.y,
            }
          : {
              x: current.x,
              y: current.y - Math.sign(current.y - prev.y) * cornerRadius,
            };

        const afterCorner = isHorizontalNext
          ? {
              x: current.x + Math.sign(next.x - current.x) * cornerRadius,
              y: current.y,
            }
          : {
              x: current.x,
              y: current.y + Math.sign(next.y - current.y) * cornerRadius,
            };

        commands.push(`L ${beforeCorner.x} ${beforeCorner.y}`);
        commands.push(`Q ${current.x} ${current.y} ${afterCorner.x} ${afterCorner.y}`);
      }

      return commands.join(' ');
    };

    const path = buildRoundedPath(points, 24);

    setPathState({
      d: path,
      color: color || DEFAULT_COLOR,
      start: { x: startX, y: startY },
    });

    // 通知父组件连接线的坐标信息
    if (onConnectionCalculated && cardId) {
      onConnectionCalculated(startX, targetX, cardId);
    }
  }, [cardId, escapeSelector, isDetailOpen]);

  const scheduleUpdate = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
    }
    rafRef.current = requestAnimationFrame(() => {
      calculateConnection();
    });
  }, [calculateConnection]);

  useEffect(() => {
    scheduleUpdate();
    if (!cardId || !isDetailOpen) {
      return;
    }

    const messagesList = document.querySelector('.messages-list');
    const chatView = document.querySelector('.chat-view');
    const reactFlowPanel = document.querySelector('.reactflow-panel');
    const reactFlowViewport = document.querySelector('.react-flow__viewport');

    // 使用节流优化事件处理：resize 200ms
    // 滚动事件直接使用 RAF，确保与动画同步，避免延迟
    const throttledResizeHandler = throttle(() => scheduleUpdate(), 200);
    const scrollHandler = () => scheduleUpdate();
    
    // MutationObserver 使用节流而不是防抖，确保及时响应
    // 节流保证频率限制（16ms ≈ 60fps），但不会延迟执行
    const throttledMutationHandler = throttle(() => scheduleUpdate(), 16);

    window.addEventListener('resize', throttledResizeHandler);
    window.addEventListener('scroll', scrollHandler, true);
    messagesList?.addEventListener('scroll', scrollHandler, true);
    chatView?.addEventListener('scroll', scrollHandler, true);
    reactFlowPanel?.addEventListener('scroll', scrollHandler, true);

    const observer = new MutationObserver(() => throttledMutationHandler());
    if (reactFlowViewport) {
      observer.observe(reactFlowViewport, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }
    if (reactFlowPanel) {
      observer.observe(reactFlowPanel, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }

    // 移除定时器，改为事件驱动更新

    return () => {
      window.removeEventListener('resize', throttledResizeHandler);
      window.removeEventListener('scroll', scrollHandler, true);
      messagesList?.removeEventListener('scroll', scrollHandler, true);
      chatView?.removeEventListener('scroll', scrollHandler, true);
      reactFlowPanel?.removeEventListener('scroll', scrollHandler, true);
      observer.disconnect();
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [cardId, isDetailOpen, scheduleUpdate, layoutVersion]);

  if (!cardId || !isDetailOpen || !pathState) {
    return null;
  }

  const markerId = markerIdRef.current;

  return (
    <svg
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 450,
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
      }}
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="9"
          markerHeight="9"
          refX="14"
          refY="8"
          orient="auto"
          markerUnits="strokeWidth"
          viewBox="0 0 16 16"
        >
          <g fill={pathState.color} stroke="none">
            <rect
              x="6"
              y="7"
              width="8"
              height="1.6"
              rx="1.05"
              transform="rotate(-42 14 8)"
            />
            <rect
              x="6"
              y="7"
              width="8"
              height="1.6"
              rx="1.05"
              transform="rotate(42 14 8)"
            />
          </g>
        </marker>
      </defs>

      <path
        d={pathState.d}
        stroke={pathState.color}
        strokeWidth="4"
        strokeDasharray="7 6"
        fill="none"
        strokeLinecap="butt"
        strokeLinejoin="miter"
        markerEnd={`url(#${markerId})`}
        opacity={0.95}
      />

      <rect
        x={pathState.start.x - 2}
        y={pathState.start.y - 6}
        width={4}
        height={12}
        fill={pathState.color}
      />
    </svg>
  );
};

export default ToolMessageConnection;

