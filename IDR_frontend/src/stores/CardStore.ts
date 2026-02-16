import { makeAutoObservable } from 'mobx';
import type { Card } from './CardType';

/**
 * CardStore - 管理卡片数据
 */
class CardStore {
  // 卡片字典
  card_dict: { [key: string]: Card } = {};
  
  // 时间戳 - 用于追踪任何数据变化
  lastUpdateTimestamp: number = Date.now();

  constructor() {
    makeAutoObservable(this);
  }

  // 私有方法：更新时间戳
  private updateTimestamp() {
    this.lastUpdateTimestamp = Date.now();
  }

  // Actions - Card相关
  addCard(card: Card) {
    if (card.card_id) {
      this.card_dict[card.card_id] = card;
      this.updateTimestamp();
    }
  }

  updateCard(cardId: string, updates: Partial<Card>) {
    if (this.card_dict[cardId]) {
      const card = this.card_dict[cardId];
      Object.assign(card, updates);
      this.updateTimestamp();
    }
  }

  removeCard(cardId: string) {
    delete this.card_dict[cardId];
    this.updateTimestamp();
  }

  updateCards(cards: { [key: string]: Card }) {
    this.card_dict = cards;
    this.updateTimestamp();
  }

  // 设置卡片字典（用于从后端同步数据）
  setCards(cards: { [key: string]: Card }) {
    this.card_dict = cards;
    this.updateTimestamp();
  }

  // 差异化更新卡片
  updateCardsWithDiff(newCards: { [key: string]: Card }) {
    // 1. 处理新增和更新的卡片
    Object.entries(newCards).forEach(([cardId, newCard]) => {
      const existingCard = this.card_dict[cardId];
      
      if (!existingCard) {
        // 新增卡片 - 直接添加
        this.card_dict[cardId] = newCard;
      } else {
        // 更新卡片 - 直接更新
        this.card_dict[cardId] = newCard;
      }
    });
    
    // 2. 处理需要删除的卡片
    const newCardIds = Object.keys(newCards);
    const currentCardIds = Object.keys(this.card_dict);
    
    // 找出需要删除的卡片
    const cardsToRemove = currentCardIds.filter(id => !newCardIds.includes(id));
    
    // 删除这些卡片
    cardsToRemove.forEach(cardId => {
      delete this.card_dict[cardId];
    });
    
    this.updateTimestamp();
  }

  // 清空所有卡片
  clearCards() {
    this.card_dict = {};
    this.updateTimestamp();
  }

  // Getters
  get cards() {
    return this.card_dict;
  }

  get cardList() {
    return Object.values(this.card_dict);
  }

  getCard(cardId: string) {
    return this.card_dict[cardId];
  }

  getCardsByType(cardType: string) {
    return Object.values(this.card_dict).filter(card => card.card_type === cardType);
  }

  // 获取卡片总数
  get totalCardsCount() {
    return Object.keys(this.card_dict).length;
  }

  // 获取特定类型卡片的数量
  getCardCountByType(cardType: string) {
    return this.getCardsByType(cardType).length;
  }

  // 获取卡片统计
  getCardStats() {
    const stats: { [key: string]: number } = {};
    
    Object.values(this.card_dict).forEach(card => {
      const type = card.card_type;
      stats[type] = (stats[type] || 0) + 1;
    });
    
    return {
      total: this.totalCardsCount,
      byType: stats
    };
  }

  // 卡片连接管理方法
  addCardConnection(sourceCardId: string, targetCardId: string) {
    // 检查源卡片和目标卡片是否存在
    if (!this.card_dict[sourceCardId] || !this.card_dict[targetCardId]) {
      console.error('源卡片或目标卡片不存在');
      return false;
    }
    
    // 检查连接是否已存在
    const targetCard = this.card_dict[targetCardId];
    const existingConnection = targetCard.card_ref.find(ref => 
      ref === sourceCardId
    );
    
    if (existingConnection) {
      // console.log('连接已存在');
      return false;
    }
    
    // 添加连接 - 目标卡片引用源卡片，使用新的 card_ref 格式
    targetCard.card_ref.push(sourceCardId);
    this.updateTimestamp();
    return true;
  }

  // 移除卡片之间的连接
  removeCardConnection(sourceCardId: string, targetCardId: string) {
    if (!this.card_dict[targetCardId]) {
      console.error('目标卡片不存在');
      return false;
    }
    
    const targetCard = this.card_dict[targetCardId];
    const initialLength = targetCard.card_ref.length;
    
    // 过滤掉要移除的连接，使用新的 card_ref 格式
    targetCard.card_ref = targetCard.card_ref.filter(ref => 
      ref !== sourceCardId
    );
    
    // 如果长度变化，说明成功移除了连接
    const connectionRemoved = targetCard.card_ref.length !== initialLength;
    if (connectionRemoved) {
      this.updateTimestamp();
    }
    return connectionRemoved;
  }

  // 获取卡片的所有引用（被哪些卡片引用）
  getCardReferences(cardId: string) {
    const references: string[] = [];
    
    Object.values(this.card_dict).forEach(card => {
      // 检查原有的 card_ref 格式
      const hasReference = card.card_ref.some(ref => ref === cardId);
      // 检查新的隐式和显式引用
      const hasImplicitRef = card.card_ref_implicit?.includes(cardId);
      const hasExplicitRef = card.card_ref_explicit?.includes(cardId);
      
      if ((hasReference || hasImplicitRef || hasExplicitRef) && card.card_id) {
        references.push(card.card_id);
      }
    });
    
    return references;
  }

  // 获取卡片引用的其他卡片
  getCardDependencies(cardId: string) {
    const card = this.card_dict[cardId];
    if (!card) return [];
    
    const dependencies: string[] = [];
    
    // 添加原有格式的引用
    dependencies.push(...card.card_ref);
    
    // 添加隐式引用
    if (card.card_ref_implicit) {
      dependencies.push(...card.card_ref_implicit);
    }
    
    // 添加显式引用
    if (card.card_ref_explicit) {
      dependencies.push(...card.card_ref_explicit);
    }
    
    return dependencies;
  }

  // 获取卡片的隐式引用
  getCardImplicitReferences(cardId: string) {
    const card = this.card_dict[cardId];
    return card?.card_ref_implicit || [];
  }

  // 获取卡片的显式引用
  getCardExplicitReferences(cardId: string) {
    const card = this.card_dict[cardId];
    return card?.card_ref_explicit || [];
  }

  // 检查两个卡片是否有连接关系
  areCardsConnected(sourceCardId: string, targetCardId: string) {
    const targetCard = this.card_dict[targetCardId];
    if (!targetCard) return false;
    
    return targetCard.card_ref.some(ref => ref === sourceCardId);
  }
}

// 创建全局store实例
export const cardStore = new CardStore();
export default CardStore;
export type { Card };