import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { Box, Typography, IconButton, Paper, Chip } from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatStore, cardStore, historyStore } from '../../../stores';
import HTMLScreenshot from './HTMLScreenshot';
import CardRefCollapsed from './CardRefCollapsed';
import type { Card, CardReference } from '../../../stores/CardType';
import './DetailView.scss';
import api from '../../../api';

// Webpage 卡片详细视图组件
const WebpageDetailView: React.FC<{ 
  url: string;
  summary: string;
  markdownContent: string;
  currentAgentId?: string;
  onCitationClick: (citationInfo: { agentId: string; cardId: string; content: any } | null) => void;
  onCitationHover?: (payload: { cardId: string; color?: string } | null) => void; // 新增：引用悬浮回调
}> = ({ url, summary, markdownContent, currentAgentId, onCitationClick, onCitationHover }) => {
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
    <div className="webpage-detail-view">
      {/* 第一部分：URL 部分 - icon 在左，链接在右 */}
      <div className="webpage-url-section">
        <img 
          src={getFaviconUrl(url)} 
          alt="favicon" 
          className="webpage-favicon"
          onError={(e) => {
            (e.target as HTMLImageElement).src = '/resource/webpage.svg';
          }}
        />
        <a 
          href={url} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="webpage-url"
        >
          {url}
        </a>
      </div>
      
      {/* <div className="webpage-summary-section">
        <img src="/resource/cite.svg" alt="引用" className="quote-icon" />
        <div className="webpage-summary">{summary}</div>
      </div> */}
      
      {/* 第三部分：完整的文本 */}
      <div className="webpage-markdown-section">
        <MarkdownWithCitations 
          content={markdownContent} 
          currentAgentId={currentAgentId}
          onCitationClick={onCitationClick}
          onCitationHover={onCitationHover}
        />
      </div>
    </div>
  );
};

