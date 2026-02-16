import React, { useMemo, useEffect, useCallback, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import { observer } from 'mobx-react-lite';
import { ReactFlow, Background, Controls, ControlButton, Node, Edge, useNodesState, useEdgesState, NodeChange, ReactFlowInstance, Connection, EdgeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import './ReactFlowView.scss';
import CardNode from './CardNode';
import CardDetailConnection from './CardDetailConnection';
import ToolMessageConnection from './ToolMessageConnection';
import { chatStore, cardStore, historyStore, traceStore } from '../../../stores';
import type { Card, CardContent } from '../../../stores/CardType';
import { useElkLayout } from '../hooks/useElkLayout';

interface ReactFlowViewProps {
  onCardClick?: (card: Card, cardId: string) => void;
  isSelectionMode?: boolean; // 新增：选择模式状态
  selectedCardsForAction?: string[]; // 新增：选中的卡片列表
  onCurrentCardChange?: (cardId: string) => void; // 新增：当前Card变化回调
  currentCardId?: string; // 新增：当前 Card ID
  onCardSwitch?: (cardId: string) => void; // 新增：Card 切换回调
  selectedCardId?: string; // 当前 DetailView 中的卡片 ID
  isDetailOpen?: boolean; // DetailView 是否打开
  onCloseDetail?: () => void; // DetailView 关闭回调
  hoveredToolCard?: { cardId: string; color?: string } | null; // 新增：悬浮工具消息
  detailConnectionCardId?: string | null;
  detailConnectionCardType?: string | null;
  detailConnectionOpen?: boolean;
  onHideToolConnection?: () => void; // 新增：隐藏工具连接线的回调
  onUnifiedRightClick?: (cardId: string) => void; // 统一的右键处理回调
  onConnectionCalculated?: (startX: number, targetX: number, cardId: string) => void; // 新增：连接线坐标计算回调
}

// 暴露给父组件的方法接口
export interface ReactFlowViewRef {
  focusCard: (cardId: string, skipModeSwitch?: boolean) => void; // 新增 skipModeSwitch 参数，用于系统自动调用时不退出 auto 模式
  expandCard: (cardId: string) => Promise<boolean>; // 修改：返回是否成功展开
  collapseCard: (cardId: string) => Promise<void>; // 新增：收缩卡片方法
  getViewMode: () => 'auto' | 'manual'; // 新增：获取当前视图模式
  startAutoLayout: () => void;
  hideConnections: () => void; // 新增：隐藏所有连接线
  showConnections: () => void; // 新增：显示所有连接线
  hideDetailConnections: () => void; // 新增：隐藏详情视图期间的连接线
  showDetailConnections: () => void; // 新增：显示详情视图期间的连接线
  getCardCollapsedState: (cardId: string) => boolean; // 获取卡片的折叠状态
}

// 全局节点引用，用于在边缘组件中访问节点信息
let globalNodesRef: Node[] = [];

// 自定义 Edge：实线+箭头，简化边缘计算逻辑
const FreeEdge = ({ id, source, target, data }: EdgeProps) => {
  const sourceNode = globalNodesRef.find((n) => n.id === source);
  const targetNode = globalNodesRef.find((n) => n.id === target);
  
  // 添加动画状态检测和位置插值
  const [isAnimating, setIsAnimating] = React.useState(false);
  const [animatedSourcePos, setAnimatedSourcePos] = React.useState({ x: 0, y: 0 });
  const [animatedTargetPos, setAnimatedTargetPos] = React.useState({ x: 0, y: 0 });
  // 添加连接点动画状态
  const [animatedSourceDimensions, setAnimatedSourceDimensions] = React.useState({ width: 0, height: 0 });
  const [animatedTargetDimensions, setAnimatedTargetDimensions] = React.useState({ width: 0, height: 0 });
  const prevSourceCollapsed = React.useRef<boolean | undefined>(undefined);
  const prevTargetCollapsed = React.useRef<boolean | undefined>(undefined);
  const animationStartTime = React.useRef<number>(0);
  const animationDuration = 475; // 动画持续时间

  // 初始化动画位置和尺寸（守卫：节点缺失时不执行）
  React.useEffect(() => {
      if (!sourceNode || !targetNode) return;
      if (!isAnimating) {
          setAnimatedSourcePos({ x: sourceNode.position.x, y: sourceNode.position.y });
          setAnimatedTargetPos({ x: targetNode.position.x, y: targetNode.position.y });
          const sourceDims = getNodeDimensions(sourceNode);
          const targetDims = getNodeDimensions(targetNode);
          setAnimatedSourceDimensions(sourceDims);
          setAnimatedTargetDimensions(targetDims);
      }
  }, [sourceNode, targetNode, isAnimating]);

  // 动画插值函数
  const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

  // 动画循环
  React.useEffect(() => {
      // 守卫：未在动画状态或节点缺失时跳过
      if (!isAnimating || !sourceNode || !targetNode) return;
  
      const startSourcePos = { ...animatedSourcePos };
      const startTargetPos = { ...animatedTargetPos };
      const startSourceDims = { ...animatedSourceDimensions };
      const startTargetDims = { ...animatedTargetDimensions };
      
      const endSourcePos = { x: sourceNode.position.x, y: sourceNode.position.y };
      const endTargetPos = { x: targetNode.position.x, y: targetNode.position.y };
      const endSourceDims = getNodeDimensions(sourceNode);
      const endTargetDims = getNodeDimensions(targetNode);
  
      const animate = () => {
          const now = Date.now();
          const elapsed = now - animationStartTime.current;
          const progress = Math.min(elapsed / animationDuration, 1);
          const easedProgress = easeOutCubic(progress);
  
          const currentSourcePos = {
              x: startSourcePos.x + (endSourcePos.x - startSourcePos.x) * easedProgress,
              y: startSourcePos.y + (endSourcePos.y - startSourcePos.y) * easedProgress,
          };
          const currentTargetPos = {
              x: startTargetPos.x + (endTargetPos.x - startTargetPos.x) * easedProgress,
              y: startTargetPos.y + (endTargetPos.y - startTargetPos.y) * easedProgress,
          };
  
          const currentSourceDims = {
              width: startSourceDims.width + (endSourceDims.width - startSourceDims.width) * easedProgress,
              height: startSourceDims.height + (endSourceDims.height - startSourceDims.height) * easedProgress,
          };
          const currentTargetDims = {
              width: startTargetDims.width + (endTargetDims.width - startTargetDims.width) * easedProgress,
              height: startTargetDims.height + (endTargetDims.height - startTargetDims.height) * easedProgress,
          };
  
          setAnimatedSourcePos(currentSourcePos);
          setAnimatedTargetPos(currentTargetPos);
          setAnimatedSourceDimensions(currentSourceDims);
          setAnimatedTargetDimensions(currentTargetDims);
  
          if (progress < 1) {
              requestAnimationFrame(animate);
          } else {
              setIsAnimating(false);
          }
      };
  
      animationStartTime.current = Date.now();
      requestAnimationFrame(animate);
  // 关键：依赖节点对象本身，不依赖其属性，避免 TS18048
  }, [isAnimating, sourceNode, targetNode]);

  // 监听全局动画状态
  React.useEffect(() => {
    const checkGlobalAnimation = () => {
      const nodeElements = document.querySelectorAll('.react-flow__node.animating');
      if (nodeElements.length > 0 && !isAnimating) {
      
        setIsAnimating(true);
      }
    };

    const observer = new MutationObserver(checkGlobalAnimation);
    observer.observe(document.body, { 
      childList: true, 
      subtree: true, 
      attributes: true, 
      attributeFilter: ['class'] 
    });

    return () => observer.disconnect();
  }, [isAnimating]);


  // 节点尺寸获取函数，统一数值来源（与 ELK 保持一致）
  const getNodeDimensions = (node: Node) => {
    const isCollapsed = node.data?.isCollapsed;
    const defaultWidth = isCollapsed ? 180 : 320;
    const defaultHeight = isCollapsed ? 48 : 200;
    const widthCollapsed = (node.data as any)?.logicalWidthCollapsed;
    const widthExpanded = (node.data as any)?.logicalWidthExpanded;
    const heightCollapsed = (node.data as any)?.logicalHeightCollapsed;
    const heightExpanded = (node.data as any)?.logicalHeightExpanded;
    const width =
      (node.style as any)?.width ??
      (node as any).width ??
      (isCollapsed ? widthCollapsed : widthExpanded) ??
      defaultWidth;
    const height =
      (node.style as any)?.height ??
      (node as any).height ??
      (isCollapsed ? heightCollapsed : heightExpanded) ??
      defaultHeight;
    return { width: Number(width), height: Number(height) };
  };

  // 根据节点状态动态调整连接点偏移（守卫：节点可能缺失）
  const sourceIsCollapsed = sourceNode?.data?.isCollapsed;
  const targetIsCollapsed = targetNode?.data?.isCollapsed;

  // 检测节点状态变化并触发动画（Hook 始终调用；内部守卫节点存在）
  React.useEffect(() => {
    if (!sourceNode || !targetNode) return;
    const currentSourceCollapsed = sourceIsCollapsed;
    const currentTargetCollapsed = targetIsCollapsed;
    if (
      (prevSourceCollapsed.current !== undefined && prevSourceCollapsed.current !== currentSourceCollapsed) ||
      (prevTargetCollapsed.current !== undefined && prevTargetCollapsed.current !== currentTargetCollapsed)
    ) {
      setAnimatedSourceDimensions(getNodeDimensions({ ...sourceNode, data: { ...sourceNode.data, isCollapsed: prevSourceCollapsed.current } }));
      setAnimatedTargetDimensions(getNodeDimensions({ ...targetNode, data: { ...targetNode.data, isCollapsed: prevTargetCollapsed.current } }));
      setIsAnimating(true);
    }
    prevSourceCollapsed.current = currentSourceCollapsed;
    prevTargetCollapsed.current = currentTargetCollapsed;
  }, [sourceIsCollapsed, targetIsCollapsed, sourceNode, targetNode]);

  // 早退：在所有 Hook 之后进行，避免 Hook 次数变化
  if (!sourceNode || !targetNode) {
    return null;
  }

  // 使用动画尺寸计算连接点，避免跳变
  const sourceDimensions = isAnimating ? animatedSourceDimensions : getNodeDimensions(sourceNode);
  const targetDimensions = isAnimating ? animatedTargetDimensions : getNodeDimensions(targetNode);
  
  const sourceHalfWidth = sourceDimensions.width / 2 + 15;
  const sourceHeight = sourceDimensions.height;
  const targetHalfWidth = targetDimensions.width / 2 + 15;
  
  // 使用动画位置计算连接点坐标
  const currentSourcePos = isAnimating ? animatedSourcePos : sourceNode.position;
  const currentTargetPos = isAnimating ? animatedTargetPos : targetNode.position;

  // 临时判断 trace，避免与后面变量冲突
  const _isTrace = (data as any)?.isTraceEdge || false;

  let sourceCenterX, sourceBottomY, targetCenterX, targetTopY;

  if (_isTrace) {
     // === Trace 卡片连线自定义点位 ===
     // 在这里修改 Trace 卡片的连接点计算逻辑
     // 目前设置与普通卡片一致，可根据需求微调
     const traceSourceOffsetY = sourceIsCollapsed ? 10 : 0;
     const traceTargetOffsetY = targetIsCollapsed ? 25 : 180;

     sourceCenterX = currentSourcePos.x + sourceHalfWidth;
     sourceBottomY = currentSourcePos.y + traceSourceOffsetY;

     targetCenterX = currentTargetPos.x + targetHalfWidth;
     targetTopY = currentTargetPos.y + traceTargetOffsetY;
  } else {
     // === 普通卡片连线点位 ===
     // 简化偏移计算 - 固定偏移值，避免X坐标在动画过程中变化
     const sourceOffsetY = sourceIsCollapsed ? 15 : 160;
     const targetOffsetY = targetIsCollapsed ? 20 : 0;

     sourceCenterX = currentSourcePos.x + sourceHalfWidth;
     sourceBottomY = currentSourcePos.y + sourceOffsetY;

     targetCenterX = currentTargetPos.x + targetHalfWidth;
     targetTopY = currentTargetPos.y + targetOffsetY;
  }

  // 路由为水平/垂直折线，避免穿过卡片
  const margin = 20; // 与节点保持的最小垂直间距
  let midY: number;
  if (sourceBottomY + margin <= targetTopY - margin) {
    // 两节点在垂直方向上有足够间距，取中点作为水平段
    midY = (sourceBottomY + targetTopY) / 2;
  } else {
    // 垂直空间不足，从较下方处绕行
    midY = Math.max(sourceBottomY, targetTopY) + margin;
  }

  // 直接连接到节点边缘，不需要偏移量
  const targetEndY = targetTopY;
  const startY = sourceBottomY;

  // 生成曲线路径（类似temp.html的curve函数）
  const createCurvePath = (p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    const dx = Math.abs(p2.x - p1.x);
    const dy = Math.abs(p2.y - p1.y);
    
    // 根据距离动态调整弯曲度：垂直距离越大，弯曲度越小；水平距离越大，弯曲度也适当减小
    let smoothness = 0.6;
    if (dy > 200) {
      smoothness = Math.max(0.3, 0.6 - (dy - 200) / 1000); // 垂直距离大时减少弯曲
    }
    if (dx > 300) {
      smoothness = Math.max(0.2, smoothness - (dx - 300) / 2000); // 水平距离大时进一步减少弯曲
    }
    
    const controlOffset = (p2.y - p1.y) * smoothness;
    return `M ${p1.x},${p1.y} C ${p1.x},${p1.y + controlOffset} ${p2.x},${p2.y - controlOffset} ${p2.x},${p2.y}`;
  };

  // 使用曲线路径，简化为起点和终点
  const startPoint = { x: sourceCenterX, y: startY };
  // const startPoint = { x: 0, y: 0 };
  const endPoint = { x: targetCenterX, y: targetEndY };
  
  // 如果有ELK路由点，使用第一个和最后一个点
  let edgePath: string;
    edgePath = createCurvePath(startPoint, endPoint);

  // 检查是否为 trace 连线
  const isTraceEdge = (data as any)?.isTraceEdge || false;
  
  // 检查引用类型：从 data 中获取引用类型信息
  const referenceType = (data as any)?.referenceType || 'explicit'; // 默认为显式引用
  const isImplicit = referenceType === 'implicit';
  
  // 新格式中没有 card_status，可以检查 card_content 中的状态或使用其他逻辑
  const isCreating = false; // 暂时设为 false，后续可根据实际需求调整
  
  // 获取 hover 高亮信息
  const selectedCardId = (data as any)?.selectedCardId;
  const hoveredToolCard = (data as any)?.hoveredToolCard;
  
  // 检查当前边是否应该高亮：从被引用的 card（source）到引用它的 card（target，即 DetailView 中显示的 card）
  // 当用户在 DetailView 中悬停 citation 时：
  // - selectedCardId 是 DetailView 中当前显示的 card（引用者，即 target）
  // - hoveredToolCard.cardId 是被引用的 card（被引用者，即 source）
  const isHighlighted = selectedCardId && hoveredToolCard?.cardId && 
    source === hoveredToolCard.cardId && target === selectedCardId;
  
  // 根据 hover 状态和 trace 连线类型决定样式
  // trace 连线使用 #FF9900 颜色，不受 hover 高亮影响
  const strokeColor = isTraceEdge 
    ? '#FF9900'
    : (isHighlighted && hoveredToolCard?.color 
    ? hoveredToolCard.color 
      : (isCreating ? '#0891B2' : '#94a3b8'));
  const strokeWidth = isHighlighted && !isTraceEdge ? 3 : 1.5;

  return (
    <g className={isAnimating ? 'animating' : ''}>
      {/* 绘制线条，根据引用类型设置实线或虚线，添加增强的动画效果 */}
      <path
        d={edgePath}
        style={{
          stroke: strokeColor,
          strokeWidth: strokeWidth,
          fill: 'none',
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          strokeDasharray: isImplicit ? '5,5' : 'none', // 隐式引用使用虚线，显式引用使用实线
          transition: 'stroke 0.2s ease, stroke-width 0.2s ease', // 添加平滑过渡效果
        }}
      />
    </g>
  );
};

// 定义自定义节点类型和边类型
const nodeTypes = {
  cardNode: CardNode,
};

const edgeTypes = {
  freeEdge: FreeEdge,
};

const ReactFlowView = observer(forwardRef<ReactFlowViewRef, ReactFlowViewProps>(({ 
  onCardClick, 
  isSelectionMode = false, 
  selectedCardsForAction = [], 
  onCurrentCardChange, 
  currentCardId = '',
  onCardSwitch,
  selectedCardId = '',
  isDetailOpen = false,
  onCloseDetail,
  hoveredToolCard = null,
  detailConnectionCardId = null,
  detailConnectionCardType = null,
  detailConnectionOpen = false,
  onHideToolConnection,
  onUnifiedRightClick,
  onConnectionCalculated,
}, ref) => {
  const highlightCardId = hoveredToolCard?.cardId;
  
  // Auto / Manual view mode
  const [viewMode, setViewMode] = useState<'auto' | 'manual'>('manual');
  const [connectionsVisible, setConnectionsVisible] = useState<boolean>(true);
  const [detailConnectionsVisible, setDetailConnectionsVisible] = useState<boolean>(true);
  const [widthCalNonce, setWidthCalNonce] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 订阅 cardStore 的时间戳变化 - 简化的依赖追踪方案
  const lastUpdateTimestamp = cardStore.lastUpdateTimestamp;
  // 创建focusCard的引用，避免在useMemo中使用还未定义的函数
  const focusCardRef = useRef<((cardId: string, skipModeSwitch?: boolean) => void) | null>(null);
  const widthCacheRef = useRef<Map<string, { collapsed: number; expanded: number }>>(new Map());
  const traceLastUpdateTimestamp = traceStore.lastUpdateTimestamp;

  // 用于延迟生成 trace 卡片的机制
  const [pendingTraceHosts, setPendingTraceHosts] = useState<Set<string>>(new Set());
  const [delayedTraceTimestamp, setDelayedTraceTimestamp] = useState<number>(0);

  // 记录已经触发过宿主卡片展开的 trace ID，避免重复展开
  const [expandedTraceHosts, setExpandedTraceHosts] = useState<Set<number>>(new Set());
  

  // 卡片收起状态管理 - 用于 ELK 布局计算（需在测量回调之前）
  const [cardCollapsedStates, setCardCollapsedStates] = useState<Record<string, boolean>>({});

  
  
  
  // 直接的点击处理函数
  const handleDirectCardClick = useCallback((card: Card, agentId: string) => {
    if (onCardClick) {
      onCardClick(card, agentId);
    }
  }, [onCardClick]);

  // 控制详情视图期间连接线显示的方法
  const hideDetailConnections = useCallback(() => {
    setDetailConnectionsVisible(false);
  }, []);

  const showDetailConnections = useCallback(() => {
    setDetailConnectionsVisible(true);
  }, []);
  

  


  // 获取卡片的默认收起状态
  const getDefaultCollapsedState = (card: Card) => {
    // 如果是 in_progress 状态，强制保持折叠态
    if (card.status === 'in_progress') {
      return true;
    }
    // 如果 unfold_at_start 为 true，则默认展开；否则折叠
    return !(card.unfold_at_start === true);
  };
  
  // 初始化卡片收起状态
  useEffect(() => {
    const allCards = cardStore.cardList;
    const newStates: Record<string, boolean> = {};
    
    allCards.forEach((card: Card) => {
      const cardId = card.card_id || `temp_${allCards.indexOf(card)}`;
      // 如果状态不存在，使用默认状态
      // 如果是 in_progress 状态，强制设置为折叠态
      if (!(cardId in cardCollapsedStates) || card.status === 'in_progress') {
        newStates[cardId] = getDefaultCollapsedState(card);
      }
    });
    
    if (Object.keys(newStates).length > 0) {
      setCardCollapsedStates(prev => ({ ...prev, ...newStates }));
    }
  }, [lastUpdateTimestamp]);
  

  
  // 切换卡片收起状态的函数
  const toggleCardCollapsed = useCallback((cardId: string) => {
    console.log(`[DEBUG-TRACE] toggleCardCollapsed 被调用: cardId=${cardId}`);

    // 检查卡片是否为 in_progress 状态，如果是则不允许切换
    const card = cardStore.getCard(cardId);
    if (card && card.status === 'in_progress') {
      console.log(`[DEBUG-TRACE] 卡片 ${cardId} 处于 in_progress 状态，跳过折叠切换`);
      return; // in_progress 状态的卡片不允许切换，始终保持折叠态
    }
    
    setCardCollapsedStates(prev => {
      const newCollapsed = !prev[cardId];
      console.log(`[DEBUG-TRACE] 卡片 ${cardId} 折叠状态从 ${prev[cardId]} 变为 ${newCollapsed}`);
      return {
      ...prev,
        [cardId]: newCollapsed
      };
    });
    setPendingLayoutDueToCollapse(true);
  }, []);

  // 外部强制展开指定卡片的函数
  const expandCard = useCallback(async (cardId: string): Promise<boolean> => {
    const card = cardStore.getCard(cardId);
    if (card && card.status === 'in_progress') {
      return false; // 无法展开 in_progress 状态的卡片
    }

    return new Promise((resolve) => {
    setCardCollapsedStates(prev => {
      if (prev[cardId] === false) {
          // 已经是展开状态，返回 true
          resolve(true);
        return prev;
      }
      setPendingLayoutDueToCollapse(true);
        const newStates = {
        ...prev,
        [cardId]: false,
      };
        // 等待展开动画完成
        setTimeout(() => {
          resolve(true); // 成功展开
        }, 400); // EXPAND_ANIMATION_DURATION
        return newStates;
      });
    });
  }, []);

  // 外部强制收缩指定卡片的函数
  const collapseCard = useCallback(async (cardId: string): Promise<void> => {
    const card = cardStore.getCard(cardId);
    if (card && card.status === 'in_progress') {
      return; // in_progress 状态的卡片不允许收缩
    }

    return new Promise((resolve) => {
    setCardCollapsedStates(prev => {
      if (prev[cardId] === true) {
          // 已经是收缩状态，直接resolve
          resolve();
          return prev;
      }
      setPendingLayoutDueToCollapse(true);
        const newStates = {
        ...prev,
        [cardId]: true,
      };
        // 等待收缩动画完成
        setTimeout(() => {
          resolve();
        }, 400); // COLLAPSE_ANIMATION_DURATION
        return newStates;
      });
    });
  }, []);

  // 隐藏所有连接线
  const hideConnections = useCallback(() => {
    setConnectionsVisible(false);
  }, []);

  // 显示所有连接线
  const showConnections = useCallback(() => {
    setConnectionsVisible(true);
  }, []);

  // 获取当前视图模式
  const getViewMode = useCallback(() => {
    return viewMode;
  }, [viewMode]);
  
  // console.log('[DEBUG] 组件渲染 - 时间戳:', lastUpdateTimestamp);
  
  // 初始化时通知父组件当前Card ID
  useEffect(() => {
    if (onCurrentCardChange) {
      // console.log('[DEBUG] 初始化通知父组件当前Card:', currentCardId);
      onCurrentCardChange(currentCardId);
    }
  }, [onCurrentCardChange]); // 只在组件挂载时执行一次
  
  // 处理 Card 切换
  const handleCardSwitch = useCallback((targetCardId: string) => {
    // console.log('[DEBUG] ========== Card 切换开始 ==========');
    // console.log('[DEBUG] 当前 currentCardId:', currentCardId);
    // console.log('[DEBUG] 目标 targetCardId:', targetCardId);
    // console.log('[DEBUG] 是否真的需要切换:', currentCardId !== targetCardId);
    
    if (currentCardId !== targetCardId && onCardSwitch) {
      // console.log('[DEBUG] 执行 onCardSwitch...');
      onCardSwitch(targetCardId);
      // console.log('[DEBUG] onCardSwitch 调用完成');
      
      // 通知父组件当前Card已切换
      if (onCurrentCardChange) {
        // console.log('[DEBUG] 通知父组件Card切换:', targetCardId);
        onCurrentCardChange(targetCardId);
      }
    } else {
      // console.log('[DEBUG] 目标 Card 与当前 Card 相同，无需切换');
    }
    // console.log('[DEBUG] ========== Card 切换结束 ==========');
  }, [currentCardId, onCardSwitch, onCurrentCardChange]);

  // 直接的切换收起状态函数
  const createToggleCollapsed = useCallback((cardId: string) => {
    return () => {
      toggleCardCollapsed(cardId);
    };
  }, [toggleCardCollapsed]);

  // 处理 trace 数据更新：先展开宿主卡片，再延迟生成 trace 卡片
  useEffect(() => {
    const currentTraceDict = traceStore.traces;
    if (Object.keys(currentTraceDict).length === 0) return;

    // 找出新的 trace 数据对应的宿主卡片，但只处理第一次出现的 trace
    const newHostCardIds = new Set<string>();
    Object.values(currentTraceDict).forEach((traceNode) => {
      // 只处理还没有触发过宿主展开的 trace
      if (traceNode.card_id && !expandedTraceHosts.has(traceNode.trace_id)) {
        newHostCardIds.add(traceNode.card_id);
      }
    });

    // 检查这些宿主卡片是否已经展开
    const hostsToExpand = Array.from(newHostCardIds).filter((cardId) => {
      const hostCard = cardStore.cardList.find(c => c.card_id === cardId);
      if (!hostCard) return false;

      const hostNodeId = hostCard.card_id || `temp_${cardStore.cardList.indexOf(hostCard)}`;
      const isCollapsed = cardCollapsedStates[hostNodeId] ?? getDefaultCollapsedState(hostCard);
      return isCollapsed; // 如果折叠了，需要展开
    });

    if (hostsToExpand.length > 0) {
      // 记录这些 trace ID 已经触发过展开
      const traceIdsToMark = Object.values(currentTraceDict)
        .filter(traceNode => traceNode.card_id && hostsToExpand.includes(traceNode.card_id))
        .map(traceNode => traceNode.trace_id);

      setExpandedTraceHosts(prev => new Set([...Array.from(prev), ...traceIdsToMark]));

      // 先展开宿主卡片
      const expandPromises = hostsToExpand.map(cardId => expandCard(cardId));
      Promise.all(expandPromises).then(() => {
        // 等待 400ms 让展开动画完成，然后标记可以生成 trace 卡片
        setTimeout(() => {
          setDelayedTraceTimestamp(Date.now());
        }, 400);
      });
    } else {
      // 如果没有需要展开的卡片，直接生成 trace 卡片
      setDelayedTraceTimestamp(Date.now());
    }
  }, [traceLastUpdateTimestamp, cardStore.cardList, expandCard, expandedTraceHosts]); // 移除 cardCollapsedStates 依赖，避免每次折叠都重新生成节点

  // 直接在渲染中计算节点和边，利用 MobX observer 的自动响应式特性
  const computedGraph = useMemo(() => {
    // console.log('[DEBUG] ========== 开始计算节点和边 ==========');
    // console.log('[DEBUG] CardStore 中所有 Card IDs:', Object.keys(cardStore.card_dict));
    
    // 获取所有卡片数据
    const allCards = cardStore.cardList;
    // console.log('[DEBUG] 获取到的卡片列表长度:', allCards.length);
    // console.log('[DEBUG] 卡片列表:', allCards.map(card => ({ id: card.card_id, type: card.card_type })));
    
    // 构建初始节点（使用临时位置）
    // 文本宽度测量工具（使用离屏 canvas，带缓存优化）
    const measureTextWidth = (() => {
      const cache = new Map<string, number>();
      return (text: string, font: string): number => {
        const key = `${text}|${font}`;
        if (cache.has(key)) {
          return cache.get(key)!;
        }

      if (typeof document === 'undefined') return text.length * 10;
      const canvas = (measureTextWidth as any)._canvas || ((measureTextWidth as any)._canvas = document.createElement('canvas'));
      const context = canvas.getContext('2d');
      if (!context) return text.length * 10;
      context.font = font;
      const metrics = context.measureText(text);
        const width = metrics.width;
        cache.set(key, width);
        return width;
    };
    })();

    const initialNodes: Node[] = allCards.map((card: Card) => {
      const cardId = card.card_id || `temp_${allCards.indexOf(card)}`;
      // 如果是 in_progress 状态，强制保持折叠态
      const baseIsCollapsed = cardCollapsedStates[cardId] ?? getDefaultCollapsedState(card);
      const isCollapsed = card.status === 'in_progress' ? true : baseIsCollapsed;
      const AUTO_SCALE = 1.0;

      // 离散宽度配置
      const STEP = 20 * AUTO_SCALE;
      const MIN_WIDTH_EXPANDED = 320 * AUTO_SCALE;
      const MAX_WIDTH_EXPANDED = 480 * AUTO_SCALE;
      const MIN_WIDTH_COLLAPSED = 180 * AUTO_SCALE;
      const MAX_WIDTH_COLLAPSED = 260 * AUTO_SCALE;

      // 文本和结构测量（根据标题长度取能完整显示的最小值）
      const title = (card as any)?.card_content?.card_title || card.card_type || '未命名卡片';
      const fontCollapsed = '500 9px "Inter", system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      const fontExpanded = '600 20px "Inter", system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif';
      const textWidthCollapsed = measureTextWidth(title, fontCollapsed);
      const textWidthExpanded = measureTextWidth(title, fontExpanded);

      // 收起态：节点总宽度 = 图标宽(28) + 标题胶囊宽(文本 + 左右padding 24/16 + 边框 2*2) - 重叠量(14)
      const collapsedIconW = 28;
      const collapsedTitlePaddingX = 24 + 16;
      const collapsedTitleBorderX = 2 + 2;
      const collapsedOverlap = 14;
      const requiredCollapsedNodeW = collapsedIconW + (textWidthCollapsed + collapsedTitlePaddingX + collapsedTitleBorderX) - collapsedOverlap;

      // 展开态：节点总宽度 >= 文本宽度 + 左侧 header 空白(32) + 主体左右 padding(8+8) + 卡片边框(2+2)
      const headerLeftW = 32;
      const bodyPaddingX = 8 + 8;
      const cardBorderX = 2 + 2;
      const requiredExpandedNodeW = textWidthExpanded + headerLeftW + bodyPaddingX + cardBorderX;

      // 选择最小离散宽度（向上取整到最近的 20px 档位，且在范围内）
      const discreteCeilWidth = (minW: number, maxW: number, reqW: number) => {
        const clampedReq = Math.max(minW, Math.min(maxW, reqW));
        const delta = clampedReq - minW;
        const steps = Math.ceil(delta / STEP);
        return Math.min(maxW, minW + steps * STEP);
      };

      // 独立宽度：分别计算收起/展开的最小离散宽度
      const discreteCollapsedW = discreteCeilWidth(MIN_WIDTH_COLLAPSED, MAX_WIDTH_COLLAPSED, requiredCollapsedNodeW);
      const discreteExpandedW = discreteCeilWidth(MIN_WIDTH_EXPANDED, MAX_WIDTH_EXPANDED, requiredExpandedNodeW);

      // 缓存：每个卡片分别缓存两种状态的宽度
      const cachedPair = widthCacheRef.current.get(cardId);
      const widthCollapsed = cachedPair?.collapsed ?? discreteCollapsedW;
      const widthExpanded = cachedPair?.expanded ?? discreteExpandedW;
      if (!cachedPair) {
        widthCacheRef.current.set(cardId, { collapsed: widthCollapsed, expanded: widthExpanded });
      }
      const heightCollapsed = 48 * AUTO_SCALE;
      const heightExpanded = 200 * AUTO_SCALE;
      const computedWidth = isCollapsed ? widthCollapsed : widthExpanded;
      const computedHeight = isCollapsed ? heightCollapsed : heightExpanded;

      return {
        id: cardId,
        type: 'cardNode',
        position: { x: 0, y: 0 }, // 临时位置，将由 ELK 布局计算
        data: {
          cardId: card.card_id,
          agentId: currentCardId, // 添加 agentId 字段
          card: card, // 直接传递完整的 Card 对象
          onShowDetail: handleDirectCardClick, // 传递直接的详情按钮点击处理函数
          onCardSwitch: handleCardSwitch, // 传递直接的 Card 切换回调函数
          isSelectionMode: isSelectionMode, // 传递选择模式状态
          isSelectedForAction: selectedCardsForAction.includes(cardId), // 传递是否被选中状态
          isCollapsed: isCollapsed, // 传递收起状态
          onToggleCollapsed: createToggleCollapsed(cardId), // 传递直接的切换收起状态的函数

          currentDetailCardId: selectedCardId,
          isDetailOpen,
          onCloseDetail,
          isHighlighted: highlightCardId === cardId,
          logicalWidthCollapsed: widthCollapsed,
          logicalWidthExpanded: widthExpanded,
          logicalHeightCollapsed: heightCollapsed,
          logicalHeightExpanded: heightExpanded,
          reactFlowViewRef: { current: { hideDetailConnections, showDetailConnections, focusCard: focusCardRef.current } }, // 传递连接线控制方法和focus方法
          setCardCollapsedStates: setCardCollapsedStates, // 传递设置折叠状态的函数
          onUnifiedRightClick, // 传递统一的右键处理函数
          onMeasureExpandedTitleWidth: (id: string, titleWidth: number) => {
            const STEP = 20;
            const MIN_WIDTH_EXPANDED = 320;
            const MAX_WIDTH_EXPANDED = 480;
            const headerLeftW = 32;
            const bodyPaddingX = 16;
            const cardBorderX = 4;
            const requiredExpandedNodeW = Math.ceil(
              Math.max(MIN_WIDTH_EXPANDED, Math.min(MAX_WIDTH_EXPANDED, titleWidth + headerLeftW + bodyPaddingX + cardBorderX))
              / STEP
            ) * STEP;
            const prevPair = widthCacheRef.current.get(id) || { collapsed: widthCollapsed, expanded: widthExpanded };
            if (requiredExpandedNodeW > (prevPair.expanded || 0)) {
              widthCacheRef.current.set(id, { collapsed: prevPair.collapsed, expanded: requiredExpandedNodeW });
              setWidthCalNonce((v) => v + 1);
            }
          }
        },
        width: computedWidth,
        height: computedHeight,
      };
    });

    // === 基于 TraceStore 生成 trace_result 节点 ===
    const traceNodes: Node[] = [];
    // 只有在延迟时间戳更新后才生成 trace 节点，确保宿主卡片先展开
    const traceDict = delayedTraceTimestamp > 0 ? traceStore.traces : {};

    // 为每个真实卡片计算已经挂在右侧的 trace_result 数量，用于纵向排布
    const traceCountByCard: Record<string, number> = {};

    Object.values(traceDict).forEach((traceNode) => {
      const baseCardId = traceNode.card_id;
      if (!baseCardId) return;

      // 只为存在于当前图中的卡片生成 trace_result
      const hostCard = allCards.find((c: Card) => c.card_id === baseCardId);
      if (!hostCard) return;

      const hostNodeId = hostCard.card_id || `temp_${allCards.indexOf(hostCard)}`;
      const hostCollapsed =
        cardCollapsedStates[hostNodeId] ?? getDefaultCollapsedState(hostCard);

      console.log(`[DEBUG-TRACE] 生成 trace 卡片: hostNodeId=${hostNodeId}, hostCollapsed=${hostCollapsed}, cardCollapsedStates[${hostNodeId}]=${cardCollapsedStates[hostNodeId]}`);

      // 与宿主卡片同步的尺寸/状态
      const hostSizePair = widthCacheRef.current.get(hostNodeId);
      const defaultCollapsedWidth = 180;
      const defaultExpandedWidth = 320;
      const TRACE_WIDTH_COLLAPSED = hostSizePair?.collapsed ?? defaultCollapsedWidth;
      const TRACE_WIDTH_EXPANDED = hostSizePair?.expanded ?? defaultExpandedWidth;
      const TRACE_HEIGHT_COLLAPSED = 48;
      const TRACE_HEIGHT_EXPANDED = 200;
      const traceWidth = hostCollapsed ? TRACE_WIDTH_COLLAPSED : TRACE_WIDTH_EXPANDED;
      const traceHeight = hostCollapsed ? TRACE_HEIGHT_COLLAPSED : TRACE_HEIGHT_EXPANDED;

      // 记录该卡片已有多少个 trace_result
      const indexForThisHost = traceCountByCard[hostNodeId] ?? 0;
      traceCountByCard[hostNodeId] = indexForThisHost + 1;

      const traceSupportContentList = Array.isArray(traceNode.support_content_list)
        ? traceNode.support_content_list
        : [];
      const hostTitle = hostCard.card_content?.card_title || hostCard.card_type || 'Trace Result';
      const hostCardContentClone: CardContent =
        hostCard.card_content ? JSON.parse(JSON.stringify(hostCard.card_content)) : {};
      const traceCardContent: CardContent = {
        ...hostCardContentClone,
        card_title: hostTitle,
        trace_support_content_list: traceSupportContentList,
        trace_host_card_id: hostCard.card_id,
        trace_host_card_type: hostCard.card_type,
        trace_host_card_title: hostTitle,
        trace_host_card_content: hostCardContentClone,
        card_main_content_with_highlight: traceNode.card_main_content_with_highlight, // 存储带高亮的主内容
        card_type_description:
          hostCard.card_content?.card_type_description || hostCard.displayed_card_type || hostCard.card_type,
      };

      // 使用逻辑宽高驱动 CardNode 的外观，但内部展示 trace 信息
      const virtualCard: Card = {
        card_id: `trace_${traceNode.trace_id}`,
        card_type: 'trace_result',
        displayed_card_type: hostCard.displayed_card_type || hostCard.card_type,
        status: 'completed',
        card_content: traceCardContent,
        card_ref: [],
      };

      const nodeId = `trace_${traceNode.trace_id}`;

      traceNodes.push({
        id: nodeId,
        type: 'cardNode',
        position: {
          // 初始位置先简单放在宿主卡片右侧，后续交给 ELK 精细布局
          x: 0,
          y: 0 + indexForThisHost * (traceHeight + 12),
        },
        data: {
          cardId: virtualCard.card_id,
          agentId: currentCardId,
          card: virtualCard,
          isSelectionMode: false,
          isSelectedForAction: false,
          isCollapsed: hostCollapsed,
          onToggleCollapsed: createToggleCollapsed(hostNodeId),
          onShowDetail: (_card: Card, _agentId: string) => {
            handleDirectCardClick(virtualCard, currentCardId);
          },
          currentDetailCardId: selectedCardId,
          isDetailOpen,
          onCloseDetail,
          isHighlighted: false,
          logicalWidthCollapsed: TRACE_WIDTH_COLLAPSED,
          logicalWidthExpanded: TRACE_WIDTH_EXPANDED,
          logicalHeightCollapsed: TRACE_HEIGHT_COLLAPSED,
          logicalHeightExpanded: TRACE_HEIGHT_EXPANDED,
          traceHostNodeId: hostNodeId,
          traceOrder: indexForThisHost,
          reactFlowViewRef: { current: { hideDetailConnections, showDetailConnections, focusCard: focusCardRef.current } }, // 传递连接线控制方法和focus方法
          onUnifiedRightClick, // 传递统一的右键处理函数
        },
        width: traceWidth,
        height: traceHeight,
      });
    });
    
    // 构建边
    const computedEdges: Edge[] = [];
    
    allCards.forEach((card: Card) => {
      const targetNodeId = card.card_id || `temp_${allCards.indexOf(card)}`;
      
      // 处理原有的 card_ref 格式（保持兼容性）
      if (Array.isArray(card.card_ref)) {
        card.card_ref.forEach((ref: any) => {
          // 新格式：ref 包含 card_id
          if (ref.card_id) {
            const sourceCard = allCards.find((c: Card) => c.card_id === ref.card_id);
            
            if (sourceCard) {
              const edge: Edge = {
                id: `e${ref.card_id}-${targetNodeId}`,
                source: ref.card_id,
                target: targetNodeId,
                type: 'freeEdge',
                data: { 
                  referenceType: 'explicit', // 原有格式默认为显式引用
                  selectedCardId: selectedCardId,
                  hoveredToolCard: hoveredToolCard,
                },
              };
              
              computedEdges.push(edge);
            }
          }
        });
      }
      
      // 处理隐式引用 (card_ref_implicit)
      if (Array.isArray(card.card_ref_implicit)) {
        card.card_ref_implicit.forEach((sourceCardId: string) => {
          const sourceCard = allCards.find((c: Card) => c.card_id === sourceCardId);
          
          if (sourceCard) {
            const edge: Edge = {
              id: `e${sourceCardId}-${targetNodeId}-implicit`,
              source: sourceCardId,
              target: targetNodeId,
              type: 'freeEdge',
              data: { 
                referenceType: 'implicit', // 标记为隐式引用
                selectedCardId: selectedCardId,
                hoveredToolCard: hoveredToolCard,
              },
            };
            
            computedEdges.push(edge);
          }
        });
      }
      
      // 处理显式引用 (card_ref_explicit)
      if (Array.isArray(card.card_ref_explicit)) {
        card.card_ref_explicit.forEach((sourceCardId: string) => {
          const sourceCard = allCards.find((c: Card) => c.card_id === sourceCardId);
          
          if (sourceCard) {
            const edge: Edge = {
              id: `e${sourceCardId}-${targetNodeId}-explicit`,
              source: sourceCardId,
              target: targetNodeId,
              type: 'freeEdge',
              data: { 
                referenceType: 'explicit', // 标记为显式引用
                selectedCardId: selectedCardId,
                hoveredToolCard: hoveredToolCard,
              },
            };
            
            computedEdges.push(edge);
          }
        });
      }
    });
    
    // === 基于 TraceStore 的 children 关系生成 trace 卡片之间的连线 ===
    Object.values(traceDict).forEach((traceNode) => {
      const sourceTraceId = traceNode.trace_id;
      const sourceNodeId = `trace_${sourceTraceId}`;
      
      // 检查该 trace 节点是否存在于图中
      const sourceTraceNode = traceNodes.find(n => n.id === sourceNodeId);
      if (!sourceTraceNode) return;
      
      // 遍历 children，为每个子节点创建连线
      if (Array.isArray(traceNode.children)) {
        traceNode.children.forEach((childTraceId: number) => {
          const targetNodeId = `trace_${childTraceId}`;
          
          // 检查子 trace 节点是否存在于图中
          const targetTraceNode = traceNodes.find(n => n.id === targetNodeId);
          if (!targetTraceNode) return;
          
          // 创建 trace 连线
          const traceEdge: Edge = {
            id: `trace_${sourceTraceId}-${childTraceId}`,
            source: sourceNodeId,
            target: targetNodeId,
            type: 'freeEdge',
            data: {
              isTraceEdge: true, // 标记为 trace 连线
              selectedCardId: selectedCardId,
              hoveredToolCard: hoveredToolCard,
            },
          };
          
          computedEdges.push(traceEdge);
        });
      }
    });
    
    // console.log('[DEBUG] 初始计算完成 - 节点数量:', initialNodes.length, '边数量:', computedEdges.length);
    // console.log('[DEBUG] 节点IDs:', initialNodes.map(n => n.id));
    
    const allNodes = [...initialNodes, ...traceNodes];

    return { baseNodes: initialNodes, traceNodes, edges: computedEdges };
  }, [
    handleDirectCardClick,
    handleCardSwitch,
    lastUpdateTimestamp,
    traceLastUpdateTimestamp,
    delayedTraceTimestamp,  // 新增：控制 trace 卡片生成的延迟时间戳
    cardCollapsedStates,
    createToggleCollapsed,
    currentCardId,
    selectedCardId,
    isDetailOpen,
    onCloseDetail,
    hoveredToolCard,
    isSelectionMode,
    selectedCardsForAction,
    widthCalNonce,
    hideDetailConnections,
    showDetailConnections,
  ]);

  // 使用计算出的节点和边
  const [nodes, setNodes, onNodesChange] = useNodesState([
    ...computedGraph.baseNodes,
    ...computedGraph.traceNodes,
  ]);
  const [edges, setEdges, onEdgesChange] = useEdgesState(computedGraph.edges);

  const positionTraceNodes = useCallback((layoutedBaseNodes: Node[], traceNodes: Node[]) => {
    if (!traceNodes.length) {
      return layoutedBaseNodes;
    }

    const hostMap = new Map(layoutedBaseNodes.map((node) => [node.id, node]));
    const GAP_X = 32;

    const getNodeWidth = (node: Node) => {
      return (
        (node.style as any)?.width ??
        (node as any).width ??
        (node.data as any)?.logicalWidthCollapsed ??
        (node.data as any)?.logicalWidthExpanded ??
        320
      );
    };

    const getTraceId = (node: Node) => {
      const rawId =
        (node.data as any)?.card?.card_id ??
        node.id ??
        '';
      const numeric = parseInt(String(rawId).replace(/^trace_/, ''), 10);
      return Number.isFinite(numeric) ? numeric : 0;
    };

    const positionedTraceNodes: Node[] = [];
    const hostToTraceNodes = new Map<string, Node[]>();

    // 先按宿主卡片分组
    traceNodes.forEach((traceNode) => {
      const hostId = (traceNode.data as any)?.traceHostNodeId;
      if (!hostId) return;
      const group = hostToTraceNodes.get(hostId);
      if (group) {
        group.push(traceNode);
      } else {
        hostToTraceNodes.set(hostId, [traceNode]);
      }
    });

    // 每个宿主卡片内部：按 trace_id 从小到大，从左到右排列
    hostToTraceNodes.forEach((group, hostId) => {
      const hostNode = hostMap.get(hostId);
      if (!hostNode) return;

      const hostWidth = getNodeWidth(hostNode);
      const sortedGroup = [...group].sort((a, b) => getTraceId(a) - getTraceId(b));

      sortedGroup.forEach((traceNode, index) => {
        const traceWidth = getNodeWidth(traceNode);

        const x = hostNode.position.x + hostWidth + GAP_X + index * (traceWidth + GAP_X);
        const y = hostNode.position.y;

        positionedTraceNodes.push({
          ...traceNode,
          position: { x, y },
          data: {
            ...traceNode.data,
            traceHostNodeId: hostId,
            traceOrder: index,
          },
        });
      });
    });

    return [...layoutedBaseNodes, ...positionedTraceNodes];
  }, []);

  // hover 高亮需要即时同步到已有节点，避免等待动画结束
  useEffect(() => {
    setNodes(prevNodes => {
      if (prevNodes.length === 0) return prevNodes;

      let hasChanges = false;
      const nextNodes = prevNodes.map(node => {
        const nextHighlight = highlightCardId === node.id;
        if (node.data?.isHighlighted === nextHighlight) {
          return node;
        }

        hasChanges = true;
        return {
          ...node,
          data: {
            ...node.data,
            isHighlighted: nextHighlight,
          },
        };
      });

      return hasChanges ? nextNodes : prevNodes;
    });
  }, [highlightCardId, setNodes]);

  // hover 高亮需要即时同步到已有边，避免等待 useMemo 重新计算
  useEffect(() => {
    setEdges(prevEdges => {
      if (prevEdges.length === 0) return prevEdges;

      let hasChanges = false;
      const nextEdges = prevEdges.map(edge => {
        const currentSelectedCardId = edge.data?.selectedCardId;
        const currentHoveredToolCard = edge.data?.hoveredToolCard;
        
        // 比较 selectedCardId
        const selectedCardIdChanged = currentSelectedCardId !== selectedCardId;
        
        // 比较 hoveredToolCard（需要深度比较 cardId 和 color）
        const hoveredToolCardChanged = 
          (currentHoveredToolCard?.cardId !== hoveredToolCard?.cardId) ||
          (currentHoveredToolCard?.color !== hoveredToolCard?.color) ||
          ((currentHoveredToolCard === null) !== (hoveredToolCard === null));
        
        // 如果都没有变化，返回原 edge
        if (!selectedCardIdChanged && !hoveredToolCardChanged) {
          return edge;
        }

        hasChanges = true;
        return {
          ...edge,
          data: {
            ...edge.data,
            selectedCardId: selectedCardId,
            hoveredToolCard: hoveredToolCard,
          },
        };
      });

      return hasChanges ? nextEdges : prevEdges;
    });
  }, [selectedCardId, hoveredToolCard, setEdges]);

  // // 修复：当计算数据变化时，同步到 ReactFlow 并更新全局引用
  // useEffect(() => {
  //   setNodes(computedNodesAndEdges.nodes);
  //   setEdges(computedNodesAndEdges.edges);
  //   globalNodesRef = computedNodesAndEdges.nodes;
  // }, [computedNodesAndEdges, setNodes, setEdges]);

  // 集成 ELK 布局（需要在 useEffect 之前声明）
  const { runLayout, runEdgeRoutingOnly, isRunning } = useElkLayout();
  
  // 项目切换时临时禁用过渡动画，保证节点和边直接就位
  const [disableTransition, setDisableTransition] = useState(false);

  // 动画状态管理
  const [isAnimating, setIsAnimating] = useState(false);
  const [pendingLayoutDueToCollapse, setPendingLayoutDueToCollapse] = useState(true);
  // 布局版本号，每次 layout 完成后自增，用于通知外部（例如连接线）重新计算位置
  const [layoutVersion, setLayoutVersion] = useState<number>(0);
  
  // 添加动画类到节点和边缘
  const addAnimationClass = useCallback(() => {
    const nodeElements = document.querySelectorAll('.react-flow__node');
    const edgeElements = document.querySelectorAll('.react-flow__edge');
    
    // 立即为节点添加动画类
    nodeElements.forEach(element => {
      element.classList.add('animating');
    });
    
    // 稍微延迟为边缘添加动画类，让线条跟随节点
    setTimeout(() => {
      edgeElements.forEach(element => {
        element.classList.add('animating');
      });
      // Debug: log when animation classes are added
    }, 30);
  }, []);
  
  // 仅为边缘添加动画类（用于尺寸变化但不做节点位置动画的场景）
  const addEdgeAnimationClass = useCallback(() => {
    // 使用轻微延迟，确保布局更新后的新边也被选中
    setTimeout(() => {
      const edgeElements = document.querySelectorAll('.react-flow__edge');
      edgeElements.forEach(element => {
        element.classList.add('animating');
      });
    }, 50);
  }, []);
  
  // 移除动画类
  const removeAnimationClass = useCallback(() => {
    const nodeElements = document.querySelectorAll('.react-flow__node');
    const edgeElements = document.querySelectorAll('.react-flow__edge');
    
    nodeElements.forEach(element => {
      element.classList.remove('animating');
    });
    
    edgeElements.forEach(element => {
      element.classList.remove('animating');
    });
    // Debug: log when animation classes are removed
  }, []);

  // 仅移除边缘的动画类
  const removeEdgeAnimationClass = useCallback(() => {
    const edgeElements = document.querySelectorAll('.react-flow__edge');
    edgeElements.forEach(element => {
      element.classList.remove('animating');
    });
  }, []);
  

  useEffect(() => {
    if (computedGraph.baseNodes.length === 0) {
      requestAnimationFrame(() => {
        setNodes([]);
        setEdges([]);
      });
      setPendingLayoutDueToCollapse(false);
      return;
    }

    const runLayoutAndUpdate = async () => {
      try {
        // 过滤掉 trace 连线，确保它们不影响 elk 布局
        const edgesForLayout = computedGraph.edges.filter(edge => !(edge.data as any)?.isTraceEdge);
        const layoutedData = await runLayout(computedGraph.baseNodes, edgesForLayout);
        const finalNodes = positionTraceNodes(layoutedData.nodes, computedGraph.traceNodes);
        requestAnimationFrame(() => {
          setNodes(finalNodes);
          // 设置所有边（包括 trace 连线），trace 连线不会影响布局但会显示
          setEdges(computedGraph.edges);
          // 布局已完成，增加版本号
          setLayoutVersion((v) => v + 1);
        });
        if (pendingLayoutDueToCollapse && !disableTransition) {
          addEdgeAnimationClass();
          setTimeout(() => {
            removeEdgeAnimationClass();
          }, 400);
        }
      } catch (error) {
        const fallbackNodes = computedGraph.baseNodes.map((node, index) => ({
          ...node,
          position: {
            x: 100 + (index % 3) * 320,
            y: 100 + Math.floor(index / 3) * 220
          }
        }));
        const finalFallbackNodes = positionTraceNodes(fallbackNodes, computedGraph.traceNodes);
        requestAnimationFrame(() => {
          setNodes(finalFallbackNodes);
          setEdges(computedGraph.edges);
          // 布局已完成（fallback）
          setLayoutVersion((v) => v + 1);
        });
      } finally {
        setPendingLayoutDueToCollapse(false);
      }
    };
    // Debug: log when layout effect triggers and a fingerprint of computedGraph
    try {
      const nodeIdsSample = computedGraph.baseNodes.map(n => n.id).slice(0, 10).join(',');
    } catch (e) {}
    let layoutTimer: NodeJS.Timeout | null = null;
    const scheduleLayout = () => {
      if (layoutTimer) {
        clearTimeout(layoutTimer);
      }
      layoutTimer = setTimeout(() => {
        runLayoutAndUpdate();
        layoutTimer = null;
      }, 100);
    };
    scheduleLayout();
    return () => {
      if (layoutTimer) {
        clearTimeout(layoutTimer);
      }
    };
  }, [computedGraph, runLayout, positionTraceNodes, disableTransition, addEdgeAnimationClass, removeEdgeAnimationClass, pendingLayoutDueToCollapse]);

  // 项目切换时重置图状态并清空位置缓存，避免旧数据影响新项目
  useEffect(() => {
    // 禁用一次过渡动画（让新项目的节点和边直接就位）
    setDisableTransition(true);
    setNodes([]);setEdges([]);
    // 清理动画状态
    removeAnimationClass();
    removeEdgeAnimationClass();
    setIsAnimating(false);
    setViewMode('auto');
  }, [historyStore.currentProjectId, setEdges, setNodes]);

  // 在节点和边更新完成后，恢复过渡动画
  useEffect(() => {
    if (disableTransition && nodes.length > 0) {
      // 等下一个渲染周期后再恢复，确保本次位置生效不触发动画
      const timer = setTimeout(() => {
        setDisableTransition(false);
      }, 600);
      return () => clearTimeout(timer);
    }
  }, [disableTransition, nodes.length]);
  // 处理连接创建
  
  const onConnect = useCallback((params: Connection) => {
    // 确保有源节点和目标节点
    if (params.source && params.target) {
      // console.log('[DEBUG] 创建连接:', params.source, '->', params.target);
      
      // 检查源卡片不能是 creating 状态
      const sourceCard = cardStore.getCard(params.source);
      // 新格式中没有 card_status，暂时跳过状态检查
      // if (!sourceCard || sourceCard.card_status === 'creating') {
      if (!sourceCard) {
        // console.log('[DEBUG] 连接被拒绝: 源卡片不存在');
        return; // 如果源卡片不存在，拒绝连接
      }
      
      // 检查目标卡片是否存在
      const targetCard = cardStore.getCard(params.target);
      // 新格式中没有 card_status，暂时跳过状态检查
      // if (!targetCard || targetCard.card_status !== 'creating') {
      if (!targetCard) {
        // console.log('[DEBUG] 连接被拒绝: 目标卡片不存在');
        return; // 如果目标卡片不存在，拒绝连接
      }
      
      // 在CardStore中添加连接关系 - 目标卡片引用源卡片
      const connectionAdded = cardStore.addCardConnection(params.source, params.target);
      
      if (connectionAdded) {
        // 如果成功添加了连接，更新边缘状态
        const sourceCard = cardStore.getCard(params.source);
        const targetCard = cardStore.getCard(params.target);
        
        if (sourceCard && targetCard) {
          // 新格式中没有 card_status，暂时设为 false
          const isCreating = false;
          
          const edgeStyle = {
            stroke: isCreating ? '#0891B2' : '#94a3b8',
            strokeDasharray: '5,5',
          };
          
          const newEdge: Edge = {
            id: `e${params.source}-${params.target}`,
            source: params.source,
            target: params.target,
            sourceHandle: params.sourceHandle,
            targetHandle: params.targetHandle,
            type: 'freeEdge',
          };
          
          setEdges((eds) => [...eds, newEdge]);
        }
      }
    }
  }, []);
  
  // 处理边缘删除
  const onEdgesDelete = useCallback((edgesToDelete: Edge[]) => {
    edgesToDelete.forEach(edge => {
      if (edge.source && edge.target) {
        // 保持source和target的顺序与addCardConnection一致
        cardStore.removeCardConnection(edge.source, edge.target);
      }
    });
  }, []);

  // 保持全局节点引用与本地状态同步，确保自定义边计算正确
  useEffect(() => {
    globalNodesRef = [...nodes];
  }, [nodes]);

  // 简化的节点变化处理函数（禁用拖拽后不再需要处理拖拽相关逻辑）
  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes);
  }, [onNodesChange]);
  
  // 保存ReactFlow实例的引用
  const reactFlowInstance = useRef<ReactFlowInstance | null>(null);

  // 辅助函数：执行平滑的视口动画
  const animateToNode = useCallback((node: Node) => {
    if (!reactFlowInstance.current) return;
    
    // 获取当前视口状态
    const currentViewport = reactFlowInstance.current.getViewport();
    const container = containerRef.current || document.querySelector('.reactflow-container');
    const containerRect = container ? container.getBoundingClientRect() : { width: 800, height: 600 };
    const viewW = containerRect.width;
    const viewH = containerRect.height;
    
    // 计算目标节点的位置和尺寸
    const nodeWidth = (node.width as number) || 320;
    const nodeHeight = (node.height as number) || 200;
    const nodeX = node.position.x;
    const nodeY = node.position.y;
    
    // 计算目标视口（将节点居中，使用固定缩放比例 1.0，与 auto 模式一致）
    const FIXED_ZOOM = 1.0;
    
    // 计算目标位置（节点居中）
    const targetX = (viewW / 2) / FIXED_ZOOM - (nodeX + nodeWidth / 2);
    const targetY = (viewH / 2) / FIXED_ZOOM - (nodeY + nodeHeight / 2);
    
    // 使用平滑动画过渡到目标视口
    const duration = 500; // 动画持续时间（毫秒）
    const startTime = Date.now();
    const startX = currentViewport.x;
    const startY = currentViewport.y;
    const startZoom = currentViewport.zoom;
    
    // 缓动函数（ease-out cubic）
    const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
    
    const animate = () => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const easedProgress = easeOutCubic(progress);
      
      const currentX = startX + (targetX - startX) * easedProgress;
      const currentY = startY + (targetY - startY) * easedProgress;
      const currentZoom = startZoom + (FIXED_ZOOM - startZoom) * easedProgress;
      
      if (reactFlowInstance.current) {
        reactFlowInstance.current.setViewport({ x: currentX, y: currentY, zoom: currentZoom });
      }
      
      if (progress < 1) {
        requestAnimationFrame(animate);
      }
    };
    
    requestAnimationFrame(animate);
  }, []);

  // 聚焦到指定卡片的方法
  const focusCard = useCallback((cardId: string, skipModeSwitch: boolean = false) => {
    // 立即检查当前状态，不要延迟
      if (reactFlowInstance.current) {
        // 只有在用户主动调用时才切换到 manual 模式
        if (viewMode === 'auto' && !skipModeSwitch) {
          setViewMode('manual');
        }

      // 直接从ReactFlow实例获取节点，而不是依赖state
      const reactFlowNodes = reactFlowInstance.current.getNodes();
      const targetNode = reactFlowNodes.find(n => n.id === cardId);

        if (targetNode) {
          // 总是执行动画，将卡片移到中间
          animateToNode(targetNode);
        } else {
        // 等待一小段时间后重试一次
          setTimeout(() => {
          const retryNodes = reactFlowInstance.current?.getNodes() || [];
          const retryNode = retryNodes.find(n => n.id === cardId);
              if (retryNode) {
                animateToNode(retryNode);
              }
        }, 200);
            }
        }
  }, [viewMode, animateToNode]);

  // useImperativeHandle 将在 performAutoView 定义之后设置，避免在赋值前引用

  // 跟踪是否正在创建连接
  const [isConnecting, setIsConnecting] = useState(false);
  
  // Debug: log state changes relevant to auto button disabled state (placed after isConnecting declaration)
  useEffect(() => {}, [isRunning, isAnimating, isConnecting]);
  
  // 监听连接开始和结束
  const onConnectStart = useCallback(() => {
    setIsConnecting(true);
  }, []);

  // 注意：已移除对layout:interrupt事件的监听

  const onConnectEnd = useCallback(() => {
    setIsConnecting(false);
  }, []);
  
  // 清空 traceStore 中的所有溯源记录
  const handleClearTraces = useCallback(() => {
    traceStore.clearTraces();
    // 清空已记录的 trace 展开状态，以便下次重新开始
    setExpandedTraceHosts(new Set());
  }, []);
  
  
  // 处理节点点击事件
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    // 移除了卡片创建和引用选择功能
    // 用户交互切换到 Manual 模式
    if (viewMode === 'auto') {
      setViewMode('manual');
    }
  }, [viewMode]);
  
  // 处理画布点击事件
  const onPaneClick = useCallback((event: React.MouseEvent) => {
    // 不再通过点击创建卡片
    if (viewMode === 'auto') {
      setViewMode('manual');
    }
  }, [viewMode]);

  // 自动布局功能已移除，auto 模式现在只用于标识模式，不执行自动布局
  const handleAutoControl = useCallback(async () => {
    // 先隐藏工具连接线（如果存在）
    if (onHideToolConnection) {
      onHideToolConnection();
    }
    
    // 找到最新的能够展开的卡片（从后往前查找第一个非in_progress状态的卡片）
    const allCards = cardStore.cardList;
    if (allCards.length > 0) {
      // 从最后一个卡片开始向前查找第一个能够展开的卡片（状态不是in_progress）
      let targetCard: Card | null = null;
      for (let i = allCards.length - 1; i >= 0; i--) {
        const card = allCards[i];
        if (card.status !== 'in_progress') {
          targetCard = card;
          break;
        }
      }

      if (targetCard && targetCard.card_id) {
        const targetCardId = targetCard.card_id; // 确保不为null

        // 找到能够展开的卡片，聚焦到它
        focusCard(targetCardId, true);

        // 等待聚焦动画开始，然后展开卡片
        setTimeout(async () => {
          try {
            // 尝试展开卡片（如果它是折叠的）
            const expanded = await expandCard(targetCardId);

            if (expanded) {
              // 只有成功展开卡片（或本来就是展开状态），才打开detailView
        setTimeout(() => {
                // 打开detailView
                if (handleDirectCardClick && targetCard) {
                  handleDirectCardClick(targetCard, currentCardId);
                }

                // 最后切换到 auto 模式
          setViewMode('auto');
              }, 400); // 等待展开动画完成
            } else {
              // 如果无法展开，直接切换到 auto 模式
              setViewMode('auto');
            }
          } catch (error) {
            // 如果出错，直接切换到 auto 模式
            setViewMode('auto');
          }
        }, 50);
      } else {
        // 如果没有找到能够展开的卡片（所有卡片都在in_progress），直接切换到 auto 模式
        setViewMode('auto');
      }
    } else {
      // 如果没有卡片，直接切换到 auto 模式
      setViewMode('auto');
    }
  }, [focusCard, expandCard, handleDirectCardClick, currentCardId, onHideToolConnection]);

  // 使用 useImperativeHandle 暴露方法给父组件
  useImperativeHandle(ref, () => ({
    focusCard,
    expandCard,
    collapseCard,
    getViewMode,
    hideConnections,
    showConnections,
    hideDetailConnections,
    showDetailConnections,
    getCardCollapsedState: (cardId: string) => cardCollapsedStates[cardId] ?? false,
    startAutoLayout: () => {
      // 自动布局功能已移除，只切换到 auto 模式
      setViewMode('auto');
    }
  }), [expandCard, collapseCard, focusCard, getViewMode, hideConnections, showConnections, hideDetailConnections, showDetailConnections, cardCollapsedStates]);

  // 将focusCard设置到ref中，以便在useMemo中使用
  useEffect(() => {
    focusCardRef.current = focusCard;
  }, [focusCard]);

  // 监听用户交互事件来切换到 manual 模式（缩放/平移/滚动/指针）
  useEffect(() => {
    const container = containerRef.current || document.querySelector('.reactflow-container');
    if (!container) return;

    const onWheel = () => {
      if (viewMode === 'auto') {
        setViewMode('manual');
      }
    };

    const toManual = () => {
      if (viewMode === 'auto') {
        setViewMode('manual');
      }
    };

    container.addEventListener('wheel', onWheel, { passive: true });
    container.addEventListener('pointerdown', toManual);
    container.addEventListener('mousedown', toManual);
    container.addEventListener('touchstart', toManual, { passive: true });

    return () => {
      container.removeEventListener('wheel', onWheel as EventListener);
      container.removeEventListener('pointerdown', toManual as EventListener);
      container.removeEventListener('mousedown', toManual as EventListener);
      container.removeEventListener('touchstart', toManual as EventListener);
    };
  }, [viewMode]);

  // 追踪容器尺寸用于连接层定位
  const [containerRect, setContainerRect] = useState<DOMRect | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const updateRect = () => {
      setContainerRect(el.getBoundingClientRect());
    };
    updateRect();
    const ro = new ResizeObserver(() => updateRect());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={`reactflow-container ${disableTransition ? 'no-transition' : ''}`}
      style={{ position: 'relative' }}
    >
      {/* 连接层：在背景之上、节点之下 */}
      {detailConnectionOpen && (
        <CardDetailConnection
          cardId={detailConnectionCardId || null}
          cardType={detailConnectionCardType || null}
          isDetailOpen={detailConnectionOpen}
          containerRect={containerRect}
          layoutVersion={layoutVersion}
          isVisible={connectionsVisible && detailConnectionsVisible}
        />
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        style={{ position: 'relative', zIndex: 1 }}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgesDelete={onEdgesDelete}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onPaneClick={onPaneClick}
        onNodeClick={onNodeClick}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
        // 禁用节点拖拽
        nodesDraggable={false}
        // 禁用双击放大，避免与卡片双击冲突
        zoomOnDoubleClick={false}
        // 拖拽交互由 onNodesChange 处理
        onInit={(instance) => {
          reactFlowInstance.current = instance;
        }}
        minZoom={0.05}
        fitView
        className="reactflow-wrapper"
        connectOnClick={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background />
        <Controls showInteractive={false}>
          <ControlButton
            onClick={handleAutoControl}
            disabled={isRunning || isAnimating || isConnecting}
          >
            <img src={viewMode === 'auto' ? "/resource/auto_bright.svg" : "/resource/auto.svg"} alt="auto layout" />
          </ControlButton>
          <ControlButton
            onClick={handleClearTraces}
            title="清空溯源结果"
          >
            <img src="/resource/dustbin.svg" alt="clear traces" style={{ width: '14px', height: '14px' }} />
          </ControlButton>
        </Controls>
      </ReactFlow>

      {/* 工具消息连接线 */}
      {detailConnectionOpen && detailConnectionCardId && (
        <ToolMessageConnection
          cardId={detailConnectionCardId}
          isDetailOpen={detailConnectionOpen}
          layoutVersion={layoutVersion}
          isVisible={connectionsVisible && detailConnectionsVisible}
          onConnectionCalculated={onConnectionCalculated}
        />
      )}
    </div>
  );
}));

ReactFlowView.displayName = 'ReactFlowView';

export default ReactFlowView;