import React, { useState, useRef, useEffect, CSSProperties, useMemo } from 'react';
import { Handle, Position, NodeProps } from 'reactflow';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import './CardNode.scss';
import HTMLScreenshot from './HTMLScreenshot';
import CardRefCollapsed from './CardRefCollapsed';
import { chatStore, cardStore } from '../../../stores';
import type { Card, CardReference } from '../../../stores/CardType';

interface CardNodeData {
  cardId: string;
  agentId: string;
  card: Card; // 直接传入完整的 Card 对象
  onShowDetail?: (card: Card, agentId: string) => void; // 详情按钮点击处理函数
  onAgentSwitch?: (targetAgentId: string) => void; // Agent 切换回调函数
  isSelectionMode?: boolean; // 新增：是否处于选择模式
  isSelectedForAction?: boolean; // 新增：是否被选中用于操作
  isCollapsed?: boolean; // 新增：收起状态（外部控制）
  onToggleCollapsed?: () => void; // 新增：切换收起状态的回调
  elkPorts?: { // 新增：ELK计算出的端口位置信息
    input: { x: number; y: number } | null;
    output: { x: number; y: number } | null;
  };
  currentDetailCardId?: string; // 当前 DetailView 展示的卡片 ID
  isDetailOpen?: boolean; // DetailView 是否打开
  onCloseDetail?: () => void; // 关闭 DetailView
  isHighlighted?: boolean;
  reactFlowViewRef?: React.RefObject<any>; // ReactFlowView 的 ref，用于控制连接线显示
  onUnifiedRightClick?: (cardId: string) => void; // 统一的右键处理函数
  setCardCollapsedStates?: React.Dispatch<React.SetStateAction<Record<string, boolean>>>; // 设置卡片折叠状态
}

const TRACE_ACCENT_COLOR = '#FF9900';

