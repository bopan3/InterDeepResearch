import React, { useState, useEffect } from 'react';
import { TextField, Button, Chip, Box, Typography, IconButton } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';
import CloseIcon from '@mui/icons-material/Close';
import TouchAppIcon from '@mui/icons-material/TouchApp';
import api from '../../../api';
import './ActionInputBox.scss';

interface ActionInputBoxProps {
  isVisible: boolean;
  actionType: 'report' | 'visualize' | null;
  triggerCardId?: string;
  onClose: () => void;
  onSend: (message: string, selectedCards: string[], actionType: 'report' | 'visualize') => void;
  isSelectionMode?: boolean;
  onToggleSelectionMode?: () => void;
  selectedCards?: string[]; // 从外部传入的选中卡片列表
}

const ActionInputBox: React.FC<ActionInputBoxProps> = ({
  isVisible,
  actionType,
  triggerCardId,
  onClose,
  onSend,
  isSelectionMode = false,
  onToggleSelectionMode,
  selectedCards: externalSelectedCards = []
}) => {
  const [inputValue, setInputValue] = useState('');
  
  // 使用外部传入的选中卡片列表，而不是内部状态
  const selectedCards = externalSelectedCards;

  // 当组件隐藏时，清空输入状态
  useEffect(() => {
    if (!isVisible) {
      setInputValue('');
    }
  }, [isVisible]);

  const handleSend = () => {
    if (actionType && selectedCards.length > 0) {
      // 准备卡片引用数据
      const cardRefs = selectedCards.map(cardId => {
        // 解析 agentId-cardId 格式
        const parts = cardId.split('-');
        if (parts.length === 2) {
          return {
            agent_id: parts[0],
            card_id: parts[1]
          };
        }
        // 如果格式不正确，使用默认值（这种情况不应该发生）
        return {
          agent_id: 'unknown',
          card_id: cardId
        };
      });

      // 确定衍生类型
      const deriveType = actionType === 'report' ? 'general_derive' : 'visualize';
      
      // 准备prompt，如果为空则设为null
      const prompt = inputValue.trim() || null;

      // 调用API
      api.sendUserDeriveCard(cardRefs, prompt, deriveType);

      // 调用原有的onSend回调（保持兼容性）
      onSend(inputValue.trim(), selectedCards, actionType);
      
      setInputValue('');
      onClose();
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const removeSelectedCard = (cardId: string) => {
    // 调用全局函数来移除选中的卡片
    if (window.toggleCardSelection) {
      window.toggleCardSelection(cardId);
    }
  };

  const getActionTitle = () => {
    switch (actionType) {
      case 'report':
        return '📊 生成报告';
      case 'visualize':
        return '📈 可视化';
      default:
        return '操作';
    }
  };

  const getPlaceholder = () => {
    switch (actionType) {
      case 'report':
        return '请描述您希望生成的报告内容...';
      case 'visualize':
        return '请描述您希望如何可视化数据...';
      default:
        return '请输入您的需求...';
    }
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="action-input-box">
      <div className="action-input-container">
        {/* 标题栏 */}
        <div className="action-input-header">
          <Typography variant="h6" className="action-title">
            {getActionTitle()}
          </Typography>
          <IconButton onClick={onClose} size="small" className="close-button">
            <CloseIcon />
          </IconButton>
        </div>

        {/* 选中的卡片 */}
        <div className="selected-cards">
          <div className="selected-cards-header">
            <Typography variant="body2" className="selected-cards-label">
              选中的卡片:
            </Typography>
            {onToggleSelectionMode && (
              <Button
                variant={isSelectionMode ? "contained" : "outlined"}
                size="small"
                startIcon={<TouchAppIcon />}
                onClick={onToggleSelectionMode}
                className="selection-mode-button"
              >
                {isSelectionMode ? '选择状态开' : '选择状态关'}
              </Button>
            )}
          </div>
          {selectedCards.length > 0 && (
            <div className="cards-chips">
              {selectedCards.map(cardId => {
                // 解析 cardId，如果包含 agentId 信息则提取，否则使用默认格式
                const parseCardId = (id: string) => {
                  // 如果 cardId 格式为 "agentId-cardId"，则解析
                  const parts = id.split('-');
                  if (parts.length === 2) {
                    return `${parts[0]}-${parts[1]}`;
                  }
                  // 否则假设是简单的 cardId，显示为 X-Y 格式（这里需要从 agentStore 获取 agentId）
                  return `X-${id}`;
                };
                
                return (
                  <Chip
                    key={cardId}
                    label={parseCardId(cardId)}
                    onDelete={() => removeSelectedCard(cardId)}
                    size="small"
                    color="primary"
                    variant="outlined"
                  />
                );
              })}
            </div>
          )}
        </div>

        {/* 输入框和发送按钮 */}
        <div className="input-section">
          <TextField
            fullWidth
            multiline
            minRows={2}
            maxRows={4}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={getPlaceholder()}
            variant="outlined"
            className="action-input-field"
          />
          <Button
            variant="contained"
            endIcon={<SendIcon />}
            onClick={handleSend}
            disabled={!actionType || selectedCards.length === 0}
            className="send-button"
          >
            发送
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ActionInputBox;