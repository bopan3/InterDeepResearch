import React, { useState, useEffect } from 'react';
import './EditModal.scss';

interface EditModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialContent: string;
  onSave: (content: string) => void;
}

const EditModal: React.FC<EditModalProps> = ({ isOpen, onClose, initialContent, onSave }) => {
  const [content, setContent] = useState(initialContent);

  // 当初始内容变化时更新状态
  useEffect(() => {
    setContent(initialContent);
  }, [initialContent]);

  // 处理内容变化
  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
  };

  // 处理保存
  const handleSave = () => {
    onSave(content);
    onClose();
  };

  // 处理点击外部区域关闭
  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div className="edit-modal-backdrop" onClick={handleBackdropClick}>
      <div className="edit-modal">
        <div className="edit-modal-header">
          <h3>编辑任务内容</h3>
          <button className="close-button" onClick={onClose}>×</button>
        </div>
        <div className="edit-modal-body">
          <textarea
            className="edit-textarea"
            value={content}
            onChange={handleContentChange}
            placeholder="请输入任务描述..."
            autoFocus
          />
        </div>
        <div className="edit-modal-footer">
          <button className="cancel-button" onClick={onClose}>取消</button>
          <button className="save-button" onClick={handleSave}>保存</button>
        </div>
      </div>
    </div>
  );
};

export default EditModal;