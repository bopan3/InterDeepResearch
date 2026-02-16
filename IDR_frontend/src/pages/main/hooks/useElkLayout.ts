import { useCallback, useState } from 'react';
import { Node, Edge, Position } from 'reactflow';
import ELK, { ElkNode, ElkExtendedEdge, LayoutOptions } from 'elkjs/lib/elk.bundled.js';

const elk = new ELK();

// ELK布局配置 - 优化节点位置和对齐
const elkOptions: LayoutOptions = {
  'elk.algorithm': 'layered',
  'elk.layered.spacing.nodeNodeBetweenLayers': '25', // 减少层间距离降低曲线高度
  'elk.spacing.nodeNode': '100', // 适中的同层节点间距
  'elk.direction': 'DOWN',
  // 节点位置和对齐优化
  'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX', // 使用网络单纯形法优化节点位置
  'elk.alignment': 'CENTER', // 设置节点中心对齐
  'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED', // 平衡对齐策略
  'elk.layered.contentAlignment': 'CENTER', // 内容居中对齐
  // 交叉最小化和分层策略
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.layered.layering.strategy': 'NETWORK_SIMPLEX', // 使用网络单纯形法进行分层
  // 间距配置
  'elk.layered.spacing.edgeNodeBetweenLayers': '30', // 减少边与节点层间距
  'elk.spacing.edgeNode': '180', // 减少边与节点间距
  'elk.spacing.edgeEdge': '30', // 减少边与边间距
  'elk.layered.spacing.edgeSpacing': '10', // 减少边间距
  // 模型顺序和优先级
  'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
  'elk.layered.thoroughness': '8', // 平衡的算法精度
  'elk.layered.priority.shortness': '5', // 提高短路径优先级
  'elk.layered.priority.straightness': '2', // 提高直线优先级使曲线更平缓
  // 端口和边配置
  'elk.portConstraints': 'FIXED_SIDE',
  'elk.layered.mergeEdges': 'false',
  'elk.layered.edgeRouting.selfLoopDistribution': 'EQUALLY'
};

// 位置缓存管理
class PositionCache {
  private cache = new Map<string, { x: number; y: number; width: number; height: number }>();
  
  set(nodeId: string, position: { x: number; y: number; width: number; height: number }) {
    this.cache.set(nodeId, { ...position });
  }
  
  get(nodeId: string) {
    return this.cache.get(nodeId);
  }
  
  has(nodeId: string) {
    return this.cache.has(nodeId);
  }
  
  clear() {
    this.cache.clear();
  }
  
  getAll() {
    return new Map(this.cache);
  }
}

const positionCache = new PositionCache();

// 获取节点尺寸（统一数值来源）
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

// 计算以中上为锚点的位置调整
const calculateCenterTopAnchoredPosition = (
  currentPosition: { x: number; y: number },
  oldDimensions: { width: number; height: number },
  newDimensions: { width: number; height: number }
) => {
  // 计算中上锚点的位置调整
  const deltaX = (oldDimensions.width - newDimensions.width) / 2;
  const deltaY = 0; // Y轴保持不变（中上锚点）
  
  return {
    x: currentPosition.x + deltaX,
    y: currentPosition.y + deltaY
  };
};

// 检查是否需要完全重新布局
const shouldPerformFullRelayout = (
  currentNodes: Node[],
  currentEdges: Edge[],
  prevNodes: Node[],
  prevEdges: Edge[]
): boolean => {
  // 首次布局
  if (prevNodes.length === 0) return true;
  
  // 节点数量变化
  if (currentNodes.length !== prevNodes.length) return true;
  
  // 边数量变化
  if (currentEdges.length !== prevEdges.length) return true;
  
  // 检查节点ID变化
  const currentNodeIds = new Set(currentNodes.map(n => n.id));
  const prevNodeIds = new Set(prevNodes.map(n => n.id));
  
  for (const id of Array.from(currentNodeIds)) {
    if (!prevNodeIds.has(id)) return true;
  }
  
  for (const id of Array.from(prevNodeIds)) {
    if (!currentNodeIds.has(id)) return true;
  }
  
  // 检查边连接变化
  const currentEdgeKeys = new Set(currentEdges.map(e => `${e.source}-${e.target}`));
  const prevEdgeKeys = new Set(prevEdges.map(e => `${e.source}-${e.target}`));
  
  for (const key of Array.from(currentEdgeKeys)) {
    if (!prevEdgeKeys.has(key)) return true;
  }
  
  for (const key of Array.from(prevEdgeKeys)) {
    if (!currentEdgeKeys.has(key)) return true;
  }
  
  return false;
};

