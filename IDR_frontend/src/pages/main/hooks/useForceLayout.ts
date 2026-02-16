import * as d3 from 'd3';
import { useRef, useState, useCallback } from 'react';
import { Node, Edge } from 'reactflow';

// ForceLayoutParams 类型定义
export interface ForceLayoutParams {
  chargeStrength: number;
  linkDistance: number;
  linkStrength: number;
  centerStrength: number;
  collisionRadius: number;
  alphaDecay: number;
  velocityDecay: number;
  chargeDistanceMin?: number;  // 电荷力最小作用距离
  chargeDistanceMax?: number;  // 电荷力最大作用距离
}

// 扩展Node类型以支持D3 simulation
interface SimulationNode extends Node {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

/**
 * Custom hook for D3 force layout integration with ReactFlow
 * 提供自动布局功能，使用D3的力导向算法
 */
export const useForceLayout = () => {
  const simulationRef = useRef<d3.Simulation<SimulationNode, undefined> | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  
  // 优化的力导向布局参数设置
  // 确保布局稳定且节点不重叠
  const [currentParams, setCurrentParams] = useState<ForceLayoutParams>({
    chargeStrength: -300,    // 排斥力：适中大小，避免过大导致抽搐
    linkDistance: 300,       // 连接距离：适中值，为卡片提供足够空间
    linkStrength: 0.8,       // 连接强度：较低值，提高布局稳定性
    centerStrength: 0.5,     // 中心力：较弱值，避免与其他力冲突
    collisionRadius: 220,    // 碰撞半径：合理值，防止节点重叠
    alphaDecay: 0.1,         // 衰减率：较快值，帮助系统更快稳定
    velocityDecay: 0.9,      // 速度衰减：较高值，有效减少抖动
    chargeDistanceMin: 200,  // 电荷力最小作用距离
    chargeDistanceMax: 600,  // 电荷力最大作用距离
  });

  /**
   * 矩形碰撞检测力 - 增强版
   * 确保所有卡片都不重叠，实现精确的碰撞体积计算
   */
  const rectangularCollisionForce = (collisionRadius: number) => {
    let nodes: SimulationNode[];
    
    function force() {
      for (let i = 0; i < nodes.length; i++) {
        const nodeA = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const nodeB = nodes[j];
          
          if (nodeA.x !== undefined && nodeA.y !== undefined && 
              nodeB.x !== undefined && nodeB.y !== undefined) {
            const nodeAWidth = nodeA.width || 280;
            const nodeAHeight = nodeA.height || 200;
            const nodeBWidth = nodeB.width || 280;
            const nodeBHeight = nodeB.height || 200;
            
            // 计算两个矩形之间的向量
            const dx = nodeA.x - nodeB.x;
            const dy = nodeA.y - nodeB.y;
            
            // 计算矩形碰撞的边界 - 包含碰撞半径作为额外间距
            const halfWidthA = nodeAWidth / 2 + collisionRadius;
            const halfHeightA = nodeAHeight / 2 + collisionRadius;
            const halfWidthB = nodeBWidth / 2 + collisionRadius;
            const halfHeightB = nodeBHeight / 2 + collisionRadius;
            
            // 计算两个矩形之间的距离阈值
            const minDistanceX = halfWidthA + halfWidthB;
            const minDistanceY = halfHeightA + halfHeightB;
            
            // 检查是否发生碰撞
            if (Math.abs(dx) < minDistanceX && Math.abs(dy) < minDistanceY) {
              // 计算实际距离
              const distance = Math.sqrt(dx * dx + dy * dy);
              
              // 计算重叠量
              const overlapX = minDistanceX - Math.abs(dx);
              const overlapY = minDistanceY - Math.abs(dy);
              const overlap = Math.max(overlapX, overlapY);
              
              // 确保在距离为0时有一个很小的非零值，避免除以零
              const safeDistance = Math.max(distance, 0.001);
              
              // 计算排斥力大小和方向
              const forceStrength = (overlap * 0.3) / (safeDistance * 0.5);
              const unitX = dx / safeDistance;
              const unitY = dy / safeDistance;
              const fx = unitX * forceStrength;
              const fy = unitY * forceStrength;
              
              // 应用力到节点速度上
              nodeA.vx = (nodeA.vx || 0) + fx;
              nodeA.vy = (nodeA.vy || 0) + fy;
              nodeB.vx = (nodeB.vx || 0) - fx;
              nodeB.vy = (nodeB.vy || 0) - fy;
              
              // 对于非常严重重叠的卡片，直接调整位置
              if (distance < Math.max(minDistanceX, minDistanceY) * 0.5) {
                const moveDistance = (Math.max(minDistanceX, minDistanceY) - distance) * 0.5;
                nodeA.x! += unitX * moveDistance;
                nodeA.y! += unitY * moveDistance;
                nodeB.x! -= unitX * moveDistance;
                nodeB.y! -= unitY * moveDistance;
              }
            }
          }
        }
      }
    }
    
    force.initialize = (newNodes: SimulationNode[]) => {
      nodes = newNodes;
    };
    
    return force;
  };

