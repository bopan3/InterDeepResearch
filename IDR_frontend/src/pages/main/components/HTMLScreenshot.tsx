import React, { useEffect, useState, useRef } from 'react';
import { toCanvas } from 'html-to-image';

interface HTMLScreenshotProps {
  htmlContent: string;
  width?: number;
  height?: number;
  className?: string;
}

const HTMLScreenshot: React.FC<HTMLScreenshotProps> = ({
  htmlContent,
  width = 280,
  height = 200,
  className = ''
}) => {
  const [screenshotUrl, setScreenshotUrl] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const generateScreenshot = async () => {
      if (!htmlContent) {
        console.log('没有HTML内容');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError('');
        console.log('开始生成截图，HTML内容长度:', htmlContent.length);

        // 创建隐藏的iframe作为独立渲染环境
        const iframe = document.createElement('iframe');
        const fullScreenWidth = 1920;
        const fullScreenHeight = 1080;
        
        // 设置iframe样式，完全隐藏且不影响布局
        iframe.style.position = 'fixed';
        iframe.style.left = '-10000px';
        iframe.style.top = '-10000px';
        iframe.style.width = `${fullScreenWidth}px`;
        iframe.style.height = `${fullScreenHeight}px`;
        iframe.style.border = 'none';
        iframe.style.visibility = 'hidden';
        iframe.style.opacity = '0';
        iframe.style.pointerEvents = 'none';
        
        // 添加iframe到body
        document.body.appendChild(iframe);
        console.log('离屏iframe已创建，尺寸:', fullScreenWidth, 'x', fullScreenHeight);

        // 等待iframe加载完成
        await new Promise<void>((resolve) => {
          iframe.onload = () => resolve();
          // 设置iframe内容
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            iframeDoc.open();
            iframeDoc.write(`
              <!DOCTYPE html>
              <html>
              <head>
                <meta charset="utf-8">
                <style>
                  body { 
                    margin: 0; 
                    padding: 0; 
                    width: ${fullScreenWidth}px; 
                    height: ${fullScreenHeight}px; 
                    overflow: hidden;
                  }
                </style>
              </head>
              <body>${htmlContent}</body>
              </html>
            `);
            iframeDoc.close();
          }
        });

        // 等待内容渲染
        await new Promise(resolve => setTimeout(resolve, 800));

        console.log('开始html-to-image截图');
        
        // 获取iframe的body元素进行截图
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        const targetElement = iframeDoc?.body;
        
        if (!targetElement) {
          throw new Error('无法获取iframe内容');
        }

        // 生成高清截图
        const canvas = await toCanvas(targetElement, {
          width: fullScreenWidth,
          height: fullScreenHeight,
          pixelRatio: 8, // 大幅提高像素比以获得更高清晰度
          cacheBust: true,
          imagePlaceholder: undefined,
          skipAutoScale: false,
          quality: 1.0, // 设置最高质量
          style: {
            transform: 'scale(1)',
            transformOrigin: 'top left'
          }
        });

        console.log('html-to-image完成，canvas尺寸:', canvas.width, 'x', canvas.height);

        // 清理iframe
        document.body.removeChild(iframe);

        // 创建最终的canvas，使用超高分辨率
        const finalCanvas = document.createElement('canvas');
        // 使用更激进的像素比来获得最佳清晰度
        const basePixelRatio = window.devicePixelRatio || 1;
        const pixelRatio = basePixelRatio * 12; // 进一步提高到12倍以配合更高的源图像质量
        const displayWidth = width;
        const displayHeight = height;
        
        finalCanvas.width = displayWidth * pixelRatio;
        finalCanvas.height = displayHeight * pixelRatio;
        finalCanvas.style.width = displayWidth + 'px';
        finalCanvas.style.height = displayHeight + 'px';
        
        const ctx = finalCanvas.getContext('2d');
        
        if (ctx) {
          // 缩放上下文以匹配像素比
          ctx.scale(pixelRatio, pixelRatio);
          
          // 计算缩放比例，保持宽高比
          const scaleX = displayWidth / fullScreenWidth;
          const scaleY = displayHeight / fullScreenHeight;
          const scale = Math.min(scaleX, scaleY);
          
          const scaledWidth = fullScreenWidth * scale;
          const scaledHeight = fullScreenHeight * scale;
          
          // 居中绘制
          const offsetX = (displayWidth - scaledWidth) / 2;
          const offsetY = (displayHeight - scaledHeight) / 2;
          
          // 使用最高质量的图像缩放和渲染设置
          ctx.imageSmoothingEnabled = true; // 启用图像平滑以获得更好的缩放效果
          ctx.imageSmoothingQuality = 'high';
          
          // 使用类型断言来访问浏览器特定的属性
          const ctxAny = ctx as any;
          if ('webkitImageSmoothingEnabled' in ctx) {
            ctxAny.webkitImageSmoothingEnabled = true;
          }
          if ('mozImageSmoothingEnabled' in ctx) {
            ctxAny.mozImageSmoothingEnabled = true;
          }
          if ('msImageSmoothingEnabled' in ctx) {
            ctxAny.msImageSmoothingEnabled = true;
          }
          
          ctx.drawImage(canvas, offsetX, offsetY, scaledWidth, scaledHeight);
        }

        // 转换为图片URL，使用最高质量
        const imageUrl = finalCanvas.toDataURL('image/png'); // 使用PNG格式保持透明度和最高质量
        console.log('图片URL生成成功，长度:', imageUrl.length);
        setScreenshotUrl(imageUrl);
      } catch (err) {
        console.error('截图生成失败:', err);
        setError(`截图生成失败: ${err instanceof Error ? err.message : '未知错误'}`);
        
        // 确保在错误情况下也清理iframe
        const existingIframes = document.querySelectorAll('iframe[style*="-10000px"]');
        existingIframes.forEach(iframe => {
          try {
            document.body.removeChild(iframe);
          } catch (cleanupErr) {
            console.warn('清理iframe时出错:', cleanupErr);
          }
        });
      } finally {
        setLoading(false);
      }
    };

    generateScreenshot();
  }, [htmlContent, width, height]);

  if (loading) {
    return (
      <div className={`html-screenshot-container ${className}`}>
        <div className="screenshot-loading">正在截图中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`html-screenshot-container ${className}`}>
        <div className="screenshot-error">{error}</div>
      </div>
    );
  }

  if (!screenshotUrl) {
    return (
      <div className={`html-screenshot-container ${className}`}>
        <div className="screenshot-error">无法生成截图</div>
      </div>
    );
  }

  return (
    <div className={`html-screenshot-container ${className}`} ref={containerRef}>
      <img 
        src={screenshotUrl} 
        alt="HTML截图" 
        className="visualization-image"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    </div>
  );
};

export default HTMLScreenshot;