// 新增：解析引用标签的函数
const parseCitationTags = (text: string): { processedText: string; citations: Array<{ cardId: string; placeholder: string }>; excerpts: Array<{ content: string; placeholder: string }>; highlights: Array<{ content: string; placeholder: string }> } => {
  const citations: Array<{ cardId: string; placeholder: string }> = [];
  const excerpts: Array<{ content: string; placeholder: string }> = [];
  const highlights: Array<{ content: string; placeholder: string }> = [];
  let processedText = text;
  let citationCounter = 0;
  let excerptCounter = 0;
  let highlightCounter = 0;
  
  // 首先处理 highlight 标记，保留其中的原始 citation 和 excerpt 标记
  // 需要处理 markdown 标记（如 **）与 highlight 嵌套的情况
  // 例如：**<highlight>金牌：** 38枚</highlight> 这种情况
  // 使用递归方法从外到内逐层处理嵌套的 highlight 标签
  const openTag = '<highlight>';
  const closeTag = '</highlight>';
  const selfCloseTag = '<highlight/>';
  
  // 在单个 highlight 内容内部检查并“弹出”最靠近边界的未配平粗体标记
  // 规则：
  // - 统计 highlight 内部的 '**' 个数
  // - 若为偶数：不做处理
  // - 若为奇数：取最左和最右的 '**'，比较它们到内容左右边界的距离
  //   - 更靠近左边界：把这一对 '**' 从内容内删掉，并作为前缀返回（即移动到 <highlight> 外）
  //   - 更靠近右边界：把这一对 '**' 从内容内删掉，并作为后缀返回（即移动到 </highlight> 外）
  const adjustHighlightBold = (
    content: string,
    options: { allowLeft: boolean; allowRight: boolean }
  ): { inner: string; prefix: string; suffix: string } => {
    const { allowLeft, allowRight } = options;
    if (!content.includes('**')) {
      return { inner: content, prefix: '', suffix: '' };
    }

    const positions: number[] = [];
    for (let i = 0; i < content.length - 1; i++) {
      if (content[i] === '*' && content[i + 1] === '*') {
        positions.push(i);
        i++; // 跳过这对星号，避免重叠计数
      }
    }

    if (positions.length === 0 || positions.length % 2 === 0) {
      // 没有粗体标记或数量为偶数，认为已经配平
      return { inner: content, prefix: '', suffix: '' };
    }

    const leftPos = positions[0];
    const rightPos = positions[positions.length - 1];
    const distLeft = leftPos; // 距离内容左边界的距离
    const distRight = Math.max(0, content.length - (rightPos + 2)); // 距离内容右边界的距离

    // 如果某侧不允许弹出，则认为该侧不可用
    const candidates: Array<{ side: 'left' | 'right'; dist: number; pos: number }> = [];
    if (allowLeft) candidates.push({ side: 'left', dist: distLeft, pos: leftPos });
    if (allowRight) candidates.push({ side: 'right', dist: distRight, pos: rightPos });

    if (candidates.length === 0) {
      // 两侧都不允许移动：为避免内部奇数，删除最右侧这对 '**'
      const inner = content.slice(0, rightPos) + content.slice(rightPos + 2);
      return { inner, prefix: '', suffix: '' };
    }

    // 选距离更近的允许侧
    const chosen = candidates.reduce((acc, cur) => (cur.dist < acc.dist ? cur : acc));

    if (chosen.side === 'left') {
      const inner = content.slice(0, chosen.pos) + content.slice(chosen.pos + 2);
      return { inner, prefix: '**', suffix: '' };
    } else {
      const inner = content.slice(0, chosen.pos) + content.slice(chosen.pos + 2);
      return { inner, prefix: '', suffix: '**' };
    }
  };
  
  // 递归函数：找到最外层的 highlight 标签并处理
  const processHighlights = (str: string): string => {
    let result = '';
    let lastIndex = 0;
    let i = 0;
    
    while (i < str.length) {
      // 查找下一个开始标签
      const openIndex = str.indexOf(openTag, i);
      if (openIndex === -1) {
        // 没有更多 highlight 标签，添加剩余文本
        if (lastIndex < str.length) {
          result += str.substring(lastIndex);
        }
        break;
      }

      // 添加开始标签前的文本
      if (openIndex > lastIndex) {
        result += str.substring(lastIndex, openIndex);
      }
      
      // 查找匹配的结束标签（使用栈来处理嵌套）
      const stack: number[] = [openIndex];
      let contentStart = openIndex + openTag.length;
      let foundEnd = false;
      let endIndex = -1;
      let isSelfClose = false;
  
      let j = contentStart;
      while (j < str.length && stack.length > 0) {
        // 检查是否是开始标签
        if (str.substring(j, j + openTag.length) === openTag) {
          stack.push(j);
          j += openTag.length;
          continue;
        }
        
        // 检查是否是自闭合标签
        if (str.substring(j, j + selfCloseTag.length) === selfCloseTag) {
          if (stack.length === 1) {
            // 这是最外层的自闭合标签
            endIndex = j + selfCloseTag.length;
            isSelfClose = true;
            foundEnd = true;
            stack.pop();
            break;
          } else {
            // 内层的自闭合标签，跳过
            stack.pop();
            j += selfCloseTag.length;
            continue;
          }
        }
        
        // 检查是否是结束标签
        if (str.substring(j, j + closeTag.length) === closeTag) {
          stack.pop();
          if (stack.length === 0) {
            // 这是最外层的结束标签
            endIndex = j + closeTag.length;
            foundEnd = true;
            break;
          }
          j += closeTag.length;
          continue;
        }
        
        j++;
    }
      
      if (!foundEnd) {
        // 没有找到匹配的结束标签，当作普通文本处理
        result += str.substring(openIndex);
        break;
      }
      
      // 提取内容（不包括标签）
      const contentEnd = isSelfClose ? endIndex - selfCloseTag.length : endIndex - closeTag.length;
      let content = str.substring(contentStart, contentEnd);
      const hasTightBoldLeft = openIndex >= 2 && str.substring(openIndex - 2, openIndex) === '**';
      const hasTightBoldRight = endIndex + 2 <= str.length && str.substring(endIndex, endIndex + 2) === '**';

      // 递归处理内容（可能包含嵌套的 highlight）
      const processedContent = processHighlights(content);
      
      // 检查递归处理的结果中是否包含占位符（说明有嵌套的 highlight）
      const placeholderPattern = /%%HIGHLIGHT_(\d+)%%/;
      const placeholderMatch = processedContent.match(placeholderPattern);
      
      const placeholder = `%%HIGHLIGHT_${highlightCounter}%%`;
      let actualContent: string;
      
      if (placeholderMatch) {
        // 如果包含占位符，说明有嵌套的 highlight
        // 找到对应的内层 highlight 的内容
        const innerHighlightIndex = parseInt(placeholderMatch[1], 10);
        const innerHighlight = highlights.find(h => h.placeholder === `%%HIGHLIGHT_${innerHighlightIndex}%%`);
        if (innerHighlight) {
          // 使用内层 highlight 的内容作为外层 highlight 的内容
          actualContent = innerHighlight.content;
          // 用外层的占位符替换内层的占位符
          result += processedContent.replace(placeholderPattern, placeholder);
        } else {
          // 如果找不到对应的内层 highlight，使用递归处理的结果（去掉占位符）
          actualContent = processedContent.replace(placeholderPattern, '');
          result += placeholder;
        }
      } else {
        // 没有嵌套的 highlight，直接使用递归处理的结果
        actualContent = processedContent;
        const adjusted = adjustHighlightBold(actualContent, {
          allowLeft: !hasTightBoldLeft && !hasTightBoldRight ? true : !hasTightBoldLeft,
          allowRight: !hasTightBoldLeft && !hasTightBoldRight ? true : !hasTightBoldRight,
        });
        actualContent = adjusted.inner;
        result += `${adjusted.prefix}${placeholder}${adjusted.suffix}`;
      }

      highlights.push({ content: actualContent.trim(), placeholder });
      highlightCounter++;
      
      // 更新 lastIndex 和 i
      lastIndex = endIndex;
      i = endIndex;
    }
    
    return result;
  };
  
  processedText = processHighlights(processedText);
  
  // 然后处理 excerpt 标记，保留其中的原始 citation 标记
  const excerptRegex = /<excerpt>([\s\S]*?)(?:<\/excerpt>|<excerpt\/>)/g;
  
  processedText = processedText.replace(excerptRegex, (match, content) => {
    const placeholder = `%%EXCERPT_${excerptCounter}%%`;
    excerpts.push({ content: content.trim(), placeholder });
    excerptCounter++;
    return placeholder;
  });
  
  // 然后处理 citation 标记（包括在 excerpt 和 highlight 内容中的）
  // 支持格式：
  // <cardId>'cardId'<cardId/>
  // <cardId>'cardId'</cardId>
  // <cardId>'cardId'</cardId/>
  // <cardId>"cardId"<cardId/>
  // <cardId>"cardId"</cardId>
  // <cardId>"cardId"</cardId/>
  // <cardId>cardId<cardId/>
  // <cardId>cardId</cardId>
  // <cardId>cardId</cardId/>
  const citeRegex = /<cardId>(['"]?)([^'"<>]+)\1(?:<\/cardId>|<cardId\/>|<\/cardId\/>)/g;
  
  // 处理主文本中的 citations
  processedText = processedText.replace(citeRegex, (match, quote, cardId) => {
    // 预处理：去除非字母数字字符，只保留有效的 cardId
    const cleanCardId = cardId.replace(/[^a-zA-Z0-9]/g, '');
    const placeholder = `%%CITATION_${citationCounter}%%`;
    citations.push({ cardId: cleanCardId, placeholder });
    citationCounter++;
    return placeholder;
  });
  
  // 处理 excerpt 内容中的 citations
  excerpts.forEach(excerpt => {
    excerpt.content = excerpt.content.replace(citeRegex, (match, quote, cardId) => {
      // 预处理：去除非字母数字字符，只保留有效的 cardId
      const cleanCardId = cardId.replace(/[^a-zA-Z0-9]/g, '');
      const placeholder = `%%CITATION_${citationCounter}%%`;
      citations.push({ cardId: cleanCardId, placeholder });
      citationCounter++;
      return placeholder;
    });
  });
  
  // 处理 highlight 内容中的 citations
  highlights.forEach(highlight => {
    highlight.content = highlight.content.replace(citeRegex, (match, quote, cardId) => {
      // 预处理：去除非字母数字字符，只保留有效的 cardId
      const cleanCardId = cardId.replace(/[^a-zA-Z0-9]/g, '');
      const placeholder = `%%CITATION_${citationCounter}%%`;
      citations.push({ cardId: cleanCardId, placeholder });
      citationCounter++;
      return placeholder;
    });
  });
  
  return { processedText, citations, excerpts, highlights };
};

const EMPTY_PARENT_CITATIONS: Array<{ cardId: string; placeholder: string }> = [];

// 新增：引用组件
const CitationBlock: React.FC<{
  cardId: string;
  currentAgentId?: string;
  citationIndex: number; // 新增：引用在文段中的序号
}> = React.memo(({ cardId, currentAgentId, citationIndex }) => {
  return (
    <span className="citation-block">
      {citationIndex}
    </span>
  );
}, (prevProps, nextProps) => {
  // 自定义比较函数，只在关键 props 变化时重新渲染
  return prevProps.cardId === nextProps.cardId &&
         prevProps.citationIndex === nextProps.citationIndex &&
         prevProps.currentAgentId === nextProps.currentAgentId;
});

// 新增：自定义 ReactMarkdown 组件，用于处理引用
const MarkdownWithCitationsBase: React.FC<{ 
  content: string; 
  currentAgentId?: string;
  parentCitations?: Array<{ cardId: string; placeholder: string }>; // 新增：父级 citations
  parentCardIdToIndex?: Map<string, number>; // 新增：父级的 cardId 到编号的映射
  isInline?: boolean; // 新增：是否在 inline 上下文中（用于避免段落嵌套）
}> = ({ content, currentAgentId, parentCitations = EMPTY_PARENT_CITATIONS, parentCardIdToIndex, isInline = false }) => {
  // 解析 Markdown + 引用，按内容缓存，避免重复计算
  const { processedText, citations, excerpts, highlights } = useMemo(
    () => parseCitationTags(content),
    [content]
  );
  
  // 合并 citation 列表并缓存，保持引用编号稳定
  const allCitations = useMemo(
    () => [...parentCitations, ...citations],
    [parentCitations, citations]
  );

  // 创建 cardId -> 序号映射，依赖明确，避免每次 render 重新构建
  const cardIdToIndex = useMemo(() => {
    const map = new Map<string, number>(parentCardIdToIndex || []);
    allCitations.forEach((citation) => {
      if (!map.has(citation.cardId)) {
        map.set(citation.cardId, map.size + 1);
      }
    });
    return map;
  }, [allCitations, parentCardIdToIndex]);

  const processNode = (node: any, keyPrefix: string): React.ReactNode => {
    if (node.type === 'text') {
      const parts = node.value.split(/(%%(?:CITATION|EXCERPT|HIGHLIGHT)_\d+%%)/);
      const result = parts.map((part: string, index: number) => {
        // 处理引用标记 - 使用 cardId 到编号的映射
        const citation = allCitations.find(c => c.placeholder === part);
        if (citation) {
          const citationIndex = cardIdToIndex.get(citation.cardId) || 1;
          return (
            <CitationBlock
              key={`${keyPrefix}-citation-${index}`}
              cardId={citation.cardId}
              currentAgentId={currentAgentId}
              citationIndex={citationIndex}
            />
          );
        }
        
        // 处理 excerpt 引用块 - 传递所有 citations 和映射给子组件
        const excerpt = excerpts.find(e => e.placeholder === part);
        if (excerpt) {
          return (
            <blockquote key={`${keyPrefix}-excerpt-${index}`} className="excerpt-block">
              <MarkdownWithCitations 
                content={excerpt.content} 
                currentAgentId={currentAgentId}
                parentCitations={allCitations}
                parentCardIdToIndex={cardIdToIndex}
              />
            </blockquote>
          );
        }
        
        // 处理 highlight 标记 - 用 span 标签包裹并高亮显示
        const highlight = highlights.find(h => h.placeholder === part);
        if (highlight) {
          return (
            <span
              key={`${keyPrefix}-highlight-${index}`}
              className="trace-support-highlight"
            >
              <MarkdownWithCitations 
                content={highlight.content} 
                currentAgentId={currentAgentId}
                parentCitations={allCitations}
                parentCardIdToIndex={cardIdToIndex}
                isInline={true} // highlight 在 inline 上下文中
              />
            </span>
          );
        }
        
        // 普通文本部分 - 去除占位符前后的单个空格
        let text = part;
        // 如果前一个元素是占位符，去除文本开头的单个空格
        if (index > 0) {
          const prevPart = parts[index - 1];
          const isPlaceholder = allCitations.some(c => c.placeholder === prevPart) ||
                               excerpts.some(e => e.placeholder === prevPart) ||
                               highlights.some(h => h.placeholder === prevPart);
          if (isPlaceholder && text.startsWith(' ')) {
            text = text.substring(1);
          }
        }
        // 如果后一个元素是占位符，去除文本结尾的单个空格
        if (index < parts.length - 1) {
          const nextPart = parts[index + 1];
          const isPlaceholder = allCitations.some(c => c.placeholder === nextPart) ||
                               excerpts.some(e => e.placeholder === nextPart) ||
                               highlights.some(h => h.placeholder === nextPart);
          if (isPlaceholder && text.endsWith(' ')) {
            text = text.substring(0, text.length - 1);
          }
        }
        return text;
      });
      // 过滤掉空白字符串，避免在表格元素中出现空白文本节点
      return result.filter((item: React.ReactNode) => {
        if (typeof item === 'string' && item.trim() === '') {
          return false;
        }
        return true;
      });
    }

    if (node.type === 'element') {
      // 禁用图片渲染
      if (node.tagName === 'img') {
        return null;
      }
      
      const Tag = node.tagName as keyof JSX.IntrinsicElements;
      // 分离 key 和其他 props
      const { key, ...otherProps } = {
        ...node.properties,
        key: keyPrefix,
      };
      
      // 处理自闭合元素（void elements），这些元素不能有子元素
      const voidElements = ['br', 'hr', 'input', 'area', 'base', 'col', 'embed', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
      if (voidElements.includes(node.tagName)) {
        return <Tag key={keyPrefix} {...otherProps} />;
      }
      
      const children = node.children.map((child: any, index: number) => 
        processNode(child, `${keyPrefix}-${index}`)
      );
      return <Tag key={keyPrefix} {...otherProps}>{children}</Tag>;
    }

    return null;
  };

  // 辅助函数：过滤空白文本节点（用于表格元素，因为 HTML 规范不允许表格元素包含文本节点）
  const filterWhitespaceNodes = (children: React.ReactNode[]): React.ReactNode[] => {
    const filtered: React.ReactNode[] = [];

    children.forEach((child) => {
      // 过滤掉 null、undefined
      if (child == null) return;

      // 如果是数组，递归处理
      if (Array.isArray(child)) {
        const nested = filterWhitespaceNodes(child);
        if (nested.length > 0) {
          filtered.push(...nested);
        }
        return;
      }

      // 过滤掉只包含空白字符的字符串
      if (typeof child === 'string' && child.trim() === '') return;

      filtered.push(child);
    });

    return filtered;
  };

  // 通用渲染器工厂函数：为所有可能包含文本的元素创建自定义渲染器
  const createElementRenderer = (tagName: string) => (element: any) => {
    const { node } = element;
    const Tag = tagName as keyof JSX.IntrinsicElements;
    const { key, ...otherProps } = {
      ...node.properties,
      key: `renderer-${tagName}-${Math.random()}`,
    };
    const children = node.children.map((child: any, index: number) => processNode(child, `${tagName}-${index}`));
    return <Tag key={otherProps.key} {...otherProps}>{children}</Tag>;
  };

  const customRenderers = {
    // 段落（保留特殊逻辑：检查 blockquote 和 highlight）
    p: (paragraph: any) => {
      const { node } = paragraph;
      const children = node.children.map((child: any, index: number) => 
        processNode(child, `p-${index}`)
      );
      
      // 如果在 inline 上下文中，将段落渲染为 span 以避免嵌套
      if (isInline) {
        return <span className="inline-paragraph">{children}</span>;
      }
      
      // 检查是否包含 blockquote 元素，如果有则使用 div 包装而不是 p
      const hasBlockquote = React.Children.toArray(children).some((child: any) => 
        React.isValidElement(child) && child.type === 'blockquote'
      );
      
      // 检查是否包含 highlight span（可能包含嵌套的段落）
      const hasHighlight = React.Children.toArray(children).some((child: any) => 
        React.isValidElement(child) && 
        child.type === 'span' && 
        (child.props as any)?.className === 'trace-support-highlight'
      );
      
      if (hasBlockquote || hasHighlight) {
        return <div className="paragraph-with-blockquote">{children}</div>;
      }
      
      return <p>{children}</p>;
    },
    // 列表项
    li: (listItem: any) => {
      const { node } = listItem;
      const children = node.children.map((child: any, index: number) => 
        processNode(child, `li-${index}`)
      );
      return <li>{children}</li>;
    },
    // 标题（h1-h6）
    h1: createElementRenderer('h1'),
    h2: createElementRenderer('h2'),
    h3: createElementRenderer('h3'),
    h4: createElementRenderer('h4'),
    h5: createElementRenderer('h5'),
    h6: createElementRenderer('h6'),
    // 文本样式
    strong: createElementRenderer('strong'),
    em: createElementRenderer('em'),
    // 代码（行内代码也需要处理，因为可能包含占位符）
    code: createElementRenderer('code'),
    pre: createElementRenderer('pre'),
    // 引用块
    blockquote: createElementRenderer('blockquote'),
    // 列表
    ul: createElementRenderer('ul'),
    ol: createElementRenderer('ol'),
    // 链接
    a: createElementRenderer('a'),
    // 表格相关
    table: (table: any) => {
      const { node } = table;
      const children = node.children.map((child: any, index: number) => processNode(child, `table-${index}`));
      return <table className="markdown-table">{filterWhitespaceNodes(children)}</table>;
    },
    thead: (thead: any) => {
      const { node } = thead;
      const children = node.children.map((child: any, index: number) => processNode(child, `thead-${index}`));
      return <thead>{filterWhitespaceNodes(children)}</thead>;
    },
    tbody: (tbody: any) => {
      const { node } = tbody;
      const children = node.children.map((child: any, index: number) => processNode(child, `tbody-${index}`));
      return <tbody>{filterWhitespaceNodes(children)}</tbody>;
    },
    tr: (tr: any) => {
      const { node } = tr;
      const children = node.children.map((child: any, index: number) => processNode(child, `tr-${index}`));
      return <tr>{filterWhitespaceNodes(children)}</tr>;
    },
    th: (th: any) => {
      const { node } = th;
      const children = node.children.map((child: any, index: number) => processNode(child, `th-${index}`));
      return <th>{children}</th>;
    },
    td: (td: any) => {
      const { node } = td;
      const children = node.children.map((child: any, index: number) => processNode(child, `td-${index}`));
      return <td>{children}</td>;
    },
  };

  return <ReactMarkdown remarkPlugins={[remarkGfm]} components={customRenderers}>{processedText}</ReactMarkdown>;
};

// 通过 React.memo 避免相同内容的重复渲染
const MarkdownWithCitations = React.memo(
  MarkdownWithCitationsBase,
  (prev, next) =>
    prev.content === next.content &&
    prev.currentAgentId === next.currentAgentId &&
    prev.parentCitations === next.parentCitations &&
    prev.parentCardIdToIndex === next.parentCardIdToIndex &&
    prev.isInline === next.isInline
);


// 新增：SearchAgent组件，显示对应Agent的最新Chat Messages
const SearchAgentContent: React.FC<{ 
  correspondAgentId: string;
  cardType: string; // 新增：卡片类型，用于区分 search_agent 和 research_agent
  onAgentSwitch?: (targetAgentId: string) => void; // Agent 切换回调函数
}> = ({ correspondAgentId, cardType, onAgentSwitch }) => {
  // 获取对应Agent的最新1-3条Chat Messages
  const getLatestChatMessages = () => {
    try {
      const chatList = chatStore.getChatMessages();
      if (!chatList || chatList.length === 0) {
        return [];
      }
      
      // 获取最新的1-3条消息，按时间倒序取前3条
      const latestMessages = chatList.slice(-3);
      return latestMessages;
    } catch (error) {
      console.error('Error getting latest chat messages:', error);
      return [];
    }
  };

  const latestMessages = getLatestChatMessages();

  // 根据卡片类型确定显示的标题和图标
  const getAgentDisplayInfo = () => {
    if (cardType === 'research_agent') {
      return {
        title: '🔬 Research Agent',
        className: 'research-agent-content'
      };
    } else {
      return {
        title: '🔍 Search Agent',
        className: 'search-agent-content'
      };
    }
  };

  const { title, className } = getAgentDisplayInfo();

  if (latestMessages.length === 0) {
    return (
      <div className={className}>
        <div className="search-agent-header">
          <span className="search-agent-title">{title}</span>
          <span className="correspond-agent-id">→ Agent {correspondAgentId}</span>
        </div>
        <div className="no-messages">暂无聊天记录</div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="search-agent-header">
        <span className="search-agent-title">{title}</span>
        <span className="correspond-agent-id">→ Agent {correspondAgentId}</span>
      </div>
      <div className="chat-messages">
        {latestMessages.map((chatItem, index) => {
          let content = '';
          let messageType = '';
          
          if (chatItem.type === 'user_message' && typeof chatItem.content === 'string') {
            content = chatItem.content;
            messageType = 'user';
          } else if (chatItem.type === 'assistant_message' && typeof chatItem.content === 'string') {
            content = chatItem.content;
            messageType = 'agent';
          } else if (chatItem.type === 'system_message' && typeof chatItem.content === 'string') {
            content = chatItem.content;
            messageType = 'system';
          }

          if (!content) return null;

          return (
            <div key={index} className={`chat-message ${messageType}`}>
              <div className="message-type">{messageType === 'user' ? '👤' : messageType === 'agent' ? '🤖' : '⚙️'}</div>
              <div className="message-content">
                <ReactMarkdown>{content}</ReactMarkdown>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// 新增：搜索结果内容组件
// 处理 webSearch 中的 highlight 标签（plain text，不是 markdown）
const websearchWithHighlight = (text: string): React.ReactNode[] => {
  if (!text) return [text];
  
  const openTag = '<highlight>';
  const closeTag = '</highlight>';
  const selfCloseTag = '<highlight/>';
  
  // 递归函数：找到最外层的 highlight 标签并处理
  const processHighlights = (str: string): React.ReactNode[] => {
    const result: React.ReactNode[] = [];
    let lastIndex = 0;
    let i = 0;
    
    while (i < str.length) {
      // 查找下一个开始标签
      const openIndex = str.indexOf(openTag, i);
      if (openIndex === -1) {
        // 没有更多 highlight 标签，添加剩余文本
        if (lastIndex < str.length) {
          const remaining = str.substring(lastIndex);
          if (remaining) {
            result.push(remaining);
          }
        }
        break;
      }
      
      // 添加开始标签前的文本
      if (openIndex > lastIndex) {
        const beforeText = str.substring(lastIndex, openIndex);
        if (beforeText) {
          result.push(beforeText);
        }
      }
      
      // 查找匹配的结束标签（使用栈来处理嵌套）
      const stack: number[] = [openIndex];
      let contentStart = openIndex + openTag.length;
      let foundEnd = false;
      let endIndex = -1;
      let isSelfClose = false;
      
      let j = contentStart;
      while (j < str.length && stack.length > 0) {
        // 检查是否是开始标签
        if (str.substring(j, j + openTag.length) === openTag) {
          stack.push(j);
          j += openTag.length;
          continue;
        }
        
        // 检查是否是自闭合标签
        if (str.substring(j, j + selfCloseTag.length) === selfCloseTag) {
          if (stack.length === 1) {
            // 这是最外层的自闭合标签
            endIndex = j + selfCloseTag.length;
            isSelfClose = true;
            foundEnd = true;
            stack.pop();
            break;
          } else {
            // 内层的自闭合标签，跳过
            stack.pop();
            j += selfCloseTag.length;
            continue;
    }
  }
  
        // 检查是否是结束标签
        if (str.substring(j, j + closeTag.length) === closeTag) {
          stack.pop();
          if (stack.length === 0) {
            // 这是最外层的结束标签
            endIndex = j + closeTag.length;
            foundEnd = true;
            break;
          }
          j += closeTag.length;
          continue;
        }
        
        j++;
      }
      
      if (!foundEnd) {
        // 没有找到匹配的结束标签，当作普通文本处理
        result.push(str.substring(openIndex));
        break;
      }
      
      // 提取内容（不包括标签）
      const contentEnd = isSelfClose ? endIndex - selfCloseTag.length : endIndex - closeTag.length;
      const content = str.substring(contentStart, contentEnd);
      
      // 递归处理内容（可能包含嵌套的 highlight）
      const contentNodes = processHighlights(content);
      
      // 用 span 包裹高亮内容
      result.push(
        <span key={`highlight-${openIndex}-${endIndex}`} className="trace-support-highlight">
          {contentNodes}
        </span>
      );
      
      lastIndex = endIndex;
      i = endIndex;
  }
  
    return result.length > 0 ? result : [str];
  };
  
  return processHighlights(text);
};

const SearchResultContent: React.FC<{ 
  searchResultList: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}> = ({ searchResultList }) => {
  // 处理整个结果项点击，打开链接
  const handleResultClick = (url: string, e: React.MouseEvent) => {
    e.stopPropagation(); // 阻止事件冒泡
    // 清理URL中的反引号
    const cleanUrl = url.replace(/`/g, '').trim();
    if (cleanUrl) {
      window.open(cleanUrl, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <div className="search-result-content">
      {searchResultList.map((result, index) => (
        <div 
          key={index} 
          className="search-result-item"
          onClick={(e) => handleResultClick(result.url, e)}
          title="点击打开链接"
        >
          <div className="result-title">{websearchWithHighlight(result.title)}</div>
          <div className="result-snippet">{websearchWithHighlight(result.snippet)}</div>
        </div>
      ))}
    </div>
  );
};



const CardNode: React.FC<NodeProps<CardNodeData>> = ({ data, selected, sourcePosition, targetPosition, id }) => {
  const nodeRef = useRef<HTMLDivElement>(null);
  const {
    card,
    agentId,
    cardId,
    onShowDetail,
    onAgentSwitch,
    isSelectionMode = false,
    isSelectedForAction = false,
    isCollapsed: externalIsCollapsed,
    onToggleCollapsed,
    currentDetailCardId,
    isDetailOpen = false,
    onCloseDetail,
    isHighlighted = false,
    reactFlowViewRef,
    setCardCollapsedStates,
    onUnifiedRightClick
  } = data;
  
  // 检查是否为 trace_result 或 in_progress 状态
  const isTraceResultCard = card.card_type === 'trace_result';
  const traceHostCardType = isTraceResultCard ? card.card_content?.trace_host_card_type : undefined;
  const renderCardType = isTraceResultCard && traceHostCardType ? traceHostCardType : card.card_type;
  const renderCardContent = isTraceResultCard
    ? card.card_content?.trace_host_card_content || card.card_content
    : card.card_content;
  const isInProgress = card.status === 'in_progress';

  
  // 收起态状态管理 - 优先使用外部传入的状态，否则使用内部状态
  const getDefaultCollapsedState = () => {
    const importantTypes = ['user_requirement', 'note', 'report'];
    return !importantTypes.includes(card.card_type);
  };
  
  const [internalIsCollapsed, setInternalIsCollapsed] = useState(getDefaultCollapsedState());
  
  // 使用外部状态（如果提供）或内部状态
  // 如果是 in_progress 状态，强制保持折叠态
  const baseIsCollapsed = externalIsCollapsed !== undefined ? externalIsCollapsed : internalIsCollapsed;
  const isCollapsed = isInProgress ? true : baseIsCollapsed;
  const cardUniqueId = card.card_id || cardId;
  const isCurrentDetailCard = Boolean(cardUniqueId && currentDetailCardId && cardUniqueId === currentDetailCardId);
  const isDetailOpenForThisCard = Boolean(isDetailOpen && isCurrentDetailCard);

  // 动画状态管理
  const [isAnimating, setIsAnimating] = useState(false);
  const [animationPhase, setAnimationPhase] = useState<'idle' | 'collapsing' | 'expanding'>('idle');
  const firstHighlightScrolledRef = useRef<{ cardId?: string; done: boolean }>({ cardId: undefined, done: false });

  // 标记 DetailView 是否正在打开过程中，避免误触发恢复逻辑
  const [isDetailViewOpening, setIsDetailViewOpening] = useState<boolean>(false);
  
  // 动画持续时间（毫秒）
  const EXPAND_ANIMATION_DURATION = 400;   // 展开动画时长
  const COLLAPSE_ANIMATION_DURATION = 400; // 收缩动画时长

  // 处理左键点击（focus 卡片）
  const handleLeftClick = (e: React.MouseEvent) => {
    console.log(`[DEBUG-TRACE] handleLeftClick 被调用: cardId=${cardId}, isTraceResult=${isTraceResultCard}, isCollapsed=${isCollapsed}, isDetailOpenForThisCard=${isDetailOpenForThisCard}`);
    // 如果点击的是按钮或其他交互元素，不处理卡片切换
    const target = e.target as HTMLElement;
    if (target.closest('.card-actions')) {
      return;
    }

    // 阻止事件冒泡
    e.stopPropagation();

    // 如果是 in_progress 状态，禁止操作，直接返回
    if (isInProgress) {
      return;
    }

    // 如果正在动画中，忽略点击
    if (isAnimating) {
      return;
    }

    // 如果处于选择模式，执行选择逻辑
    if (isSelectionMode && window.toggleCardSelection) {
      const fullCardId = `${agentId}-${cardId}`;
      window.toggleCardSelection(fullCardId);
      return;
    }

    // 使用统一的右键处理函数来 focus 卡片
    if (onUnifiedRightClick) {
      onUnifiedRightClick(cardId);
    }
  };

  // 处理右键点击（展开/收缩卡片）
  const handleRightClick = (e: React.MouseEvent) => {
    e.preventDefault(); // 阻止默认右键菜单
    e.stopPropagation();

    // 如果点击的是按钮或其他交互元素，不处理
    const target = e.target as HTMLElement;
    if (target.closest('.card-actions')) {
      return;
    }

    // 如果是 in_progress 状态，禁止展开，直接返回
    if (isInProgress) {
      return;
    }

    // 如果正在动画中，忽略点击
    if (isAnimating) {
      return;
    }

    // 如果处于选择模式，执行选择逻辑
    if (isSelectionMode && window.toggleCardSelection) {
      const fullCardId = `${agentId}-${cardId}`;
      window.toggleCardSelection(fullCardId);
      return;
    }

    if (isDetailOpenForThisCard) {
      // 当前处于 DetailView 状态，右键点击会关闭 DetailView 并折叠卡片
      reactFlowViewRef?.current?.showDetailConnections();

      if (onCloseDetail) {
        // 在关闭DetailView之前，先强制将卡片的之前状态设置为折叠
        // 这样handleCloseDetail恢复时就会折叠卡片
        if (cardUniqueId) {
          // 通过window对象传递强制折叠状态给MainLayout
          const forceCollapseState = { [cardUniqueId]: true };
          (window as any).forceCollapseStateForCard = forceCollapseState;
        }
        onCloseDetail();
      }

      return;
    }

    // 正常的折叠/展开切换
    transitionCollapsedState(!isCollapsed);
  };


  const transitionCollapsedState = (nextCollapsed: boolean) => {
    console.log(`[DEBUG-TRACE] transitionCollapsedState 被调用: cardId=${cardId}, 当前isCollapsed=${isCollapsed}, 目标nextCollapsed=${nextCollapsed}, hasOnToggleCollapsed=${!!onToggleCollapsed}`);
    if (isAnimating || isCollapsed === nextCollapsed) {
      console.log(`[DEBUG-TRACE] 跳过状态转换: isAnimating=${isAnimating}, 状态相同=${isCollapsed === nextCollapsed}`);
      return;
    }

    setIsAnimating(true);
    setAnimationPhase(nextCollapsed ? 'collapsing' : 'expanding');

    if (onToggleCollapsed) {
      console.log(`[DEBUG-TRACE] 调用 onToggleCollapsed`);
      onToggleCollapsed();
    } else {
      console.log(`[DEBUG-TRACE] 调用 setInternalIsCollapsed(${nextCollapsed})`);
      setInternalIsCollapsed(nextCollapsed);
    }

    const animationDuration = nextCollapsed ? COLLAPSE_ANIMATION_DURATION : EXPAND_ANIMATION_DURATION;
    setTimeout(() => {
      setIsAnimating(false);
      setAnimationPhase('idle');
    }, animationDuration);
  };

  // 使用 ref 跟踪之前的状态
  const prevStatusRef = useRef<string | undefined>(card.status);
  // const highlightMarkerRef = useRef<HTMLElement[]>([]); // 已注释：方案2不再需要
  
  // 监听状态变化：当从 in_progress 变为 completed 时，自动展开卡片（仅限 user_requirement、report 和 note 类型）
  useEffect(() => {
    const prevStatus = prevStatusRef.current;
    const currentStatus = card.status;
    
    // 如果状态从 in_progress 变为 completed，且 unfold_at_start 为 true，自动展开卡片
    if (prevStatus === 'in_progress' && currentStatus === 'completed') {
      // 只有 unfold_at_start 为 true 的卡片才自动展开
      if (card.unfold_at_start === true) {
        // 延迟一小段时间确保状态更新完成，然后强制展开卡片
        // 使用更长的延迟，避免与其他状态更新冲突
        setTimeout(() => {
          // 再次检查当前状态，避免重复操作
          if (isCollapsed) {
            // 直接设置状态为展开，而不是切换
            if (setCardCollapsedStates) {
              setCardCollapsedStates(prev => ({
                ...prev,
                [cardId]: false // 直接设置为展开
              }));
            } else {
              setInternalIsCollapsed(false);
            }
          }
        }, 300); // 增加延迟时间，确保所有状态更新完成
      }
    }
    
    // 更新之前的状态
    prevStatusRef.current = currentStatus;
  }, [card.status, card.card_type]); // 只依赖状态和类型，避免被其他状态变化意外触发


  
  // 根据card type获取对应的图标
  const getCardIcon = () => {
    const cardType = renderCardType;
    switch (cardType) {
      case 'trace_result':
        return '/resource/trace.svg';
      case 'note':
        return '/resource/note.svg';
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
      default:
        return '/resource/note.svg'; // 默认图标
    }
  };

  // 根据card type获取对应的圆形背景色
  const getCircleBackgroundColor = () => {
    if (isTraceResultCard) {
      return TRACE_ACCENT_COLOR;
    }
    const cardType = renderCardType;
    switch (cardType) {
      case 'webpage':
        return '#50B230';
      case 'web_search':
      case 'web_search_result':
        return '#387BFF';
      case 'note':
      case 'report':
        return '#E73232';
      default:
        return '#000000'; // 其余均为黑色（包括user_requirement）
    }
  };

  const getCircleIcon = () => {
    if (isTraceResultCard) {
      return '/resource/trace.svg';
    }
    return getCardIcon();
  };

  // 获取卡片标题
  const getCardTitle = () => {
    return renderCardContent?.card_title || renderCardType || '未命名卡片';
  };

  // 根据卡片类型显示不同的内容
  const displayCardContent = () => {
    // 针对 trace_result 类型的特殊处理：只有当 trace_support_content_list 为 null 时，显示警告
    if (isTraceResultCard) {
      // 只有当 trace_support_content_list 严格等于 null 时才显示 lacking support
      const traceSupportContentList = (card.card_content as any)?.trace_support_content_list;
      if (traceSupportContentList === null) {
        return (
          <div className="trace-result-lacking-support">
            <img src="/resource/warning.svg" alt="warning" className="warning-icon" />
            <span className="lacking-support-text">Lacking support.</span>
          </div>
        );
      }
      // 如果有 support_content（即使是空数组或空字符串），继续使用原卡片的显示逻辑（通过 renderCardType）
    }
    
    // 针对 user_requirement 类型的特殊布局
    if (renderCardType === 'user_requirement') {
      // 只使用 reference_list
      const referenceList: CardReference[] = renderCardContent?.reference_list || [];
      
      return (
        <div className="user-requirement-content">
          {/* 第一行：图标和文字 */}
          <div className="user-requirement-main">
            <div className="user-requirement-icon">
              {/* 内容区使用 dark 版本图标，顶部圆形仍使用普通版本 */}
              <img src="/resource/user_requirement_dark.svg" alt="user_requirement" className="content-icon" />
            </div>
            <div className="user-requirement-text">
              {renderCardContent?.user_requirement || renderCardContent?.card_title || '用户需求内容'}
            </div>
          </div>
          {/* 第二行：引用卡片区域 - 显示在文字下方 */}
          {referenceList.length > 0 && (
            <div className="user-requirement-references">
              {referenceList.map((cardRef, index) => (
                <CardRefCollapsed
                  key={`${cardRef.card_id}-${index}`}
                  cardReference={cardRef}
                  index={index}
                />
              ))}
            </div>
          )}
        </div>
      );
    }
    
    // 针对 visualization 类型的特殊布局
    if (renderCardType === 'visualization') {
      const htmlContent = renderCardContent?.html || '';
      
      return (
        <div className="visualization-content">
          <div className="visualization-icon">
            <img src={getCardIcon()} alt="visualization" className="content-icon" />
          </div>
          <div className="visualization-screenshot">
            {htmlContent ? (
              <HTMLScreenshot 
                htmlContent={htmlContent}
                width={480}
                height={360}
                className="visualization-image"
              />
            ) : (
              <div className="no-content">无可视化内容</div>
            )}
          </div>
        </div>
      );
    }
    
    // 针对 target_task 类型的特殊布局
    if (renderCardType === 'target_task') {
      const todoList = renderCardContent?.todo_list || [];
      return (
        <div className="target-task-content">
          <div className="todo-list">
            {todoList.map((todo: any, index: number) => {
              let iconElement;
              switch (todo.status) {
                case 'completed':
                  iconElement = <img src="/resource/completed.svg" alt="completed" className="todo-icon-svg" />;
                  break;
                case 'in_progress':
                  iconElement = <img src="/resource/in_progress.svg" alt="in_progress" className="todo-icon-svg" />;
                  break;
                case 'interrupted':
                  iconElement = <img src="/resource/interrupted.svg" alt="interrupted" className="todo-icon-svg" />;
                  break;
                case 'pending':
                default:
                  iconElement = <img src="/resource/pending.svg" alt="pending" className="todo-icon-svg" />;
                  break;
              }
              
              return (
                <div key={index} className={`todo-item todo-${todo.status}`}>
                  {iconElement}
                  <span className="todo-text">{todo.content}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    
    // 针对 webpage 类型的特殊布局
    if (renderCardType === 'webpage') {
      const url = renderCardContent?.url || '';
      const summary = renderCardContent?.summary || '';
      // 对于 trace_result 卡片，优先使用 card_main_content_with_highlight；如果不存在或无效则回退到 markdown_convert_from_webpage
      // 否则使用 markdown_convert_from_webpage
      let rawMarkdownContent: string | undefined;
      if (isTraceResultCard) {
        const highlightContent = (card.card_content as any)?.card_main_content_with_highlight;
        // 只有当 highlightContent 存在且是有效字符串时才使用，否则回退到原始内容
        if (highlightContent && typeof highlightContent === 'string' && highlightContent.trim().length > 0) {
          rawMarkdownContent = highlightContent;
        } else {
          rawMarkdownContent = renderCardContent?.markdown_convert_from_webpage;
        }
      } else {
        rawMarkdownContent = renderCardContent?.markdown_convert_from_webpage;
      }
      let markdownContent = typeof rawMarkdownContent === 'string' ? rawMarkdownContent : '';
      // 根据卡片类型设置不同的长度限制
      // trace_result 卡片保持 50000 字符限制，其他 webpage 卡片限制为 10000 字符
      const maxLength = isTraceResultCard ? 50000 : 4000;
      if (markdownContent.length > maxLength) {
        markdownContent = markdownContent.slice(0, maxLength);
      }
      
      // 从 URL 中提取域名用于 favicon
      const getFaviconUrl = (url: string) => {
        try {
          const domain = new URL(url).hostname;
          return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        } catch {
          return '/resource/webpage.svg'; // 默认图标
        }
      };
      
      return (
        <div className="webpage-content">
          {/* 第一部分：URL 部分 */}
          <div className="webpage-url-section">
            <img 
              src={getFaviconUrl(url)} 
              alt="favicon" 
              className="webpage-favicon"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/resource/webpage.svg';
              }}
            />
            <span className="webpage-url">{url}</span>
          </div>
          
          {/* <div className="webpage-summary-section">
            <img src="/resource/cite.svg" alt="引用" className="quote-icon" />
            <div className="webpage-summary">{summary}</div>
          </div> */}
          
          {/* 第三部分：Markdown 内容 */}
          {markdownContent && (
            <div className="webpage-markdown-section">
              <MarkdownWithCitations 
                content={markdownContent} 
                currentAgentId={data.agentId}
              />
            </div>
          )}
        </div>
      );
    }
    
    // 针对 note 和 report 类型的特殊布局
    if (renderCardType === 'note' || renderCardType === 'report') {
      const summary = renderCardContent?.summary || '';
      // 对于 trace_result 卡片，优先使用 card_main_content_with_highlight；如果不存在或无效则回退到 markdown_with_cite
      // 否则使用 markdown_with_cite
      let markdownWithCite: string;
      if (isTraceResultCard) {
        const highlightContent = (card.card_content as any)?.card_main_content_with_highlight;
        // 只有当 highlightContent 存在且是有效字符串时才使用，否则回退到原始内容
        if (highlightContent && typeof highlightContent === 'string' && highlightContent.trim().length > 0) {
          markdownWithCite = highlightContent;
        } else {
          markdownWithCite = renderCardContent?.markdown_with_cite || '';
        }
      } else {
        markdownWithCite = renderCardContent?.markdown_with_cite || '';
      }

      // 根据卡片类型设置不同的长度限制
      // trace_result 卡片保持 50000 字符限制，其他 note 卡片限制为 10000 字符
      const maxLength = isTraceResultCard ? 50000 : 4000;
      if (markdownWithCite.length > maxLength) {
        markdownWithCite = markdownWithCite.slice(0, maxLength);
      }
      
      return (
        <div className="report-content">
          {/* <div className="report-summary-section">
            <img src="/resource/cite.svg" alt="引用" className="quote-icon" />
            <div className="report-summary">{summary}</div>
          </div> */}
          
          {/* 第二部分：Markdown 内容 */}
          <div className="report-markdown-section">
            <MarkdownWithCitations 
              content={markdownWithCite} 
              currentAgentId={data.agentId}
            />
          </div>
        </div>
      );
    }
    
    // 针对 web_search 和 web_search_result 类型的特殊布局
    if (renderCardType === 'web_search' || renderCardType === 'web_search_result') {
      const searchQuery = renderCardContent?.search_query || '';
      // 对于 trace_result 卡片，优先使用 card_main_content_with_highlight；如果不存在或无效则回退到 search_result_list
      let searchResultList: Array<{ title: string; url: string; snippet: string }> = [];
      if (isTraceResultCard) {
        const highlightContent = (card.card_content as any)?.card_main_content_with_highlight;
        // 只有当 highlightContent 存在且是数组时才使用，否则回退到原始内容
        if (highlightContent && Array.isArray(highlightContent) && highlightContent.length > 0) {
          searchResultList = highlightContent;
        } else {
          searchResultList = renderCardContent?.search_result_list || [];
        }
      } else {
        searchResultList = renderCardContent?.search_result_list || [];
        // 对于普通 web_search 卡片，最多显示 3 条搜索结果
        if (searchResultList.length > 3) {
          searchResultList = searchResultList.slice(0, 3);
        }
      }
      
      return (
        <div className="web-search-content">
          {/* 上部分：搜索框 */}
          <div className="search-box">
            <img src="/resource/web_search_dark.svg" alt="search" className="search-icon" />
            <div className="search-query">
              {searchQuery}
            </div>
          </div>
          
          {/* 下部分：搜索结果列表 */}
          <div className="search-results">
            {searchResultList.map((result: any, index: number) => (
              <div key={index} className="search-result-item">
                <div className="result-number">{index + 1}</div>
                <div className="result-content">
                  <div className="result-title">
                    {websearchWithHighlight(result.title || '')}
                  </div>
                  <div className="result-url">{result.url}</div>
                  <div className="result-snippet">
                    {websearchWithHighlight(result.snippet || '')}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }
    
    // 其他类型统一显示完整的 card_content
    return (
      <div className="card-content-display">
        <pre>{JSON.stringify(renderCardContent, null, 2)}</pre>
      </div>
    );
  };


  // 计算动画类名
  const getAnimationClasses = () => {
    const classes = [];
    if (isAnimating) classes.push('animating');
    if (animationPhase !== 'idle') classes.push(`animation-${animationPhase}`);
    return classes.join(' ');
  };

  const cardNodeClassName = [
    'card-node',
    selected ? 'selected' : '',
    isSelectionMode ? 'selection-mode' : '',
    isSelectedForAction ? 'selected-for-action' : '',
    isCollapsed ? 'collapsed' : '',
    getAnimationClasses(),
    isHighlighted ? 'highlighted' : '',
    isInProgress ? 'in-progress' : '', // 添加 in-progress 类名用于呼吸效果
  ]
    .filter(Boolean)
    .join(' ');

  type CardNodeStyle = CSSProperties & {
    '--card-highlight-color'?: string;
  };

  const cardNodeStyle: CardNodeStyle = {
    pointerEvents: 'auto',
    '--card-highlight-color': getCircleBackgroundColor(),
  };
  if (isTraceResultCard) {
    cardNodeStyle.borderColor = TRACE_ACCENT_COLOR;
  }

  // Ensure element has explicit logical size to match ReactFlow node dimensions
  // Use per-state logical sizes if provided, otherwise default sizes
  const logicalWCollapsed = (data as any)?.logicalWidthCollapsed as number | undefined;
  const logicalWExpanded = (data as any)?.logicalWidthExpanded as number | undefined;
  const logicalHCollapsed = (data as any)?.logicalHeightCollapsed as number | undefined;
  const logicalHExpanded = (data as any)?.logicalHeightExpanded as number | undefined;
  const logicalW = isCollapsed ? logicalWCollapsed : logicalWExpanded;
  const logicalH = isCollapsed ? logicalHCollapsed : logicalHExpanded;
  if (logicalW) cardNodeStyle.width = `${logicalW}px` as any;
  if (logicalH) cardNodeStyle.height = `${logicalH}px` as any;

  // 展开态内容测量：确保高度为“能完整显示内容的最小高度”
  const contentRef = useRef<HTMLDivElement | null>(null);
  const titleRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (isCollapsed) return;
    const HEADER_H = 35; // .card-header height
    const HEADER_MB = 6; // .card-header margin-bottom
    const BODY_PT = 6; // .card-main-body padding-top
    const BODY_PB = 8; // .card-main-body padding-bottom
    const BORDER_Y = 4; // card border top+bottom

    const measure = () => {
      const el = contentRef.current;
      if (!el) return;
      const contentH = el.scrollHeight;
      const totalH = HEADER_H + HEADER_MB + BODY_PT + BODY_PB + contentH + BORDER_Y;
      try {
        const idForReport = (data as any)?.cardId ?? card.card_id ?? '';
        (data as any)?.onMeasureExpandedHeight?.(idForReport, totalH);
      } catch {}
    };

    // 立即测量一次（等待布局稳定）
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(measure);
      // 清理第二层 raf 在取消时不需要
    });

    // 观察内容变化（包含图片加载、markdown渲染等带来的尺寸变化）
    const ro = new ResizeObserver(() => measure());
    if (contentRef.current) ro.observe(contentRef.current);

    return () => {
      cancelAnimationFrame(raf1);
      ro.disconnect();
    };
  }, [isCollapsed, logicalWExpanded, card]);

  useEffect(() => {
    if (isCollapsed) return;
    const el = titleRef.current;
    if (!el) return;
    const measureTitle = () => {
      const scrollW = el.scrollWidth;
      const clientW = el.clientWidth;
      if (scrollW > clientW) {
        const idForReport = (data as any)?.cardId ?? card.card_id ?? '';
        const fn = (data as any)?.onMeasureExpandedTitleWidth as ((id: string, w: number) => void) | undefined;
        if (fn) fn(idForReport, scrollW);
      }
    };
    const r = new ResizeObserver(measureTitle);
    r.observe(el);
    const raf = requestAnimationFrame(measureTitle);
    return () => {
      r.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [isCollapsed, card]);

  // 展开 trace_result 时自动滚动到首个高亮
  useEffect(() => {
    if (!isTraceResultCard || isCollapsed || isAnimating) {
      firstHighlightScrolledRef.current = { cardId: card.card_id ?? undefined, done: false };
      return;
    }

    const currentId = card.card_id ?? undefined;
    if (firstHighlightScrolledRef.current.cardId !== currentId) {
      firstHighlightScrolledRef.current = { cardId: currentId, done: false };
    }
    if (firstHighlightScrolledRef.current.done) return;

    const timer = setTimeout(() => {
      const contentArea = contentRef.current;
      if (!contentArea) return;
      const firstHighlight = contentArea.querySelector('.trace-support-highlight') as HTMLElement | null;
      if (firstHighlight) {
        firstHighlight.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
          inline: 'nearest',
        });
        firstHighlightScrolledRef.current.done = true;
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [isTraceResultCard, isCollapsed, isAnimating, card.card_id]);

  
  return (
    <>
      <div 
        ref={nodeRef} 
        className={cardNodeClassName}
        onClick={handleLeftClick}
        onContextMenu={handleRightClick}
        style={cardNodeStyle}
        data-card-id={cardUniqueId}
      >
        {isCollapsed ? (
          // 收起态渲染
          <div className="card-collapsed-content">
            <div className="card-collapsed-icon" style={{ backgroundColor: getCircleBackgroundColor() }}>
              <img 
              src={getCircleIcon()} 
                alt={renderCardType} 
                style={renderCardType === 'note' ? { transform: 'translateX(1.5px)' } : {}}
              />
            </div>
            {/* 根据节点逻辑宽度计算标题胶囊宽度，确保标题完整显示 */}
            {(() => {
              const iconW = 28; // 与样式保持一致
              const overlap = 14; // 与样式保持一致（margin-left: -14px）
              const titlePaddingX = 24 + 16; // 左右 padding
              const titleBorderX = 2 + 2; // 左右边框
              const pillWidthFromNode = logicalWCollapsed ? Math.max(0, logicalWCollapsed - iconW + overlap) : undefined;
              const titleStyle = pillWidthFromNode ? { width: `${pillWidthFromNode}px` } : undefined;
              return (
                <div
                  className="card-collapsed-title"
                  style={{
                    ...(titleStyle || {}),
                    ...(isTraceResultCard ? { borderColor: TRACE_ACCENT_COLOR } : {}),
                  }}
                >
                  <span className="card-collapsed-title-text">
                    {getCardTitle()}
                  </span>
                </div>
              );
            })()}
          </div>
        ) : (
          // 展开态渲染（原有内容）
          <>
            {/* 左上角圆形 */}
            <div className="card-circle" style={{ backgroundColor: getCircleBackgroundColor() }}>
              <img 
            src={getCircleIcon()} 
                alt={renderCardType} 
                className="circle-icon"
                style={renderCardType === 'note' ? { transform: 'translateX(2px)' } : {}}
              />
            </div>
            
            {/* 卡片主体 */}
            <div className="card-main-body">
              {/* 上区域：左右分布 */}
              <div className="card-header">
                <div className="card-header-left">
                  {/* 左区域留空，为圆形让出空间 */}
                </div>
                <div className="card-header-right">
                  {/* 右区域放标题 */}
                  <div className="card-title" ref={titleRef}>{getCardTitle()}</div>
                </div>
              </div>
              
              {/* 下区域：正文内容 */}
              <div className="card-content" ref={contentRef}>
                {displayCardContent()}
              </div>
            </div>
          </>
        )}
        

      </div>
      
      {/* Handle 连接点 */}
      <Handle
        type="target"
        position={Position.Top}
        className={`card-handle card-handle-input ${isCollapsed ? 'collapsed' : ''}`}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className={`card-handle card-handle-output ${isCollapsed ? 'collapsed' : ''}`}
      />
      
    </>
  );
};

export default CardNode;