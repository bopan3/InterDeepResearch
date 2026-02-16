import React, { useState, ReactNode } from 'react';
import './Tooltip.scss';

interface TooltipProps {
  content: string;
  children: ReactNode;
  disabled?: boolean;
  position?: 'top' | 'bottom'; // 添加position属性，支持上方或下方显示
  allowHtml?: boolean; // 添加allowHtml属性，支持HTML内容渲染
}

const Tooltip: React.FC<TooltipProps> = ({ content, children, disabled = false, position = 'top', allowHtml = false }) => {
  const [isVisible, setIsVisible] = useState(false);

  if (disabled || !content) {
    return <>{children}</>;
  }

  // 处理Markdown格式的加粗文本
  const processContent = (text: string) => {
    if (!allowHtml) return text;
    
    // 将Markdown的**text**转换为HTML的<strong>text</strong>
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
  };

  return (
    <span 
      className="tooltip-container"
      onMouseEnter={() => setIsVisible(true)}
      onMouseLeave={() => setIsVisible(false)}
    >
      {children}
      {isVisible && (
        <div className={`tooltip-content ${position === 'bottom' ? 'tooltip-bottom' : 'tooltip-top'}`}>
          {allowHtml ? (
            <div 
              className="tooltip-text" 
              dangerouslySetInnerHTML={{ __html: processContent(content) }}
            />
          ) : (
            <div className="tooltip-text">{content}</div>
          )}
          <div className="tooltip-arrow"></div>
        </div>
      )}
    </span>
  );
};

export default Tooltip;