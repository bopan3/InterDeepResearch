import React, { useEffect, useState, useRef, useCallback } from 'react';
import './CardDetailConnection.scss';

interface CardDetailConnectionProps {
  cardId: string | null;
  cardType: string | null;
  isDetailOpen: boolean;
  containerRect: DOMRect | null;
  layoutVersion?: number;
  isVisible?: boolean;
}

interface TrapezoidPoints {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  x4: number;
  y4: number;
}

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

const getBaseColorByCardType = (cardType: string | null) => {
  switch (cardType) {
    case 'webpage':
      return '#50B230';
    case 'web_search':
    case 'web_search_result':
      return '#387BFF';
    case 'trace_result':
      return '#FF9900';
    case 'note':
    case 'report':
      return '#E73232';
    default:
      return '#000000';
  }
};

const lightenColor = (hex: string, amount = 0.75) => {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) {
    return hex;
  }

  const num = parseInt(normalized, 16);
  const r = (num >> 16) & 0xff;
  const g = (num >> 8) & 0xff;
  const b = num & 0xff;

  const mix = (channel: number) =>
    Math.round(channel + (255 - channel) * amount);

  const toHex = (channel: number) => channel.toString(16).padStart(2, '0');

  return `#${toHex(mix(r))}${toHex(mix(g))}${toHex(mix(b))}`;
};

