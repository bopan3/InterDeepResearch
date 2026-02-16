import React from 'react';
import { observer } from 'mobx-react-lite';
import type { CardReference } from '../../../stores/CardType';
import { cardStore } from '../../../stores/CardStore';
import './ChatView.scss';

interface CardRefCollapsedProps {
  cardReference: CardReference;
  index?: number;
  onRemove?: (cardReference: CardReference) => void;
  inUserMessage?: boolean; // 是否在 user message 中使用
}

const CardRefCollapsed: React.FC<CardRefCollapsedProps> = observer(({ 
  cardReference, 
  index = 0,
  onRemove,
  inUserMessage = false
}) => {
  // 通过cardStore获取完整的卡片信息
  const card = cardStore.getCard(cardReference.card_id);
  
  // 获取卡片标题，与CardNode.tsx保持一致
  const getCardTitle = () => {
    if (!card) {
      return cardReference.card_id; // 如果找不到卡片，显示ID
    }
    return card.card_content?.card_title || card.card_type || '未命名卡片';
  };

  // 根据card type获取对应的圆形背景色，与CardNode.tsx保持一致
  const getCircleBackgroundColor = () => {
    if (!card) {
      return '#000000'; // 如果找不到卡片，默认黑色
    }
    const cardType = card.card_type;
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

  // 获取卡片图标
  const getCardIcon = () => {
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

  return (
    <div className={`card-ref-collapsed ${inUserMessage ? 'in-user-message' : ''}`}>
      <div className="card-ref-collapsed-content">
        <div 
          className="card-ref-collapsed-icon"
          style={{ backgroundColor: getCircleBackgroundColor() }}
        >
          <img 
            src={getCardIcon()} 
            alt={card?.card_type || 'card'} 
            style={card?.card_type === 'note' ? { transform: 'translateX(0.8px)' } : {}}
          />
        </div>
        <div className="card-ref-collapsed-title">
          <span className="card-ref-collapsed-title-text">
            {getCardTitle()}
          </span>
        </div>
      </div>
      {/* 删除按钮（仅在提供 onRemove 回调时显示） */}
      {onRemove && (
        <button 
          className="card-ref-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(cardReference);
          }}
          title="移除引用"
        >
          ×
        </button>
      )}
    </div>
  );
});

export default CardRefCollapsed;

