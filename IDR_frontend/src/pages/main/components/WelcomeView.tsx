import React, { useState } from 'react';
import { Box, Typography, TextField, IconButton, Paper, Chip } from '@mui/material';
import { Lightbulb as LightbulbIcon, Search as SearchIcon, Timeline as TimelineIcon } from '@mui/icons-material';
import './WelcomeView.scss';

interface WelcomeViewProps {
  onStartResearch: (message: string) => void;
  isProcessing: boolean;
}

const WelcomeView: React.FC<WelcomeViewProps> = ({ onStartResearch, isProcessing }) => {
  const [inputValue, setInputValue] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputValue.trim()) {
      onStartResearch(inputValue.trim());
      setInputValue('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e as any);
    }
  };
  
  return (
    <Box className="welcome-view">
      <Box className="welcome-content">
        {/* 标题区域 */}
        <Box className="welcome-header">
          <Typography variant="h3" className="welcome-title">
            InterDeepResearch
          </Typography>
        </Box>
        
        {/* 输入区域 */}
        <Paper className="welcome-input-container">
          <TextField
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Describe your research goal"
            variant="outlined"
            multiline
            maxRows={4}
            className="welcome-input"
            fullWidth
            sx={{
              '& .MuiOutlinedInput-root': {
                borderRadius: '0',
                '& fieldset': {
                  border: 'none',
                },
                '&:hover fieldset': {
                  border: 'none',
                },
                '&.Mui-focused fieldset': {
                  border: 'none',
                },
              },
            }}
              InputProps={{
                endAdornment: (
                  <IconButton
                    type="submit"
                    onClick={handleSubmit}
                    disabled={!inputValue.trim()}
                    className="welcome-send-button"
                    size="small"
                  >
                    <img src="/resource/send.svg" alt="send" />
                  </IconButton>
                )
              }}
          />
        </Paper>

        {/* 底部提示
        <Box className="welcome-footer">
          <Typography variant="body2" className="footer-text">
            Visual Deep Research can help you break down complex topics, coordinate research processes, and visualize connections between ideas.
          </Typography>
        </Box> */}
      </Box>
    </Box>
  );
};

export default WelcomeView;