const CardDetailConnection: React.FC<CardDetailConnectionProps> = ({
  cardId,
  cardType,
  isDetailOpen,
  containerRect,
  layoutVersion,
  isVisible = true,
}) => {
  const [trapezoidPoints, setTrapezoidPoints] = useState<TrapezoidPoints | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  // 使用 ref 跟踪当前的 cardId，防止竞态条件
  const currentCardIdRef = useRef<string | null>(cardId);
  // 使用 ref 跟踪 detail-panel 元素，用于监听 transitionend 事件
  const detailPanelRef = useRef<HTMLElement | null>(null);
  // 使用 ref 跟踪是否正在等待动画完成
  const isWaitingForAnimationRef = useRef<boolean>(false);
  const baseStrokeColor = getBaseColorByCardType(cardType ?? null);
  const trapezoidFillColor = lightenColor(baseStrokeColor, 0.88);

  // 计算梯形连接点的函数
  const calculateConnection = useCallback(() => {
    // 检查 cardId 是否还是最新的，防止竞态条件
    if (currentCardIdRef.current !== cardId) {
      return; // 如果 cardId 已经变化，忽略这次计算
    }
    
    if (!cardId || !isDetailOpen || !containerRect) {
      setTrapezoidPoints(null);
      return;
    }

    // 查找卡片节点元素
    // ReactFlow 会给节点添加 data-id 属性，节点通常在 .react-flow__node 元素内
    // 尝试多种选择器以确保找到节点
    let cardNodeElement = document.querySelector(`[data-id="${cardId}"]`) as HTMLElement;
    if (!cardNodeElement) {
      // 如果 data-id 选择器失败，尝试通过 ReactFlow 的节点结构查找
      const reactFlowNodes = document.querySelectorAll('.react-flow__node');
      reactFlowNodes.forEach((node) => {
        const nodeId = node.getAttribute('data-id') || node.getAttribute('id');
        if (nodeId === cardId) {
          cardNodeElement = node as HTMLElement;
        }
      });
    }
    const detailViewElement = document.querySelector('.detail-view') as HTMLElement;

    if (!cardNodeElement || !detailViewElement) {
      setTrapezoidPoints(null);
      return;
    }

    // 检查 DetailView 是否处于全屏模式，如果是则不显示连接
    const isFullscreen = detailViewElement.classList.contains('detail-view-fullscreen');
    if (isFullscreen) {
      setTrapezoidPoints(null);
      return;
    }

    // 获取元素的屏幕坐标
    const cardRect = cardNodeElement.getBoundingClientRect();
    const detailRect = detailViewElement.getBoundingClientRect();

    // 计算相对 container 的偏移，保证绘制在 ReactFlow 容器内部
    const offsetX = containerRect.left;
    const offsetY = containerRect.top;

    // 计算连接点
    // 卡片右边缘中点
    const cardRightX = cardRect.right - offsetX;
    const cardRightY = cardRect.top + cardRect.height / 2 - offsetY;

    // DetailView 左边缘中点
    const detailLeftX = detailRect.left - offsetX;
    const detailLeftY = detailRect.top + detailRect.height / 2 - offsetY;

    // 梯形的宽度（从卡片到 DetailView 的距离）
    const distance = detailLeftX - cardRightX;
    const gapSize = 8; // 空隙大小（像素）

    // 如果距离太近或太远，不显示连接（考虑左右两侧的空隙）
    if (distance < 10 + gapSize * 2 || distance > 2000) {
      setTrapezoidPoints(null);
      return;
    }

    // 计算梯形的四个顶点
    // 左边缘（卡片侧）：垂直的线，从卡片右边缘中点向上下延伸
    // 左边缘高度固定为卡片高度的一定比例，不随垂直位置变化
    const cardHeight = cardRect.height;
    const leftHeight = cardHeight * 0.96; // 左边缘高度，卡片高度的 96%
    const leftTopY = cardRightY - leftHeight / 2;
    const leftBottomY = cardRightY + leftHeight / 2;
    const leftX = cardRightX + gapSize; // 左边缘向右偏移，留出空隙

    // 右边缘（DetailView 侧）：垂直的线，从 DetailView 左边缘中点向上下延伸
    // 右边缘高度固定为 DetailView 高度的一定比例，不随垂直位置变化
    const detailHeight = detailRect.height;
    const rightHeight = detailHeight * 0.99; // 右边缘高度，DetailView 高度的 99%
    const rightTopY = detailLeftY - rightHeight / 2;
    const rightBottomY = detailLeftY + rightHeight / 2;
    const rightX = detailLeftX - gapSize; // 右边缘向左偏移，留出空隙

    // 构建梯形顶点（顺时针方向：左上 -> 左下 -> 右下 -> 右上）
    // 左边缘是垂直的：从 (leftX, leftTopY) 到 (leftX, leftBottomY)
    // 右边缘是垂直的：从 (rightX, rightTopY) 到 (rightX, rightBottomY)
    setTrapezoidPoints({
      x1: leftX, // 左上（卡片侧上点，留出空隙）
      y1: leftTopY,
      x2: leftX, // 左下（卡片侧下点，留出空隙）
      y2: leftBottomY,
      x3: rightX, // 右下（DetailView 侧下点，留出空隙）
      y3: rightBottomY,
      x4: rightX, // 右上（DetailView 侧上点，留出空隙）
      y4: rightTopY,
    });
  }, [cardId, isDetailOpen, containerRect]);

  // 更新连接的函数（使用 requestAnimationFrame 确保与渲染同步）
  const updateConnection = useCallback(() => {
    // 如果正在等待动画完成，不更新连接线
    if (isWaitingForAnimationRef.current) {
      return;
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    animationFrameRef.current = requestAnimationFrame(() => {
      calculateConnection();
    });
  }, [calculateConnection]);

  // 监听相关变化
  useEffect(() => {
    if (!isDetailOpen || !cardId) {
      setTrapezoidPoints(null);
      currentCardIdRef.current = null;
      isWaitingForAnimationRef.current = false;
      return;
    }

    // 更新 ref 为最新的 cardId
    currentCardIdRef.current = cardId;
    
    // 取消之前的 RAF（如果有）
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    
    // 当 cardId 变化时，立即清除旧状态，避免显示错误的连接线
    setTrapezoidPoints(null);
    
    // 获取 detail-panel 元素
    const detailPanel = document.querySelector('.detail-panel') as HTMLElement;
    detailPanelRef.current = detailPanel;
    
    // 检查 detail-panel 是否正在动画中的函数
    const checkAnimationState = () => {
      if (!detailPanel) {
        isWaitingForAnimationRef.current = true;
        return;
      }
      
      // 如果 detail-panel 有 'open' class，检查是否还在动画中
      if (detailPanel.classList.contains('open')) {
        // 检查是否真的在动画中（宽度是否已经达到目标值）
        const computedStyle = window.getComputedStyle(detailPanel);
        const currentWidth = parseFloat(computedStyle.width);
        const targetWidth = window.innerWidth * 0.22; // 22% of viewport width
        
        // 如果宽度还没达到目标值（允许 1px 误差），说明还在动画中
        if (Math.abs(currentWidth - targetWidth) > 1) {
          isWaitingForAnimationRef.current = true;
        } else {
          // 宽度已经达到目标值，可以直接计算
          isWaitingForAnimationRef.current = false;
          const rafId = requestAnimationFrame(() => {
            if (currentCardIdRef.current === cardId) {
              calculateConnection();
            }
          });
          animationFrameRef.current = rafId;
        }
      } else {
        // 如果没有 'open' class，说明还没开始动画，等待
        isWaitingForAnimationRef.current = true;
      }
    };
    
    // 立即检查一次
    checkAnimationState();
    
    // 如果 detail-panel 还没有 'open' class，使用 RAF 定期检查，直到它被添加
    let checkRafId: number | null = null;
    if (detailPanel && !detailPanel.classList.contains('open')) {
      const checkUntilOpen = () => {
        if (!detailPanel || currentCardIdRef.current !== cardId) {
          return;
        }
        if (detailPanel.classList.contains('open')) {
          // 'open' class 已经被添加，检查动画状态
          checkAnimationState();
        } else {
          // 继续检查
          checkRafId = requestAnimationFrame(checkUntilOpen);
        }
      };
      checkRafId = requestAnimationFrame(checkUntilOpen);
    }

    // 移除节流，让更新尽可能及时 - 测试是否频率不够是卡顿原因
    const throttledResizeHandler = throttle(() => updateConnection(), 50); // 降低resize节流
    // 滚动事件直接更新，不使用RAF延迟
    const scrollHandler = () => calculateConnection(); // 直接调用，不通过RAF

    // MutationObserver 也直接更新，不节流
    const throttledMutationHandler = () => calculateConnection(); // 直接调用

    // 监听 ReactFlow 视口变化（通过监听容器变化）
    const reactFlowContainer = document.querySelector('.reactflow-container');
    // detailPanel 已经在上面声明过了，这里直接使用

    // 使用 MutationObserver 监听 DOM 变化（包括位置变化）
    const observer = new MutationObserver((mutations) => {
      // 过滤掉来自 DetailView 的变化，避免 markdown 解析过程中的闪烁
      const hasDetailViewChanges = mutations.some(mutation => {
        const target = mutation.target as Element;
        return target.closest('.detail-view') !== null;
      });

      if (!hasDetailViewChanges) {
        throttledMutationHandler();
      }
    });

    if (reactFlowContainer) {
      reactFlowContainer.addEventListener('scroll', scrollHandler, true);
      observer.observe(reactFlowContainer, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }

    if (detailPanel) {
      detailPanel.addEventListener('scroll', scrollHandler, true);
      observer.observe(detailPanel, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      
      // 监听 transitionend 事件，当 width transition 完成时立即显示连接线
      const handleTransitionEnd = (event: TransitionEvent) => {
        // 只处理 width 属性的 transition
        if (event.propertyName === 'width' && isWaitingForAnimationRef.current) {
          // 检查 cardId 是否还有效（不为 null）
          const currentCardId = currentCardIdRef.current;
          if (currentCardId) {
            isWaitingForAnimationRef.current = false;
            // 使用 RAF 确保在下一帧计算，此时 DOM 应该已经完全更新
            const rafId = requestAnimationFrame(() => {
              // 再次检查 cardId 是否还是最新的（防止在 RAF 期间 cardId 变化）
              if (currentCardIdRef.current === currentCardId) {
                calculateConnection();
              }
            });
            animationFrameRef.current = rafId;
          }
        }
      };
      
      detailPanel.addEventListener('transitionend', handleTransitionEnd);
      
      // 清理函数中移除事件监听器
      return () => {
        if (checkRafId !== null) {
          cancelAnimationFrame(checkRafId);
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (reactFlowContainer) {
          reactFlowContainer.removeEventListener('scroll', scrollHandler, true);
        }
        if (detailPanel) {
          detailPanel.removeEventListener('scroll', scrollHandler, true);
          detailPanel.removeEventListener('transitionend', handleTransitionEnd);
        }
        window.removeEventListener('scroll', scrollHandler, true);
        window.removeEventListener('resize', throttledResizeHandler);
        observer.disconnect();
      };
    } else {
      // 如果没有 detailPanel，使用原来的逻辑
      window.addEventListener('scroll', scrollHandler, true);
      window.addEventListener('resize', throttledResizeHandler);

      return () => {
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
        }
        if (reactFlowContainer) {
          reactFlowContainer.removeEventListener('scroll', scrollHandler, true);
        }
        window.removeEventListener('scroll', scrollHandler, true);
        window.removeEventListener('resize', throttledResizeHandler);
        observer.disconnect();
      };
    }
  }, [cardId, isDetailOpen, updateConnection, calculateConnection, layoutVersion]);

  // 如果没有连接点，不渲染
  if (!trapezoidPoints) {
    return null;
  }

  // 构建 SVG polygon 的 points 字符串
  const points = `${trapezoidPoints.x1},${trapezoidPoints.y1} ${trapezoidPoints.x2},${trapezoidPoints.y2} ${trapezoidPoints.x3},${trapezoidPoints.y3} ${trapezoidPoints.x4},${trapezoidPoints.y4}`;

  return (
    <svg
      className="card-detail-connection"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0, // 低于节点，仍高于容器背景
        opacity: isVisible ? 1 : 0,
        transition: 'opacity 0.3s ease-in-out',
      }}
    >
      <polygon
        points={points}
        fill={trapezoidFillColor}
        fillOpacity="0.85"
        className="connection-trapezoid"
      />
      {/* 左侧竖线 */}
      <line
        x1={trapezoidPoints.x1}
        y1={trapezoidPoints.y1}
        x2={trapezoidPoints.x2}
        y2={trapezoidPoints.y2}
        stroke={baseStrokeColor}
        strokeWidth="4"
      />
      {/* 右侧竖线 */}
      <line
        x1={trapezoidPoints.x4}
        y1={trapezoidPoints.y4}
        x2={trapezoidPoints.x3}
        y2={trapezoidPoints.y3}
        stroke={baseStrokeColor}
        strokeWidth="4"
      />
    </svg>
  );
};

export default CardDetailConnection;