// Target Task 卡片详细视图组件
const TargetTaskDetailView: React.FC<{ 
  todoList: Array<{
    content: string;
    status: string;
  }>;
}> = ({ todoList }) => {
  return (
    <div className="target-task-detail-view">
      <div className="target-task-content">
        <div className="todo-list">
          {todoList.map((todo: any, index: number) => {
            let iconElement;
            switch (todo.status) {
              case 'completed':
                iconElement = <img src="/resource/completed.svg" alt="completed" className="todo-icon todo-completed" />;
                break;
              case 'in_progress':
                iconElement = <img src="/resource/in_progress.svg" alt="in_progress" className="todo-icon in_progress" />;
                break;
              case 'interrupted':
                iconElement = <img src="/resource/interrupted.svg" alt="interrupted" className="todo-icon todo-interrupted" />;
                break;
              case 'pending':
              default:
                iconElement = <img src="/resource/pending.svg" alt="pending" className="todo-icon todo-pending" />;
                break;
            }
            
            return (
              <div key={index} className={`todo-item todo-${todo.status}`}>
                {iconElement}
                <span className={`todo-text ${todo.status}`}>{todo.content}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// User Requirement 卡片详细视图组件
const UserRequirementDetailView: React.FC<{ 
  userRequirement: string;
  cardTitle?: string;
}> = ({ userRequirement, cardTitle }) => {
  return (
    <div className="user-requirement-detail-view">
      <div className="user-requirement-content">
        <div className="user-requirement-text">
          {userRequirement || cardTitle || '用户需求内容'}
        </div>
      </div>
    </div>
  );
};

// Web Search 卡片详细视图组件
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

const WebSearchDetailView: React.FC<{ 
  searchQuery: string;
  searchResultList: Array<{
    title: string;
    url: string;
    snippet: string;
  }>;
}> = ({ searchQuery, searchResultList }) => {
  return (
    <div className="web-search-detail-view">
      {/* 搜索框区域 */}
      <div className="search-box">
        <img src="/resource/web_search_dark.svg" alt="search" className="search-icon" />
        <span className="search-query">
          {searchQuery}
        </span>
      </div>
      
      {/* 搜索结果列表 */}
      <div className="search-results">
        {searchResultList.map((result: any, index: number) => (
          <div key={index} className="search-result-item">
            <div className="result-number">{index + 1}</div>
            <div className="result-content">
              <div className="result-title">{websearchWithHighlight(result.title || '')}</div>
              <a 
                href={result.url} 
                target="_blank" 
                rel="noopener noreferrer" 
                className="result-url"
              >
                {result.url}
              </a>
              <div className="result-snippet">
                {websearchWithHighlight(result.snippet || '')}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

// Report 卡片详细视图组件
const ReportDetailView: React.FC<{ 
  summary: string;
  markdownWithCite: string;
  currentAgentId?: string;
  onCitationClick: (citationInfo: { agentId: string; cardId: string; content: any } | null) => void;
  onCitationHover?: (payload: { cardId: string; color?: string } | null) => void; // 新增：引用悬浮回调
}> = ({ summary, markdownWithCite, currentAgentId, onCitationClick, onCitationHover }) => {
  return (
    <div className="report-detail-view">
      {/* <div className="report-summary-section">
        <div className="report-summary">{summary}</div>
      </div> */}
      
      {/* Markdown 内容 */}
      <div className="report-markdown-section">
        <MarkdownWithCitations 
          content={markdownWithCite} 
          currentAgentId={currentAgentId}
          onCitationClick={onCitationClick}
          onCitationHover={onCitationHover}
        />
      </div>
    </div>
  );
};

// Visualization 卡片详细视图组件
const VisualizationDetailView: React.FC<{ 
  html: string;
}> = ({ html }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  useEffect(() => {
    if (iframeRef.current && html) {
      const iframe = iframeRef.current;
      const doc = iframe.contentDocument || iframe.contentWindow?.document;
      
      if (doc) {
        // 创建完整的 HTML 文档结构
        const fullHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <style>
                body {
                  margin: 0;
                  padding: 16px;
                  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
                  background: #ffffff;
                  overflow: auto;
                }
                * {
                  box-sizing: border-box;
                }
              </style>
            </head>
            <body>
              ${html || '<p>无可视化内容</p>'}
            </body>
          </html>
        `;
        
        doc.open();
        doc.write(fullHtml);
        doc.close();
      }
    }
  }, [html]);
  
  return (
    <div className="visualization-detail-content">
      <iframe 
        ref={iframeRef}
        title="Visualization Content"
        sandbox="allow-scripts allow-same-origin"
      />
    </div>
  );
};

// 复用CardNode中的引用解析逻辑，支持多种引用格式
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

    const candidates: Array<{ side: 'left' | 'right'; dist: number; pos: number }> = [];
    if (allowLeft) candidates.push({ side: 'left', dist: distLeft, pos: leftPos });
    if (allowRight) candidates.push({ side: 'right', dist: distRight, pos: rightPos });

    if (candidates.length === 0) {
      // 两侧都不允许移动：为避免内部奇数，删除最右侧这对 '**'
      const inner = content.slice(0, rightPos) + content.slice(rightPos + 2);
      return { inner, prefix: '', suffix: '' };
    }

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
  
  // 然后处理 cardId 格式的 citation 标记
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
  const cardIdRegex = /<cardId>(?:(['"]?)([^'"<>]+)\1)(?:<\/cardId>|<cardId\/>|<\/cardId\/>)/g;
  
  // 处理主文本中的 cardId citations
  processedText = processedText.replace(cardIdRegex, (match, quote, cardId) => {
    // 预处理：去除非字母数字字符，只保留有效的 cardId
    const cleanCardId = cardId.replace(/[^a-zA-Z0-9]/g, '');
    const placeholder = `%%CITATION_${citationCounter}%%`;
    citations.push({ cardId: cleanCardId, placeholder });
    citationCounter++;
    return placeholder;
  });
  
  // 处理 excerpt 内容中的 cardId citations
  excerpts.forEach(excerpt => {
    excerpt.content = excerpt.content.replace(cardIdRegex, (match, quote, cardId) => {
      // 预处理：去除非字母数字字符，只保留有效的 cardId
      const cleanCardId = cardId.replace(/[^a-zA-Z0-9]/g, '');
      const placeholder = `%%CITATION_${citationCounter}%%`;
      citations.push({ cardId: cleanCardId, placeholder });
      citationCounter++;
      return placeholder;
    });
  });
  
  // 处理传统的 cite 格式（保持向后兼容）
  // 支持格式：
  // <cite><agent_id>'agentId'<agent_id/><card_id>'cardId'<card_id/><cite/>
  // <cite><agent_id>'agentId'</agent_id><card_id>'cardId'</card_id></cite>
  const citeRegex = /<cite><agent_id>(?:'([^']+)'|([^<]+))(?:<\/agent_id>|<agent_id\/>)<card_id>(?:'([^']+)'|([^<]+))(?:<\/card_id>|<card_id\/>)(?:<\/cite>|<cite\/>)/g;
  
  processedText = processedText.replace(citeRegex, (match, quotedAgentId, unquotedAgentId, quotedCardId, unquotedCardId) => {
    // 优先使用带引号的值，如果没有则使用不带引号的值
    const cardId = quotedCardId || unquotedCardId;
    // 预处理：去除非字母数字字符，只保留有效的 cardId
    const cleanCardId = cardId.replace(/[^a-zA-Z0-9]/g, '');
    
    const placeholder = `%%CITATION_${citationCounter}%%`;
    citations.push({ cardId: cleanCardId, placeholder });
    citationCounter++;
    return placeholder;
  });
  
  // 处理 excerpt 内容中的传统 cite 格式
  excerpts.forEach(excerpt => {
    excerpt.content = excerpt.content.replace(citeRegex, (match, quotedAgentId, unquotedAgentId, quotedCardId, unquotedCardId) => {
      const cardId = quotedCardId || unquotedCardId;
      // 预处理：去除非字母数字字符，只保留有效的 cardId
      const cleanCardId = cardId.replace(/[^a-zA-Z0-9]/g, '');
      
      const placeholder = `%%CITATION_${citationCounter}%%`;
      citations.push({ cardId: cleanCardId, placeholder });
      citationCounter++;
      return placeholder;
    });
  });
  
  // 处理 highlight 内容中的 cardId citations
  highlights.forEach(highlight => {
    highlight.content = highlight.content.replace(cardIdRegex, (match, quote, cardId) => {
      // 预处理：去除非字母数字字符，只保留有效的 cardId
      const cleanCardId = cardId.replace(/[^a-zA-Z0-9]/g, '');
      const placeholder = `%%CITATION_${citationCounter}%%`;
      citations.push({ cardId: cleanCardId, placeholder });
      citationCounter++;
      return placeholder;
    });
  });
  
  // 处理 highlight 内容中的传统 cite 格式
  highlights.forEach(highlight => {
    highlight.content = highlight.content.replace(citeRegex, (match, quotedAgentId, unquotedAgentId, quotedCardId, unquotedCardId) => {
      const cardId = quotedCardId || unquotedCardId;
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

// 根据 card type 获取对应的颜色（与 ChatView 中的 getCircleBackgroundColor 保持一致）
const getCardColor = (cardType: string): string => {
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

// 引用块组件 - 修改为点击切换方案，简化参数
const CitationBlock: React.FC<{
  cardId: string;
  currentAgentId?: string;
  citationIndex: number;
  onClick: (citationInfo: { agentId: string; cardId: string; content: any } | null) => void;
  onHover?: (payload: { cardId: string; color?: string } | null) => void; // 新增：悬浮回调
}> = ({ cardId, currentAgentId, citationIndex, onClick, onHover }) => {
  // 获取被引用的卡片信息
  const getReferencedCard = () => {
    try {
      const referencedCard = cardStore.getCard(cardId);
      if (referencedCard) {
        return referencedCard;
      }
    } catch (error) {
      console.error('Error getting referenced card:', error);
    }
    return null;
  };
  
  const referencedCard = getReferencedCard();
  
  const handleClick = () => {
    if (referencedCard) {
      onClick({
        agentId: currentAgentId || 'unknown',
        cardId,
        content: referencedCard
      });
    } else {
      onClick({
        agentId: currentAgentId || 'unknown',
        cardId,
        content: { error: `找不到卡片 ${cardId}` }
      });
    }
  };

  // 处理悬浮事件（照抄 ChatView 的逻辑）
  const handleMouseEnter = () => {
    if (referencedCard) {
      const cardColor = getCardColor(referencedCard.card_type);
      onHover?.({
        cardId,
        color: cardColor
      });
    }
  };

  const handleMouseLeave = () => {
    onHover?.(null);
  };
  
  if (!referencedCard) {
    return (
      <span 
        className="citation-error"
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        style={{ cursor: 'pointer' }}
      >
        [引用错误: 找不到卡片 {cardId}]
      </span>
    );
  }
  
  return (
    <span 
      className="citation-block"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ cursor: 'pointer' }}
    >
      {citationIndex}
    </span>
  );
};

// 带引用的Markdown组件，支持cardId和excerpt格式
const MarkdownWithCitations: React.FC<{
  content: string;
  currentAgentId?: string;
  onCitationClick: (citationInfo: { agentId: string; cardId: string; content: any } | null) => void;
  parentCitations?: Array<{ cardId: string; placeholder: string }>;
  parentCardIdToIndex?: Map<string, number>;
  onCitationHover?: (payload: { cardId: string; color?: string } | null) => void;
  isInline?: boolean; // 新增：是否在 inline 上下文中（用于避免段落嵌套）
}> = ({ content, currentAgentId, onCitationClick, parentCitations = [], parentCardIdToIndex, onCitationHover, isInline = false }) => {
  const { processedText, citations, excerpts, highlights } = parseCitationTags(content);

  const allCitations = [...parentCitations, ...citations];
  const cardIdToIndex = new Map<string, number>(parentCardIdToIndex || []);
  allCitations.forEach((citation) => {
    if (!cardIdToIndex.has(citation.cardId)) {
      cardIdToIndex.set(citation.cardId, cardIdToIndex.size + 1);
    }
  });

  const processNode = (node: any, keyPrefix: string): React.ReactNode => {
    if (node.type === 'text') {
      const parts = node.value.split(/(%%(?:CITATION|EXCERPT|HIGHLIGHT)_\d+%%)/);
      
      const result = parts.map((part: string, index: number) => {
        const citation = allCitations.find(c => c.placeholder === part);
        if (citation) {
          const citationIndex = cardIdToIndex.get(citation.cardId) || 1;
          return (
            <CitationBlock
              key={`${keyPrefix}-citation-${index}`}
              cardId={citation.cardId}
              currentAgentId={currentAgentId}
              citationIndex={citationIndex}
              onClick={onCitationClick}
              onHover={onCitationHover}
            />
          );
        }
        
        const excerpt = excerpts.find(e => e.placeholder === part);
        if (excerpt) {
          return (
            <blockquote key={`${keyPrefix}-excerpt-${index}`} className="excerpt-block">
              <MarkdownWithCitations 
                content={excerpt.content} 
                currentAgentId={currentAgentId}
                onCitationClick={onCitationClick}
                parentCitations={allCitations}
                parentCardIdToIndex={cardIdToIndex}
                onCitationHover={onCitationHover}
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
                onCitationClick={onCitationClick}
                parentCitations={allCitations}
                parentCardIdToIndex={cardIdToIndex}
                onCitationHover={onCitationHover}
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
      if (node.tagName === 'img') {
        return null;
      }
      
      const Tag = node.tagName as keyof JSX.IntrinsicElements;
      const { key, ...otherProps } = {
        ...node.properties,
        key: keyPrefix,
      };
      
      const voidElements = ['br', 'hr', 'input', 'area', 'base', 'col', 'embed', 'link', 'meta', 'param', 'source', 'track', 'wbr'];
      if (voidElements.includes(node.tagName)) {
        return <Tag key={keyPrefix} {...otherProps} />;
      }
      
      const children = node.children.map((child: any, index: number) => processNode(child, `${keyPrefix}-${index}`));
      return <Tag key={keyPrefix} {...otherProps}>{children}</Tag>;
    }

    return null;
  };

  const filterWhitespaceNodes = (children: React.ReactNode[]): React.ReactNode[] => {
    const filtered: React.ReactNode[] = [];

    children.forEach((child) => {
      if (child == null) return;

      if (typeof child === 'string') {
        if (child.trim() !== '') filtered.push(child);
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

  const createElementRenderer = (tagName: string) => (element: any) => {
    const { node } = element;
    const Tag = tagName as keyof JSX.IntrinsicElements;
    const stableKey = node.properties?.key || `${tagName}-${Math.random()}`;
    const { key, ...otherProps } = { ...node.properties, key: stableKey };
    const children = node.children.map((child: any, index: number) => processNode(child, `${tagName}-${index}`));
    return <Tag key={stableKey} {...otherProps}>{children}</Tag>;
  };

  const customRenderers = {
    p: (paragraph: any) => {
      const { node } = paragraph;
      const children = node.children.map((child: any, index: number) => 
        processNode(child, `p-${index}`)
      );
      
      // 如果在 inline 上下文中，将段落渲染为 span 以避免嵌套
      if (isInline) {
        return <span className="inline-paragraph">{children}</span>;
      }
      
      // 检查是否包含 highlight span（可能包含嵌套的段落）
      const hasHighlight = React.Children.toArray(children).some((child: any) => 
        React.isValidElement(child) && 
        child.type === 'span' && 
        (child.props as any)?.className === 'trace-support-highlight'
      );
      
      if (hasHighlight) {
        return <div className="paragraph-with-blockquote">{children}</div>;
      }
      
      return <p>{children}</p>;
    },
    li: (listItem: any) => {
      const { node } = listItem;
      const children = node.children.map((child: any, index: number) => 
        processNode(child, `li-${index}`)
      );
      return <li>{children}</li>;
    },
    h1: createElementRenderer('h1'),
    h2: createElementRenderer('h2'),
    h3: createElementRenderer('h3'),
    h4: createElementRenderer('h4'),
    h5: createElementRenderer('h5'),
    h6: createElementRenderer('h6'),
    strong: createElementRenderer('strong'),
    em: createElementRenderer('em'),
    code: createElementRenderer('code'),
    pre: createElementRenderer('pre'),
    blockquote: createElementRenderer('blockquote'),
    ul: createElementRenderer('ul'),
    ol: createElementRenderer('ol'),
    a: createElementRenderer('a'),
    img: () => null,
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

  return (
    <div className="markdown-body">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={customRenderers}>
        {processedText}
      </ReactMarkdown>
    </div>
  );
};



interface DetailViewProps {
  card: Card;
  agentId: string;
  onClose: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
  onCitationHover?: (payload: { cardId: string; color?: string } | null) => void; // 新增：引用悬浮回调
  onCitationClick?: (cardId: string) => void; // 新增：引用点击回调
  onTraceProcessStart?: (payload: { cardTitle: string; cardType?: string; position?: { x: number; y: number } }) => void;
  isTraceProcessBusy?: boolean;
  onTraceProcessBlocked?: () => void;
}

const DetailView: React.FC<DetailViewProps> = ({
  card,
  agentId,
  onClose,
  isFullscreen = false,
  onToggleFullscreen,
  onCitationHover,
  onCitationClick,
  onTraceProcessStart,
  isTraceProcessBusy = false,
  onTraceProcessBlocked,
}) => {
  const detailViewRef = useRef<HTMLDivElement>(null);
  const detailContentRef = useRef<HTMLDivElement>(null);
  const firstHighlightScrolledRef = useRef<{ cardId?: string; done: boolean }>({ cardId: undefined, done: false });
  
  // 检查是否为 trace_result 卡片，如果是则使用原卡片的信息（与 CardNode 保持一致）
  const isTraceResultCard = card.card_type === 'trace_result';
  const traceHostCardType = isTraceResultCard ? card.card_content?.trace_host_card_type : undefined;
  const renderCardType = isTraceResultCard && traceHostCardType ? traceHostCardType : card.card_type;
  const renderCardContent = isTraceResultCard
    ? card.card_content?.trace_host_card_content || card.card_content
    : card.card_content;

  
  // 跟踪 citation 的悬浮状态（与 ChatView 的 hoveredToolMessageId 机制一致）
  const [hoveredCitationId, setHoveredCitationId] = useState<string | null>(null);
  // 使用 ref 存储按钮状态，避免触发 React 重新渲染导致文本选择丢失
  const traceButtonRef = useRef<HTMLButtonElement>(null);
  const traceButtonStateRef = useRef<{ visible: boolean; top: number; left: number }>({
    visible: false,
    top: 0,
    left: 0,
  });

  const hideTraceButton = useCallback(() => {
    const button = traceButtonRef.current;
    if (button) {
      button.style.display = 'none';
      traceButtonStateRef.current.visible = false;
    }
  }, []);

  const updateTraceButtonPosition = useCallback(() => {
    const selection = window.getSelection();
    const contentEl = detailContentRef.current;
    const containerEl = detailViewRef.current;
    const button = traceButtonRef.current;

    if (
      !selection ||
      selection.isCollapsed ||
      !contentEl ||
      !containerEl ||
      !button ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !contentEl.contains(selection.anchorNode) ||
      !contentEl.contains(selection.focusNode)
    ) {
      hideTraceButton();
      return;
    }

    if (selection.rangeCount === 0) {
      hideTraceButton();
      return;
    }

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const containerRect = containerEl.getBoundingClientRect();

    if (!rect || (rect.width === 0 && rect.height === 0)) {
      hideTraceButton();
      return;
    }

    const buttonWidth = 120;
    const buttonHeight = 36;
    const offset = 6;

    let top = rect.bottom - containerRect.top + offset;
    let left = rect.right - containerRect.left + offset;

    if (top > containerRect.height - buttonHeight - 8) {
      top = containerRect.height - buttonHeight - 8;
    }
    if (top < 8) {
      top = 8;
    }

    left = Math.min(Math.max(left, 8), containerRect.width - buttonWidth - 8);

    // 直接操作 DOM，不触发 React 重新渲染
    button.style.display = 'flex';
    button.style.top = `${top}px`;
    button.style.left = `${left}px`;
    traceButtonStateRef.current = {
      visible: true,
      top,
      left,
    };
  }, []);

  useEffect(() => {
    const handleSelectionUpdate = () => {
      requestAnimationFrame(updateTraceButtonPosition);
    };

    const handleMouseDown = (event: MouseEvent) => {
      if (detailViewRef.current && !detailViewRef.current.contains(event.target as Node)) {
        hideTraceButton();
      }
    };

    document.addEventListener('mouseup', handleSelectionUpdate);
    document.addEventListener('keyup', handleSelectionUpdate);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mouseup', handleSelectionUpdate);
      document.removeEventListener('keyup', handleSelectionUpdate);
      document.removeEventListener('mousedown', handleMouseDown);
    };
  }, [hideTraceButton, updateTraceButtonPosition]);

  useEffect(() => {
    const contentEl = detailContentRef.current;
    if (!contentEl) {
      return;
    }

    const handleScroll = () => {
      hideTraceButton();
    };

    contentEl.addEventListener('scroll', handleScroll);

    return () => {
      contentEl.removeEventListener('scroll', handleScroll);
    };
  }, []);
  
  const getUnderlyingCardId = () => {
    if (card.card_type === 'trace_result') {
      const hostId = card.card_content?.trace_host_card_id;
      return typeof hostId === 'string' ? hostId : null;
    }
    return typeof card.card_id === 'string' ? card.card_id : null;
  };
  
  // 添加至引用处理函数（迁移自 CardNode 的加号功能）
  const handleAddToReference = () => {
    const targetCardId = getUnderlyingCardId();
    // 仅在 card_id 为有效字符串时才添加到引用，避免类型错误
    if (window.addCardToReference && targetCardId) {
      // 检测当前是否有选中的文本
      let selectedContent: string | null = null;
      const selection = window.getSelection();
      
      if (selection && selection.toString().trim().length > 0) {
        // 获取选中的文本，去除首尾空白
        selectedContent = selection.toString().trim();
      }
      
      // 调用全局函数，传入 card_id 和选中的文本（如果有）
      window.addCardToReference(agentId, targetCardId, selectedContent);
    } 
  };
  
  // 处理引用点击事件 - 聚焦到对应的卡片
  const handleCitationClick = (info: { agentId: string; cardId: string; content: any } | null) => {
    if (info && info.cardId && onCitationClick) {
      onCitationClick(info.cardId);
    }
  };
  
  // 包装的 hover 处理函数（与 ChatView 的机制一致）
  const handleCitationHover = (payload: { cardId: string; color?: string } | null) => {
    if (payload) {
      // 鼠标进入：只在状态不同时才更新，避免不必要的重新渲染
      if (hoveredCitationId !== payload.cardId) {
        setHoveredCitationId(payload.cardId);
        onCitationHover?.(payload);
      }
    } else {
      // 鼠标离开：只在有 hover 状态时才清除
      if (hoveredCitationId !== null) {
        setHoveredCitationId(null);
        onCitationHover?.(null);
      }
    }
  };
  
  // 确保在组件卸载时正确清除 hover 状态
  useEffect(() => {
    return () => {
      // 组件卸载时清除 hover 状态
      if (hoveredCitationId !== null) {
        onCitationHover?.(null);
      }
    };
  }, [hoveredCitationId, onCitationHover]);

  // 当打开新的 DetailView 时，重置滚动位置到顶部
  useEffect(() => {
    const contentArea = detailContentRef.current;
    if (!contentArea) {
      return;
    }
    
    // 立即重置滚动位置到顶部
    contentArea.scrollTop = 0;
  }, [card.card_id]); // 依赖 card.card_id，当打开不同的卡片时重置

  // 打开 trace_result 时自动滚动到首个高亮
  useEffect(() => {
    if (!isTraceResultCard) {
      firstHighlightScrolledRef.current = { cardId: card.card_id ?? undefined, done: false };
      return;
    }
    const currentId = card.card_id ?? undefined;
    if (firstHighlightScrolledRef.current.cardId !== currentId) {
      firstHighlightScrolledRef.current = { cardId: currentId, done: false };
    }
    if (firstHighlightScrolledRef.current.done) return;

    const timer = setTimeout(() => {
      const contentEl = detailContentRef.current;
      if (!contentEl) return;
      const firstHl = contentEl.querySelector('.trace-support-highlight') as HTMLElement | null;
      if (firstHl) {
        firstHl.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
        firstHighlightScrolledRef.current.done = true;
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [isTraceResultCard, card.card_id]);

  
  // 处理鼠标离开 DetailView 容器时清除 hover 状态
  const handleDetailViewMouseLeave = (event: React.MouseEvent) => {
    // 检查鼠标是否真的离开了 DetailView（而不是移动到子元素）
    const relatedTarget = event.relatedTarget;
    if (relatedTarget && detailViewRef.current) {
      // 确保 relatedTarget 是 Node 类型（Element 继承自 Node）
      if (relatedTarget instanceof Node) {
        // 如果 relatedTarget 不在 DetailView 内部，说明鼠标真的离开了
        if (!detailViewRef.current.contains(relatedTarget)) {
          if (hoveredCitationId !== null) {
            setHoveredCitationId(null);
            onCitationHover?.(null);
          }
        }
      } else {
        // 如果 relatedTarget 不是 Node 类型，清除 hover 状态
        if (hoveredCitationId !== null) {
          setHoveredCitationId(null);
          onCitationHover?.(null);
        }
      }
    } else {
      // 如果没有 relatedTarget（比如鼠标移到了窗口外），清除 hover 状态
      if (hoveredCitationId !== null) {
        setHoveredCitationId(null);
        onCitationHover?.(null);
      }
    }
  };
  
  
  const cardTypeDescription = card.displayed_card_type || renderCardContent?.card_type_description || renderCardType;
  
  // 获取卡片标题
  const getCardTitle = () => {
    return renderCardContent?.card_title || renderCardType || '未命名卡片';
  };
  
  // 根据 card_type 获取类型标签的颜色（参考 CardNode.tsx 的配色）
  const getCardTypeClassName = () => {
    const type = renderCardType || 'default';
    return `detail-card-type-badge type-${type}`;
  };

  // 与 CardNode 中的 displayCardContent 完全对齐的内容渲染逻辑
  const displayCardContent = () => {
    // user_requirement 类型的特殊布局
    if (renderCardType === 'user_requirement') {
      // 只使用 reference_list
      const referenceList: CardReference[] = renderCardContent?.reference_list || [];
      const userRequirementText = (renderCardContent?.user_requirement || renderCardContent?.card_title || '用户需求内容')
        // 去掉前后的空白字符，避免前面多出空行
        .replace(/^\s+/, '');

      return (
        <div className="user-requirement-content">
          {/* 第一行：图标和文字 */}
          <div className="user-requirement-main">
            <div className="user-requirement-icon">
              <img src="/resource/user_requirement_dark.svg" alt="user_requirement" className="content-icon" />
            </div>
            <div className="user-requirement-text">
              {userRequirementText}
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
    
    // visualization 类型的特殊布局
    if (renderCardType === 'visualization') {
      const htmlContent = renderCardContent?.html || '';
      
      return (
        <div className="visualization-content">
          <div className="visualization-icon">
            <img src="/resource/visualization.svg" alt="visualization" className="content-icon" />
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
    
    // target_task 类型的特殊布局
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
    
    // webpage 类型的特殊布局
    if (renderCardType === 'webpage') {
      const url = renderCardContent?.url || '';
      const summary = renderCardContent?.summary || '';
      let rawMarkdownContent: string | undefined;
      if (isTraceResultCard) {
        rawMarkdownContent = (card.card_content as any)?.card_main_content_with_highlight;
        if (!rawMarkdownContent || (typeof rawMarkdownContent === 'string' && rawMarkdownContent.trim() === '')) {
          rawMarkdownContent = renderCardContent?.markdown_convert_from_webpage;
        }
      } else {
        rawMarkdownContent = renderCardContent?.markdown_convert_from_webpage;
      }
      let markdownContent = typeof rawMarkdownContent === 'string' ? rawMarkdownContent : '';
      // 如果长度超过 50000，截断为前 50000 个字符
      if (markdownContent.length > 50000) {
        markdownContent = markdownContent.slice(0, 50000);
      }
      
      const getFaviconUrl = (url: string) => {
        try {
          const domain = new URL(url).hostname;
          return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
        } catch {
          return '/resource/webpage.svg';
        }
      };
      
      return (
        <div className="webpage-content">
          {/* 第一部分：URL 部分 - icon 在左，链接在右 */}
          <div className="webpage-url-section">
            <img 
              src={getFaviconUrl(url)} 
              alt="favicon" 
              className="webpage-favicon"
              onError={(e) => {
                (e.target as HTMLImageElement).src = '/resource/webpage.svg';
              }}
            />
            <a 
              href={url} 
              target="_blank" 
              rel="noopener noreferrer" 
              className="webpage-url"
            >
              {url}
            </a>
          </div>
          
          {/* <div className="webpage-summary-section">
            <img src="/resource/cite.svg" alt="引用" className="quote-icon" />
            <div className="webpage-summary">{summary}</div>
          </div> */}
          
          {/* 第三部分：完整的文本 */}
          {markdownContent && (
            <div className="webpage-markdown-section">
              <MarkdownWithCitations 
                content={markdownContent} 
                currentAgentId={agentId}
                onCitationClick={handleCitationClick}
                onCitationHover={handleCitationHover}
              />
            </div>
          )}
        </div>
      );
    }
    
    // note / report 类型的特殊布局（与 CardNode 中 note 的展示一致）
    if (renderCardType === 'note' || renderCardType === 'report') {
      const summary = renderCardContent?.summary || '';
      let markdownWithCite: string;
      if (isTraceResultCard) {
        markdownWithCite = (card.card_content as any)?.card_main_content_with_highlight;
        if (!markdownWithCite || (typeof markdownWithCite === 'string' && markdownWithCite.trim() === '')) {
          markdownWithCite = renderCardContent?.markdown_with_cite || '';
        } else {
          markdownWithCite = typeof markdownWithCite === 'string' ? markdownWithCite : '';
        }
      } else {
        markdownWithCite = renderCardContent?.markdown_with_cite || '';
      }
      
      return (
        <div className="report-content">
          {/* <div className="report-summary-section">
            <img src="/resource/cite.svg" alt="引用" className="quote-icon" />
            <div className="report-summary">{summary}</div>
          </div> */}
          
          {/* Markdown 内容 */}
          <div className="report-markdown-section">
            <MarkdownWithCitations 
              content={markdownWithCite} 
              currentAgentId={agentId}
              onCitationClick={handleCitationClick}
              onCitationHover={handleCitationHover}
            />
          </div>
        </div>
      );
    }
    
    // web_search / web_search_result 类型的特殊布局
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
      }
      
      return (
        <div className="web-search-content">
          {/* 搜索框 */}
          <div className="search-box">
            <img src="/resource/web_search_dark.svg" alt="search" className="search-icon" />
            <div className="search-query">
              {searchQuery}
            </div>
          </div>
          
          {/* 搜索结果列表 */}
          <div className="search-results">
            {searchResultList.map((result: any, index: number) => (
              <div key={index} className="search-result-item">
                <div className="result-number">{index + 1}</div>
                <div className="result-content">
                  <div className="result-title">
                    {websearchWithHighlight(result.title || '')}
                  </div>
                  <a 
                    href={result.url} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="result-url"
                  >
                    {result.url}
                  </a>
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

  const getSelectedContent = () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) {
      return selection.toString().trim();
    }
    return '';
  };

  const handleTraceSelection = () => {
    if (isTraceProcessBusy) {
      onTraceProcessBlocked?.();
      return;
    }

    const projectId = historyStore.currentProjectId;
    const cardId = getUnderlyingCardId();

    if (!projectId || !cardId) {
      console.warn('Trace source requires valid project and card identifiers.');
      return;
    }

    const selectedContent = getSelectedContent();

    // 计算当前 Trace 按钮在视口中的"右侧"绝对位置，
    // 用于让 traceProcess 的右半部分与按钮对齐
    let anchorX = 16;
    let anchorY = 16;
    const containerEl = detailViewRef.current;
    const TRACE_BUTTON_WIDTH = 120; // 与 updateTraceButtonPosition 中的 buttonWidth 保持一致

    if (containerEl) {
      const containerRect = containerEl.getBoundingClientRect();
      const buttonState = traceButtonStateRef.current;
      anchorX = containerRect.left + buttonState.left + TRACE_BUTTON_WIDTH;
      anchorY = containerRect.top + buttonState.top;
    }

    api.traceSource(projectId, cardId, selectedContent);
    onTraceProcessStart?.({
      cardTitle: getCardTitle(),
      cardType: card.card_type,
      position: { x: anchorX, y: anchorY },
    });

    // 点击 Trace 后清空当前文本选区，并隐藏 Trace 按钮
    const selection = window.getSelection();
    if (selection && selection.removeAllRanges) {
      selection.removeAllRanges();
    }
    hideTraceButton();
  };
  
  return (
    <Paper
      ref={detailViewRef}
      className={`detail-view ${isFullscreen ? 'detail-view-fullscreen' : ''}`}
      elevation={3}
      onMouseLeave={handleDetailViewMouseLeave}
    >
      {/* 右上角操作按钮 - 固定在 DetailView 内，不随内容滚动 */}
      <Box className="detail-actions-top-right">
        <IconButton 
          onClick={onToggleFullscreen} 
          size="small" 
          className="detail-action-button"
          sx={{ borderRadius: 1 }}
        >
            {isFullscreen ? <FullscreenExitIcon /> : <FullscreenIcon />}
          </IconButton>
        <IconButton 
          onClick={onClose} 
          size="small" 
          className="detail-action-button"
          sx={{ borderRadius: 1 }}
        >
            <CloseIcon />
          </IconButton>
      </Box>
      
      {/* 可滚动内容区域 */}
      <Box className="detail-content" ref={detailContentRef}>
        {/* 卡片类型标签（左对齐圆角矩形） */}
        {isTraceResultCard ? (
          <Box sx={{ display: 'flex', gap: 1, mb: 2 }}>
            {/* 左边的 Trace Result 标签 */}
            <Box 
              className="detail-card-type-badge"
              sx={{
                backgroundColor: '#FF9900 !important',
                color: '#ffffff !important',
                marginBottom: 0,
              }}
            >
              Trace Result
            </Box>
            {/* 右边的原卡片类型标签 */}
            <Box 
              className={getCardTypeClassName()}
              sx={{ marginBottom: 0 }}
            >
              {cardTypeDescription}
            </Box>
          </Box>
        ) : (
        <Box className={getCardTypeClassName()}>
          {cardTypeDescription}
        </Box>
        )}

        {/* 卡片标题 */}
        <Typography variant="h5" className="detail-card-title" sx={{ mb: 2, fontWeight: 600 }}>
          {getCardTitle()}
        </Typography>
        
        {/* 与 CardNode 一致的详情内容展示 */}
        {displayCardContent()}
      </Box>

      {/* 右下角 Refer in Chat 按钮 - 固定在 DetailView 内，不随内容滚动 */}
      <button 
        className="refer-in-chat-button"
        onClick={handleAddToReference}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            transform: 'translateY(1px)',
          }}
        >
          <span
            style={{
              fontSize: '24px',
              lineHeight: 1,
              marginRight: '6px',
              display: 'inline-block',
            }}
          >
            +
          </span>
          Refer in Chat
        </span>
      </button>

      {/* Trace 按钮：始终渲染但通过 DOM 操作控制显示/隐藏，避免触发 React 重新渲染导致文本选择丢失 */}
      <button
        ref={traceButtonRef}
        type="button"
        className="trace-selection-button"
        style={{ display: 'none', top: 0, left: 0 }}
        onClick={handleTraceSelection}
      >
        <img src="/resource/trace_dark.svg" alt="Trace icon" />
        <span>Trace</span>
      </button>
    </Paper>
  );
};

export default DetailView;