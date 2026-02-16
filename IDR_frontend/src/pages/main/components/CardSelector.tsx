import React, { useState, useEffect, useRef } from 'react';
import { Box, List, ListItem, ListItemText, Typography, Paper } from '@mui/material';
import ReactMarkdown from 'react-markdown';
import { chatStore, cardStore } from '../../../stores';
import type { Card, CardRef, CardContent } from '../../../stores/CardType';
import './CardSelector.scss';

interface CardSelectorProps {
  isVisible: boolean;
  position: { top: number; left: number };
  searchTerm: string;
  onSelectCard: (cardRef: CardRef) => void;
  onClose: () => void;
}

interface CardWithAgent {
  card: Card;
  cardId: string;
  card_content: CardContent;
}

const CardSelector: React.FC<CardSelectorProps> = ({
  isVisible,
  position,
  searchTerm,
  onSelectCard,
  onClose
}) => {
  const [filteredCards, setFilteredCards] = useState<CardWithAgent[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [internalSearchTerm, setInternalSearchTerm] = useState('');
  const selectorRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // 处理 markdown 内容，移除引用标签，默认不截断内容
  const processMarkdownContent = (content: string, maxLength?: number): string => {
    if (!content) return '';
    
    let processedContent = content;
    
    // 移除各种引用标签格式
    // 1. 移除复杂的引用格式 <cite><agent_id>'数字'<agent_id/><card_id>'数字'<card_id/><cite/>
    processedContent = processedContent.replace(/<cite><agent_id>'[^']*'<agent_id\/><card_id>'[^']*'<card_id\/><cite\/>/g, '');
    
    // 2. 移除其他可能的复杂引用格式
    processedContent = processedContent.replace(/<cite>[\s\S]*?<agent_id[^>]*>[\s\S]*?<agent_id\/>[\s\S]*?<card_id[^>]*>[\s\S]*?<card_id\/>[\s\S]*?<cite\/>/g, '');
    
    // 3. 移除标准的 <cite>...</cite> 标签（包括嵌套内容）
    processedContent = processedContent.replace(/<cite>[\s\S]*?<\/cite>/g, '');
    
    // 4. 移除自闭合的 <cite/> 标签
    processedContent = processedContent.replace(/<cite[^>]*\/>/g, '');
    
    // 5. 移除带有属性的 <cite>...</cite> 标签
    processedContent = processedContent.replace(/<cite[^>]*>[\s\S]*?<\/cite>/g, '');
    
    // 6. 移除引用占位符 __CITATION_\d+__
    processedContent = processedContent.replace(/__CITATION_\d+__/g, '');
    
    // 7. 移除可能存在的引用标记 [1], [2], etc.
    processedContent = processedContent.replace(/\[\d+\]/g, '');
    
    // 8. 移除可能存在的引用链接格式 [text](link)
    processedContent = processedContent.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
    
    // 9. 移除多余的空白字符、换行符和制表符
    processedContent = processedContent
      .replace(/\s+/g, ' ')
      .replace(/\n+/g, ' ')
      .replace(/\t+/g, ' ')
      .trim();
    
    // 10. 只有在指定了 maxLength 时才截断内容
    if (maxLength && processedContent.length > maxLength) {
      processedContent = processedContent.substring(0, maxLength) + '...';
    }
    
    return processedContent;
  };

  // 获取所有可用的卡片
  const getAllCards = (): CardWithAgent[] => {
    const allCards: CardWithAgent[] = [];
    
    Object.values(cardStore.cards).forEach(card => {
      if (card.card_id) {
        allCards.push({
          card,
          cardId: card.card_id,
          card_content: card.card_content
        });
      }
    });
    
    return allCards;
  };

  // 获取卡片的可搜索文本内容
  const getSearchableContent = (card: Card): string => {
    let content = '';
    
    // 根据卡片类型获取 markdown 内容
    if (card.card_type === 'report' && card.card_content?.markdown_with_cite) {
      content = card.card_content.markdown_with_cite;
    } else if (card.card_type === 'webpage' && card.card_content?.markdown_convert_from_webpage) {
      content = card.card_content.markdown_convert_from_webpage;
    } else if (card.card_content?.card_type_description) {
      content = card.card_content.card_type_description;
    }
    
    // 移除引用标签和清理内容，但保留更多文本用于搜索
    if (content) {
      return processMarkdownContent(content, 1000); // 使用更大的长度限制用于搜索
    }
    
    return card.card_type || '';
  };

  // 过滤卡片
  useEffect(() => {
    const allCards = getAllCards();
    
    // 使用内部搜索词进行过滤
    const currentSearchTerm = internalSearchTerm.trim();
    
    // 如果搜索词为空，显示所有卡片
    if (!currentSearchTerm) {
      setFilteredCards(allCards);
      setSelectedIndex(0);
      return;
    }
    
    const filtered = allCards.filter(({ card }) => {
      const searchLower = currentSearchTerm.toLowerCase();
      
      // 根据 markdown 内容进行搜索
      const searchableContent = getSearchableContent(card);
      const contentMatch = searchableContent.toLowerCase().includes(searchLower);
      
      // 根据卡片类型进行搜索
      const cardTypeMatch = card.card_type.toLowerCase().includes(searchLower);
      
      // 返回任意一个匹配的结果
      return contentMatch || cardTypeMatch;
    });
    
    setFilteredCards(filtered);
    setSelectedIndex(0);
  }, [internalSearchTerm]);

  // 当选择器显示时自动聚焦搜索框并刷新卡片列表
  useEffect(() => {
    if (isVisible && searchInputRef.current) {
      // 刷新卡片列表
      const allCards = getAllCards();
      setFilteredCards(allCards);
      setSelectedIndex(0);
      
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  }, [isVisible]);

  // 处理键盘事件
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isVisible) return;
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex(prev => 
            prev < filteredCards.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex(prev => prev > 0 ? prev - 1 : 0);
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredCards[selectedIndex]) {
            const { card } = filteredCards[selectedIndex];
            if (card.card_id) {
              onSelectCard(card.card_id);
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    };

    if (isVisible) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [isVisible, selectedIndex, filteredCards, onSelectCard, onClose]);

  // 点击外部关闭
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isVisible) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isVisible, onClose]);

  
  if (!isVisible) {
    return null;
  }

  return (
    <Paper
      ref={selectorRef}
      className="card-selector"
      style={{
        position: 'absolute',
        top: position.top,
        left: position.left,
        zIndex: 1000,
        maxHeight: '300px',
        overflowY: 'auto',
        minWidth: '300px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
      }}
    >
      <Box className="card-selector-header">
        <Typography variant="caption" className="selector-title">
          选择卡片引用
        </Typography>
        <input
          ref={searchInputRef}
          type="text"
          className="card-selector-search-input"
          placeholder="搜索卡片内容或类型..."
          value={internalSearchTerm}
          onChange={(e) => setInternalSearchTerm(e.target.value)}
          onKeyDown={(e) => {
            // 防止搜索框的键盘事件冒泡到全局键盘处理
            e.stopPropagation();
          }}
        />
      </Box>
      
      <List dense className="card-list">
        {filteredCards.map(({ card, cardId, card_content }, index) => (
          <ListItem 
            key={card.card_id}
            className={`card-item ${index === selectedIndex ? 'selected' : ''}`}
            onClick={() => {
              if (card.card_id) {
                onSelectCard(card.card_id);
              }
            }}
            sx={{
              cursor: 'pointer',
              backgroundColor: index === selectedIndex ? '#e3f2fd' : 'transparent',
              '&:hover': {
                backgroundColor: index === selectedIndex ? '#e3f2fd' : '#f5f5f5'
              }
            }}
          >
            <ListItemText
              primary={
                  <Box className="card-info">
                    <Typography variant="caption" className="agent-info" style={{ fontWeight: 'bold' }}>
                      Card: {cardId}
                    </Typography>
                  </Box>
              }
              secondary={
                <Box className="card-content-preview">
                  {(() => {
                    // 根据卡片类型获取 markdown 内容
                    let markdownContent = '';
                    if (card.card_type === 'report' && card.card_content?.markdown_with_cite) {
                      markdownContent = card.card_content.markdown_with_cite;
                    } else if (card.card_type === 'webpage' && card.card_content?.markdown_convert_from_webpage) {
                      markdownContent = card.card_content.markdown_convert_from_webpage;
                    } else if (card.card_content?.card_type_description) {
                      markdownContent = card.card_content.card_type_description;
                    }
                    
                    if (markdownContent) {
                      const processedContent = processMarkdownContent(markdownContent); // 移除引用标签但保留完整内容
                      return (
                        <div className="card-content-markdown">
                          <ReactMarkdown 
                            components={{
                              // 简化渲染，移除所有加粗和强调效果
                              p: ({ children }) => <span>{children}</span>,
                              strong: ({ children }) => <span>{children}</span>,
                              b: ({ children }) => <span>{children}</span>,
                              em: ({ children }) => <span>{children}</span>,
                              i: ({ children }) => <span>{children}</span>,
                              h1: ({ children }) => <span>{children}</span>,
                              h2: ({ children }) => <span>{children}</span>,
                              h3: ({ children }) => <span>{children}</span>,
                              h4: ({ children }) => <span>{children}</span>,
                              h5: ({ children }) => <span>{children}</span>,
                              h6: ({ children }) => <span>{children}</span>,
                              code: ({ children }) => <code>{children}</code>,
                            }}
                          >
                            {processedContent}
                          </ReactMarkdown>
                        </div>
                      );
                    } else {
                      return (
                        <Typography variant="caption" className="card-type">
                          {card.card_type}
                        </Typography>
                      );
                    }
                  })()}
                </Box>
              }
            />
          </ListItem>
        ))}
      </List>
      
      {filteredCards.length === 0 && (
        <Box className="no-results">
          <Typography variant="body2" color="text.secondary">
            {Object.keys(cardStore.cards).length === 0 
              ? "没有找到任何卡片数据" 
              : "没有找到匹配的卡片"
            }
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            搜索条件: "{internalSearchTerm}"
          </Typography>
          {Object.keys(cardStore.cards).length === 0 && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              请确保：
              <br />1. 后端服务已启动
              <br />2. 已开始一个研究项目
              <br />3. WebSocket连接正常
            </Typography>
          )}
        </Box>
      )}
    </Paper>
  );
};

export default CardSelector;