  // 添加节点更新回调函数的引用
  const onNodesUpdateRef = useRef<((nodes: Node[]) => void) | null>(null);
  
  /**
   * 设置节点更新回调函数
   */
  const setOnNodesUpdate = useCallback((callback: ((nodes: Node[]) => void) | null) => {
    onNodesUpdateRef.current = callback;
  }, []);
  
  /**
   * 启动力导向布局
   */
  const runLayout = useCallback((nodes: Node[], edges: Edge[], params?: Partial<ForceLayoutParams>) => {
    if (!nodes.length) {
      return Promise.resolve({ nodes });
    }
    
    // 更新参数
    if (params) {
      setCurrentParams((prev) => ({ ...prev, ...params }));
    }
    
    // 停止之前的simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }
    
    // 将ReactFlow节点转换为D3 simulation节点，重置到中心位置
    const centerX = 400;
    const centerY = 300;
    const simulationNodes: SimulationNode[] = nodes.map((node) => ({
      ...node,
      x: node.position?.x ?? centerX + (Math.random() - 0.5) * 200, // 在中心附近随机分布
      y: node.position?.y ?? centerY + (Math.random() - 0.5) * 300,
    }));
    
    // 创建新的力导向仿真，使用当前配置参数
    const simulation = d3
      .forceSimulation(simulationNodes)
      // 连接力：控制相连节点之间的距离和强度
      .force(
        'link',
        d3
          .forceLink(edges as any)
          .id((d: any) => d.id)
          .distance(currentParams.linkDistance)
          .strength(currentParams.linkStrength)
      )
      // 中心力：将节点拉向布局中心
      .force('center', d3.forceCenter(centerX, centerY).strength(currentParams.centerStrength))
      // 电荷力：控制节点之间的排斥力，并设置作用距离范围
      .force('charge', d3.forceManyBody()
        .strength(currentParams.chargeStrength)
        .distanceMin(currentParams.chargeDistanceMin || 200)
        .distanceMax(currentParams.chargeDistanceMax || 600))
      // X轴定位力：轻微将节点拉向水平中心
      .force('x', d3.forceX(centerX).strength(0.1))
      // Y轴定位力：轻微将节点拉向垂直中心
      .force('y', d3.forceY(centerY).strength(0.1))
      // 圆形碰撞力：防止节点重叠
      .force('collide', d3.forceCollide<SimulationNode>(currentParams.collisionRadius).strength(0.7))
      .alphaDecay(currentParams.alphaDecay)
      .velocityDecay(currentParams.velocityDecay);
      
    simulationRef.current = simulation;
    setIsRunning(true);
    
    // 添加tick事件监听器，在拖拽时更新节点位置
    let lastUpdate = 0;
    simulation.on('tick', () => {
      const now = performance.now();
      if (now - lastUpdate < 15) return; // 限制更新频率，避免性能问题
      lastUpdate = now;
      
      // 计算当前的节点位置
      const updatedNodes = nodes.map((node) => {
        const simulationNode = simulation.nodes().find((n: SimulationNode) => n.id === node.id);
        if (simulationNode && simulationNode.x !== undefined && simulationNode.y !== undefined) {
          return {
            ...node,
            position: {
              x: simulationNode.x - (node.width || 280) / 2,
              y: simulationNode.y - (node.height || 200) / 2,
            },
          };
        }
        return node;
      });
      
      // 调用回调函数更新节点位置
      if (onNodesUpdateRef.current) {
        onNodesUpdateRef.current(updatedNodes);
      }
    });
    
    // 启动simulation
    simulation.restart();
    
    
    
    // 等待布局完成并返回结果
    return new Promise<{ nodes: Node[] }>((resolve) => {
      simulation.on('end', () => {
        // 计算最终的节点位置
        const layoutedNodes = nodes.map((node) => {
          const simulationNode = simulation.nodes().find((n: SimulationNode) => n.id === node.id);
          if (simulationNode && simulationNode.x !== undefined && simulationNode.y !== undefined) {
            return {
              ...node,
              position: {
                x: simulationNode.x - (node.width || 280) / 2,
                y: simulationNode.y - (node.height || 200) / 2,
              },
            };
          }
          return node;
        });
        
        setIsRunning(false);
        resolve({ nodes: layoutedNodes });
      });
    });
  }, [currentParams]);

