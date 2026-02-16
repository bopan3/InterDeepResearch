import { ExposureRounded } from '@mui/icons-material';
import { makeAutoObservable } from 'mobx';

// RequestKey 接口
interface RequestKeyItem {
  research_goal: string;
  request_key: string;
}

class RequestKeyStore {
  keys: RequestKeyItem[] = [];
  latestRequestKey: string = ''; // 添加记录最新request_key的属性

  constructor() {
    makeAutoObservable(this);
  }

  addKey(item: RequestKeyItem) {
    const existing = this.keys.find(k => k.research_goal === item.research_goal);
    if (existing) {
      existing.request_key = item.request_key;
    } else {
      this.keys.push(item);
    }
    // 记录最新的request_key
    this.latestRequestKey = item.request_key;
  }

  removeKey(research_goal: string) {        
    this.keys = this.keys.filter(k => k.research_goal !== research_goal);
  }

  setKeys(keys: RequestKeyItem[]) {
    this.keys = keys;
  }

  /**
   * 根据 request_key 校验并返回对应 research_goal，如果校验成功则删除对应记录
   */
  validateKey(request_key: string): string {
    const index = this.keys.findIndex(k => k.request_key === request_key);
    if (index !== -1) {
      const projectId = this.keys[index].research_goal;
      // 删除匹配的记录
      this.keys.splice(index, 1);
      return projectId;
    }
    return '';
  }
}

export const requestKeyStore = new RequestKeyStore();
export default requestKeyStore;
export type { RequestKeyItem };
