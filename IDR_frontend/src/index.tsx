import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/index.scss';

// 抑制 ResizeObserver 循环警告
// 这是一个已知的浏览器问题，当 ResizeObserver 回调中触发新的布局变化时会出现
// 通常不会影响功能，但会在控制台显示错误
window.addEventListener('error', (event) => {
  if (
    event.message === 'ResizeObserver loop completed with undelivered notifications.' ||
    event.message === 'ResizeObserver loop limit exceeded'
  ) {
    event.stopImmediatePropagation();
    return false;
  }
});

// 也处理未捕获的 Promise rejection 中的 ResizeObserver 错误
window.addEventListener('unhandledrejection', (event) => {
  if (
    event.reason &&
    typeof event.reason === 'object' &&
    'message' in event.reason &&
    (event.reason.message === 'ResizeObserver loop completed with undelivered notifications.' ||
     event.reason.message === 'ResizeObserver loop limit exceeded')
  ) {
    event.preventDefault();
  }
});

// 获取根元素
const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element not found');
}

// 创建React根实例并渲染应用
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);