import { makeAutoObservable } from 'mobx';

// 历史项目接口
interface HistoryProject {
  id: string;
  title: string;
}

class HistoryStore {
  // 历史项目列表
  projects: HistoryProject[] = [];
  // 当前项目ID
  currentProjectId: string = '1';

  constructor() {
    makeAutoObservable(this);
  }

  // Actions
  addProject(project: HistoryProject) {
    this.projects.push(project);
  }

  updateProject(id: string, updates: Partial<HistoryProject>) {
    const project = this.projects.find(p => p.id === id);
    if (project) {
      Object.assign(project, updates);
    }
  }

  removeProject(id: string) {
    this.projects = this.projects.filter(p => p.id !== id);
  }
  
  setCurrentProjectId(id: string) {
    this.currentProjectId = id;
  }
  
  setProjects(projects: HistoryProject[]) {
    this.projects = projects;
  }

  // Getters
  get projectList() {
    return this.projects;
  }

  getProject(id: string) {
    return this.projects.find(p => p.id === id);
  }
}

// 创建全局store实例
export const historyStore = new HistoryStore();
export default HistoryStore;
export type { HistoryProject };