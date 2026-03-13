'use client';

import { useState, useRef } from 'react';

export default function TextProcessor() {
  const [inputText, setInputText] = useState('');
  const [outputText, setOutputText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState('');
  const [maxChars, setMaxChars] = useState(12);
  const [copied, setCopied] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [progressStep, setProgressStep] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const [progressPercent, setProgressPercent] = useState(0);
  const [baomuPrefix, setBaomuPrefix] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const [processingDuration, setProcessingDuration] = useState('');

  // 统计汉字字数（排除标点和空格）
  const countChineseChars = (text: string): number => {
    const chineseChars = text.match(/[\u4e00-\u9fa5]/g);
    return chineseChars ? chineseChars.length : 0;
  };

  const handleProcess = async () => {
    if (!inputText.trim()) {
      setError('请输入文本');
      return;
    }

    setIsProcessing(true);
    setError('');
    setOutputText('');
    setProgressStep('');
    setProgressMessage('准备处理...');
    setProgressPercent(0);
    setProcessingDuration('');

    // 创建 AbortController
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch('/api/process', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ text: inputText, maxChars, baomuPrefix }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || '处理失败');
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应');
      }

      const decoder = new TextDecoder();
      let result = '';
      let buffer = ''; // 缓冲区，存储不完整的数据

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;

        // 按双换行符分割（SSE 格式）
        const lines = buffer.split('\n\n');
        // 保留最后一个可能不完整的行
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.trim() && line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === 'result') {
                result = data.content;
                setOutputText(result);
                setProcessingDuration(data.duration || '');
              } else if (data.type === 'progress') {
                setProgressStep(data.step || '');
                setProgressMessage(data.message || '');
                if (data.total > 0) {
                  const percent = Math.round((data.current / data.total) * 100);
                  setProgressPercent(percent);
                }
              } else if (data.type === 'debug') {
                console.log('[DEBUG]', data.message);
              } else if (data.type === 'error') {
                throw new Error(data.message || '处理失败');
              }
            } catch (parseError) {
              console.error('解析 JSON 失败:', parseError, '行内容:', line);
            }
          }
        }
      }
    } catch (err) {
      // 检查是否是用户主动取消
      if (err instanceof Error && err.name === 'AbortError') {
        setError('处理已取消');
      } else {
        setError(err instanceof Error ? err.message : '处理失败');
      }
    } finally {
      setIsProcessing(false);
      setProgressStep('');
      setProgressMessage('');
      setProgressPercent(0);
      abortControllerRef.current = null;
    }
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  // 拖拽上传处理
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length === 0) return;

    const file = files[0];
    if (!file.name.endsWith('.txt')) {
      setError('请上传 TXT 格式的文件');
      return;
    }

    try {
      const text = await file.text();
      setInputText(text);
      setOutputText('');
      setError('');
    } catch (err) {
      setError('读取文件失败');
    }
  };

  // 复制到剪贴板
  const handleCopy = async () => {
    if (!outputText) return;

    try {
      await navigator.clipboard.writeText(outputText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      setError('复制失败');
    }
  };

  // 下载为TXT
  const handleDownload = () => {
    if (!outputText) return;

    const blob = new Blob([outputText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = '处理结果.txt';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-200 via-blue-100 to-purple-100">
      <div className="container mx-auto px-8 py-12 max-w-7xl">
        {/* 标题区域 */}
        <div className="text-center mb-8">
          <h1 className="text-5xl font-bold text-gray-900 mb-4 tracking-tight">
            智能文本处理
          </h1>
          <p className="text-gray-600 text-lg font-medium">
            删除报幕信息 · 标点符号断行 · LLM 语义拆分
          </p>
          <div className="w-24 h-1 bg-gradient-to-r from-blue-500 to-blue-600 mx-auto mt-6 rounded-full"></div>
        </div>

        {/* 文本合并工具 */}
        <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 border border-gray-100 p-4 mb-6">
          <div className="flex items-center justify-between">
            <a
              href="https://code.coze.cn/api/sandbox/coze_coding/file/proxy?expire_time=-1&file_path=assets%2F%E5%90%88%E5%B9%B6%E6%96%87%E4%BB%B6%E5%A4%B9%E5%86%85%E7%9A%84TXT.bat&nonce=f6e03514-88f0-4fc3-a0a9-8ee99c1f03f4&project_id=7615137889751433216&sign=0032cc1cb059e5bb7d25954c062ad8248857e90449e0e1f3c2a6cde0dac1b467"
              download="合并文件夹内的TXT.bat"
              className="flex items-center gap-4 group cursor-pointer"
            >
              {/* 图标 */}
              <div className="flex-shrink-0 w-12 h-12 flex items-center justify-center">
                <img
                  src="https://code.coze.cn/api/sandbox/coze_coding/file/proxy?expire_time=-1&file_path=assets%2F%E5%9B%BE%E5%B1%82222+1.png&nonce=de13bfff-c80a-4f8f-bd29-7af35cb6a0ea&project_id=7615137889751433216&sign=59627714e82e5079f2d5fa5b73f0853b648fadf53c41c008dbec8207292a1378"
                  alt="文本合并工具"
                  className="w-12 h-12 object-contain"
                />
              </div>

              {/* 文字 */}
              <div className="flex-1">
                <div className="text-lg font-bold text-gray-800">文本合并工具</div>
                <div className="text-xs" style={{ color: '#2563eb', fontWeight: '600' }}>点击下载</div>
              </div>
            </a>

            {/* 每行字数设置 */}
            <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-lg border border-gray-200">
              <label className="text-xs text-gray-600 font-medium whitespace-nowrap">每行字数</label>
              <input
                type="number"
                min="1"
                max="20"
                value={maxChars}
                onChange={(e) => setMaxChars(Math.min(20, Math.max(1, Number(e.target.value))))}
                className="w-14 px-2 py-1 border border-gray-300 rounded text-center font-semibold text-gray-800 text-sm focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/20 transition-all"
              />
            </div>
          </div>
        </div>

        {/* 错误提示 */}
        {error && (
          <div className="max-w-3xl mx-auto mb-6 p-4 bg-red-50 border-l-4 border-red-400 rounded-lg text-red-700 font-medium flex items-center gap-3">
            <svg className="w-5 h-5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            {error}
          </div>
        )}

        {/* 左右布局 */}
        <div className="flex flex-row gap-8 mb-10 justify-center">
          {/* 左侧输入框 */}
          <div className="w-[600px]">
            <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 border border-gray-100 p-6 h-[500px] flex flex-col">
              <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                    输入文本
                  </h2>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    {countChineseChars(inputText)} 字
                  </span>
                </div>
                <div className="flex items-center gap-2 bg-orange-50 px-3 py-1.5 rounded-lg border border-orange-200">
                  <label className="text-xs text-orange-600 font-medium whitespace-nowrap">报幕前缀</label>
                  <input
                    type="text"
                    placeholder="剧名..."
                    value={baomuPrefix}
                    onChange={(e) => setBaomuPrefix(e.target.value)}
                    className="w-40 px-2 py-1 border border-gray-300 rounded text-xs text-gray-800 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-500/20 transition-all placeholder-gray-400"
                  />
                </div>
              </div>
              <div
                className={`flex-1 relative border-2 border-dashed rounded-xl p-5 transition-all duration-200 ${
                  isDragOver
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-gray-200'
                }`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <textarea
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  className="w-full h-full resize-none text-gray-700 placeholder-gray-400 focus:outline-none leading-relaxed"
                  placeholder="请输入需要处理的文本，或拖拽 TXT 文件到此处..."
                />
                {isDragOver && (
                  <div className="absolute inset-0 flex items-center justify-center bg-blue-500/90 rounded-xl">
                    <span className="text-white text-xl font-semibold">释放文件以上传</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 右侧结果框 */}
          <div className="w-[600px]">
            <div className="bg-white rounded-2xl shadow-lg shadow-gray-200/50 border border-gray-100 p-6 h-[500px] flex flex-col">
              <div className="flex items-center justify-between mb-5 pb-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <h2 className="text-xl font-bold text-gray-800 flex items-center gap-2">
                    <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                    处理结果
                  </h2>
                  <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                    {countChineseChars(outputText)} 字
                  </span>
                  {processingDuration && (
                    <span className="text-xs text-gray-400">
                      耗时 {processingDuration}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleCopy}
                    disabled={!outputText}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                      !outputText ? 'cursor-not-allowed' : 'hover:bg-blue-600'
                    }`}
                    style={
                      !outputText
                        ? {
                            backgroundColor: '#e5e7eb',
                            color: '#9ca3af',
                          }
                        : {
                            backgroundColor: '#3b82f6',
                            color: '#ffffff',
                          }
                    }
                  >
                    {copied ? '✓ 已复制' : '📋 复制'}
                  </button>
                  <button
                    onClick={handleDownload}
                    disabled={!outputText}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                      !outputText ? 'cursor-not-allowed' : 'hover:bg-green-600'
                    }`}
                    style={
                      !outputText
                        ? {
                            backgroundColor: '#e5e7eb',
                            color: '#9ca3af',
                          }
                        : {
                            backgroundColor: '#22c55e',
                            color: '#ffffff',
                          }
                    }
                  >
                    💾 下载
                  </button>
                </div>
              </div>
              <textarea
                value={outputText}
                readOnly
                className="flex-1 resize-none border border-gray-200 rounded-xl p-5 text-gray-700 bg-gray-50/50 placeholder-gray-400 focus:outline-none leading-relaxed"
                placeholder="处理结果将显示在这里..."
              />
            </div>
          </div>
        </div>

        {/* 处理按钮 */}
        <div className="flex flex-col items-center gap-3 relative z-50">
          <button
            onClick={handleProcess}
            disabled={!inputText.trim() || isProcessing}
            className={`px-16 py-4 rounded-2xl text-lg font-bold transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-lg border-2 relative z-50 ${
              !inputText.trim() || isProcessing
                ? 'bg-gray-200 border-gray-400 text-gray-500 cursor-not-allowed'
                : 'bg-blue-600 border-blue-700 hover:bg-blue-700 hover:border-blue-800 text-white shadow-blue-600/50'
            }`}
            style={
              !inputText.trim() || isProcessing
                ? undefined
                : {
                    background: 'linear-gradient(135deg, #2563eb 0%, #1d4ed8 50%, #1e40af 100%)',
                    borderColor: '#1e3a8a',
                    color: '#ffffff',
                    boxShadow: '0 0 0 3px rgba(59, 130, 246, 0.4), 0 8px 20px -5px rgba(37, 99, 235, 0.6), 0 4px 10px -2px rgba(37, 99, 235, 0.4)',
                    fontWeight: 'bold',
                    textShadow: '0 2px 4px rgba(0, 0, 0, 0.4)',
                  }
            }
          >
            {isProcessing ? (
              <span className="flex items-center gap-3">
                <svg className="animate-spin w-6 h-6" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                处理中...
              </span>
            ) : (
              <span>🚀 开始处理</span>
            )}
          </button>

          {/* 取消按钮 - 只在处理时显示 */}
          {isProcessing && (
            <button
              onClick={handleCancel}
              style={{
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: '2px solid #b91c1c',
              }}
              className="px-8 py-4 rounded-2xl font-bold text-lg shadow-lg hover:bg-red-700 transition-all active:scale-95 disabled:opacity-50 z-50"
            >
              取消处理
            </button>
          )}

          {/* 处理中进度提示 */}
          {isProcessing && (
            <div className="w-[480px] bg-white rounded-xl p-4 shadow-lg border border-gray-200">
              {/* 进度条 */}
              <div className="w-full bg-gray-200 rounded-full h-3 mb-3 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${progressPercent}%` }}
                ></div>
              </div>

              {/* 进度信息 */}
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4 text-blue-500" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="font-semibold text-gray-800">{progressStep || '处理中'}</span>
                </div>
                <span className="text-blue-600 font-bold">{progressPercent}%</span>
              </div>

              {/* 详细消息 */}
              {progressMessage && (
                <p className="text-xs text-gray-500 mt-2 truncate">
                  {progressMessage}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