// 应用位置缓存进行增量布局
const applyPositionCache = (nodes: Node[]): Node[] => {
  return nodes.map(node => {
    const cachedPosition = positionCache.get(node.id);
    const dimensions = getNodeDimensions(node);
    
    if (cachedPosition) {
      // 如果尺寸发生变化，需要调整位置
      const sizeChanged = 
        cachedPosition.width !== dimensions.width || 
        cachedPosition.height !== dimensions.height;
      
      let adjustedPosition = { x: cachedPosition.x, y: cachedPosition.y };
      
      if (sizeChanged) {
        // 使用中上锚点计算新位置
        adjustedPosition = calculateCenterTopAnchoredPosition(
          { x: cachedPosition.x, y: cachedPosition.y },
          { width: cachedPosition.width, height: cachedPosition.height },
          dimensions
        );
        
        // 更新缓存中的位置和尺寸
        positionCache.set(node.id, {
          x: adjustedPosition.x,
          y: adjustedPosition.y,
          width: dimensions.width,
          height: dimensions.height
        });
      }
      
      return {
         ...node,
         position: adjustedPosition,
         sourcePosition: Position.Bottom,
         targetPosition: Position.Top,
         width: dimensions.width,
         height: dimensions.height,
         style: {
           ...node.style,
           width: dimensions.width,
           height: dimensions.height,
         },
       };
    }
    
    // 新节点，使用默认位置
    const defaultPosition = { x: 0, y: 0 };
    positionCache.set(node.id, {
      x: defaultPosition.x,
      y: defaultPosition.y,
      width: dimensions.width,
      height: dimensions.height
    });
    
    return {
       ...node,
       position: defaultPosition,
       sourcePosition: Position.Bottom,
       targetPosition: Position.Top,
       width: dimensions.width,
       height: dimensions.height,
       style: {
         ...node.style,
         width: dimensions.width,
         height: dimensions.height,
       },
     };
  });
};

export const useElkLayout = () => {
  const [isRunning, setIsRunning] = useState(false);
  
  const runLayout = useCallback(async (
    nodes: Node[],
    edges: Edge[],
    options: { fitView?: boolean; prevNodes?: Node[]; prevEdges?: Edge[] } = {}
  ) => {
    const { prevNodes = [], prevEdges = [] } = options;
    
    if (nodes.length === 0) {
      return { nodes: [], edges };
    }

    setIsRunning(true);

    try {
      // 检查是否需要完全重新布局
      const needsFullRelayout = shouldPerformFullRelayout(nodes, edges, prevNodes, prevEdges);
      
      if (!needsFullRelayout) {
        // 使用增量布局
        const layoutedNodes = applyPositionCache(nodes);
        setIsRunning(false);
        return { nodes: layoutedNodes, edges };
      }

      // 执行完全重新布局
      const elkNodes: ElkNode[] = nodes.map((node) => {
        const dimensions = getNodeDimensions(node);
        return {
          id: node.id,
          width: dimensions.width,
          height: dimensions.height,
        };
      });

      const elkEdges: ElkExtendedEdge[] = edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      }));

      const elkGraph: ElkNode = {
        id: 'root',
        layoutOptions: elkOptions,
        children: elkNodes,
        edges: elkEdges,
      };

      const layoutedGraph = await elk.layout(elkGraph);
      
      const layoutedNodes = nodes.map((node) => {
        const elkNode = layoutedGraph.children?.find((n) => n.id === node.id);
        const dimensions = getNodeDimensions(node);
        
        if (elkNode) {
          let position = { x: elkNode.x || 0, y: elkNode.y || 0 };
          
          // 检查是否有缓存位置，如果有且尺寸发生变化，应用中上锚点调整
          const cachedPosition = positionCache.get(node.id);
          if (cachedPosition) {
            const sizeChanged = 
              cachedPosition.width !== dimensions.width || 
              cachedPosition.height !== dimensions.height;
            
            if (sizeChanged) {
              // 使用中上锚点计算调整后的位置
              position = calculateCenterTopAnchoredPosition(
                { x: cachedPosition.x, y: cachedPosition.y },
                { width: cachedPosition.width, height: cachedPosition.height },
                dimensions
              );
            }
          }
          
          // 更新位置缓存
          positionCache.set(node.id, {
            x: position.x,
            y: position.y,
            width: dimensions.width,
            height: dimensions.height
          });
          
          return {
            ...node,
            position,
            sourcePosition: Position.Bottom,
            targetPosition: Position.Top,
            style: {
              ...node.style,
              width: dimensions.width,
              height: dimensions.height,
            },
          };
        }
        
        return node;
      });

      setIsRunning(false);
      return { nodes: layoutedNodes, edges };
    } catch (error) {
      console.error('ELK layout error:', error);
      setIsRunning(false);
      return { nodes, edges };
    }
  }, []);

  const runEdgeRoutingOnly = useCallback(async (nodes: Node[], edges: Edge[]) => {
    if (nodes.length === 0 || edges.length === 0) {
      return { nodes, edges };
    }

    setIsRunning(true);

    try {
      const elkNodes: ElkNode[] = nodes.map((node) => ({
        id: node.id,
        x: node.position.x,
        y: node.position.y,
        width: node.style?.width as number || getNodeDimensions(node).width,
        height: node.style?.height as number || getNodeDimensions(node).height,
      }));

      const elkEdges: ElkExtendedEdge[] = edges.map((edge) => ({
        id: edge.id,
        sources: [edge.source],
        targets: [edge.target],
      }));

      const elkGraph: ElkNode = {
        id: 'root',
        layoutOptions: {
          ...elkOptions,
          'elk.algorithm': 'fixed',
        },
        children: elkNodes,
        edges: elkEdges,
      };

      const layoutedGraph = await elk.layout(elkGraph);
      
      const layoutedEdges = edges.map((edge) => {
        const elkEdge = layoutedGraph.edges?.find((e) => e.id === edge.id);
        
        return {
          ...edge,
          data: {
            ...(edge.data || {}),
            elkPoints: elkEdge?.sections?.[0]?.bendPoints || [],
          },
        };
      });

      setIsRunning(false);
      return { nodes, edges: layoutedEdges };
    } catch (error) {
      console.error('ELK edge routing error:', error);
      setIsRunning(false);
      return { nodes, edges };
    }
  }, []);

  return {
    runLayout,
    runEdgeRoutingOnly,
    isRunning,
  };
};