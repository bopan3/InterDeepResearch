import React, { useState, useEffect } from 'react';

interface ThinkingAnimationProps {
  text?: string;
  className?: string;
}

const ThinkingAnimation: React.FC<ThinkingAnimationProps> = ({ 
  text = 'Thinking',
  className = ''
}) => {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots(prev => {
        if (prev === '...') {
          return '';
        } else if (prev === '') {
          return '.';
        } else if (prev === '.') {
          return '..';
        } else {
          return '...';
        }
      });
    }, 500); // 每500ms切换一次

    return () => clearInterval(interval);
  }, []);

  return (
    <span className={`thinking-animation ${className}`}>
      {text}
      <span className="thinking-dots">{dots}</span>
    </span>
  );
};

export default ThinkingAnimation;