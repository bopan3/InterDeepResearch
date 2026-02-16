import React, { useState } from "react";
import { observer } from "mobx-react-lite";
import { Box, Typography, Button, Card, CardContent, IconButton, Menu, MenuItem } from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { historyStore } from "../../../stores";
import "./HistoryView.scss";

interface Props {
  onSelect?: (id: string) => void;
  onNewChat?: () => void;
  onImportChat?: () => void;
  onExportChat?: (id: string) => void;
  onDeleteChat?: (id: string) => void;
  currentProjectId?: string; // 添加当前选中的项目ID
}

const HistoryView: React.FC<Props> = observer(
  ({ onSelect, onNewChat, onImportChat, onExportChat, onDeleteChat, currentProjectId }) => {
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);

    const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, chatId: string) => {
      event.stopPropagation();
      setAnchorEl(event.currentTarget);
      setActiveChatId(chatId);
    };

    const handleMenuClose = () => {
      setAnchorEl(null);
      setActiveChatId(null);
    };

    const handleExport = () => {
      if (activeChatId) onExportChat?.(activeChatId);
      handleMenuClose();
    };

    const handleDelete = () => {
      if (activeChatId) {
        const confirmed = window.confirm("Are you sure you want to delete this chat?");
        if (confirmed) onDeleteChat?.(activeChatId);
      }
      handleMenuClose();
    };

    return (
      <div className="history-sidebar">
        <div className="chat-history-section">
          <Typography variant="h6" className="section-title">
            Chat History
          </Typography>
        </div>

        {/* Tools */}
        <div className="tools-section">
          <Button variant="contained" className="tool-button" onClick={onNewChat}>
            New Chat
          </Button>
          <Button variant="outlined" className="tool-button" onClick={onImportChat}>
            Import Chat
          </Button>
        </div>

        {/* Project / Chat list */}
        <div className="chats-section">

            <div className="projects-list">
              {historyStore.projects.map((project, index) => {
                // console.log('Project item:', project);
                // console.log('Project ID:', project.id);
                return (
                <Card
                  key={project.id || index}
                  className={`project-card ${project.id === currentProjectId ? 'project-card-selected' : ''}`}
                  onClick={() => {
                    // console.log('Clicked on project with ID:', project.id);
                    onSelect?.(project.id);
                  }}
                >
                  <CardContent className="project-card-content">
                    <Box className="project-card-header" display="flex" justifyContent="space-between" alignItems="flex-start" width="100%" height="100%">
                      <Typography variant="subtitle1" className="project-name">
                        {project.title}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={(e) => handleMenuOpen(e, project.id)}
                        style={{ flexShrink: 0 }}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Box>

                  </CardContent>
                </Card>
                );
              })}
            </div>
        </div>

        {/* MUI Menu for Export/Delete */}
        <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleMenuClose}>
          <MenuItem onClick={handleExport}>Export</MenuItem>
          <MenuItem onClick={handleDelete}>Delete</MenuItem>
        </Menu>
      </div>
    );
  }
);

export default HistoryView;
