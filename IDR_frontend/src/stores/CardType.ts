// 卡片引用接口 - 简化为只包含 card_id
type CardRef = string;

// 卡片引用对象 - 用于发送消息时的引用列表
interface CardReference {
  card_id: string;
  selected_content: string | null;
}

// 引用来源接口 - 保持原有格式
interface CitationSource {
  citeId: string;
  web_source_link: string;
  source_snippet: string | null | {};
  source_content: string | null | {};
  supporting_clips: {
    from_source_snippet: string[] | null;
    from_source_content: string[] | null;
  };
}

// 卡片内容接口 - card_content 的结构
interface CardContent {
  card_type_description?: string; // 改为可选字段
  [key: string]: any; // 允许其他动态属性，如 markdown_convert_from_webpage 等
}

// 卡片接口 - 新格式
interface Card {
  card_id: string | null; // 允许 null 值
  card_type: string;
  displayed_card_type?: string; // 显示的卡片类型（用于UI展示）
  status?: string; // 卡片状态，如 "in_progress"
  unfold_at_start?: boolean; // 是否在开始时展开，默认为 false
  card_content: CardContent;
  card_ref: CardRef[]; // 保持原有格式兼容性
  card_ref_implicit?: string[]; // 隐式引用，用虚线连接
  card_ref_explicit?: string[]; // 显式引用，用实线连接
}

// 导出类型定义
export type { Card, CardRef, CardReference, CitationSource, CardContent };