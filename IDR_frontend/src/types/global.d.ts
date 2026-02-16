// 全局类型声明
declare global {
  interface Window {
    showActionInputBox?: (actionType: 'report' | 'visualize', cardId: string) => void;
    toggleCardSelection?: (cardId: string) => void;
  }
}

export {};