  /**
   * 更新布局参数（实时调整）
   * 允许在布局运行过程中动态修改力参数
   */
  const updateParameters = useCallback((params: ForceLayoutParams) => {
    setCurrentParams(params);
    
    if (simulationRef.current) {
      // 更新现有simulation的参数
      simulationRef.current
        .force('charge', d3.forceManyBody().strength(params.chargeStrength))
        .force('center', d3.forceCenter(400, 300).strength(params.centerStrength))
        .force('collision', rectangularCollisionForce(params.collisionRadius))
        .alphaDecay(params.alphaDecay)
        .velocityDecay(params.velocityDecay);
      
      // 更新连接力参数
      const linkForce = simulationRef.current.force('link') as d3.ForceLink<SimulationNode, any>;
      if (linkForce) {
        linkForce.distance(params.linkDistance).strength(params.linkStrength);
      }
      
      // 重新加热simulation以应用新参数
      if (simulationRef.current.alpha() < 0.1) {
        simulationRef.current.alpha(0.05).restart();
      }
    }
  }, []);

  /**
   * 停止力导向布局
   */
  const stopLayout = useCallback(() => {
    if (simulationRef.current) {
      simulationRef.current.stop();
      simulationRef.current = null;
    }
    setIsRunning(false);
  }, []);

  // 处理节点拖拽开始
  const handleNodeDrag = useCallback((nodeId: string, position: { x: number, y: number }) => {
    if (!simulationRef.current) return;
    
    const simulationNodes = simulationRef.current.nodes() as SimulationNode[];
    const node = simulationNodes.find(n => n.id === nodeId);
    
    if (node) {
      // 设置固定位置
      node.fx = position.x + (node.width || 280) / 2;
      node.fy = position.y + (node.height || 200) / 2;
      
      // 使用较大的alpha值，使拖拽时的动画更流畅
      simulationRef.current.alpha(0.3).restart();
    }
  }, []);

  // 处理节点拖拽结束
  const handleNodeDragStop = useCallback((nodeId: string) => {
    if (!simulationRef.current) return;
    
    const simulationNodes = simulationRef.current.nodes() as SimulationNode[];
    const node = simulationNodes.find(n => n.id === nodeId);
    
    if (node) {
      // 解除固定位置
      node.fx = null;
      node.fy = null;
      
      // 拖拽结束后使用小的alpha值重启模拟，使节点能够平滑地回到平衡位置
      simulationRef.current.alpha(0.1).restart();
    }
  }, []);

  return {
    runLayout,
    stopLayout,
    updateParameters,
    handleNodeDrag,
    handleNodeDragStop,
    setOnNodesUpdate,
    isRunning,
    currentParams,
  };
};