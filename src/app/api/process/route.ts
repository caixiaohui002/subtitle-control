import { NextRequest } from 'next/server';
import { LLMClient, Config, HeaderUtils } from 'coze-coding-dev-sdk';

// 报幕信息正则模式
const BAOMU_PATTERNS = [
  /^\s*第[一二三四五六七八九十百千万\d]+[集章集回部期]\s*$/,
  /^\s*EP\d+\s*$/i,
  /^\s*Episode\s*\d+\s*$/i,
  /^\s*Chapter\s*\d+\s*$/i,
  /^\s*[本回本集本期]\s*$/,
  /^\s*[\(（]?[\d一二三四五六七八九十]+[\)）]\s*$/,
];

// 标点符号
const PUNCTUATION = ['，', '。', '！', '？', '；', '：', ',', '.', '!', '?', ';', ':', '、', '（', '）', '(', ')', '【', '】', '「', '」', '『', '』', '《', '》', '…', '……', '\n'];

// 判断是否为中文字符
function isChinese(char: string): boolean {
  return /[\u4e00-\u9fa5]/.test(char);
}

// 统计中文字符数
function countChineseChars(text: string): number {
  let count = 0;
  for (const char of text) {
    if (isChinese(char)) {
      count++;
    }
  }
  return count;
}

// 删除报幕信息
function removeBaomuInfo(text: string, baomuPrefix?: string, sendDebug?: (message: string) => void): string {
  const lines = text.split('\n');
  const filteredLines = lines.filter(line => {
    const trimmedLine = line.trim();

    // 检查标准报幕模式
    const isStandardBaomu = BAOMU_PATTERNS.some(pattern => pattern.test(trimmedLine));

    // 检查用户自定义的报幕前缀
    let isCustomBaomu = false;
    if (baomuPrefix && baomuPrefix.trim()) {
      // 去除所有空格，增加容错
      const normalizedPrefix = baomuPrefix.replace(/\s+/g, '');
      const normalizedLine = trimmedLine.replace(/\s+/g, '');

      // 检查前缀是否包含集数标记
      const episodePattern = /[-–]+(?:第?[0-9]+集|EP[0-9]+|Season[0-9]+|[0-9]+)$/i;
      const hasEpisode = episodePattern.test(normalizedPrefix);

      let prefixToMatch = normalizedPrefix;

      if (sendDebug) sendDebug(`原始前缀: "${baomuPrefix}"`);
      if (sendDebug) sendDebug(`标准化后前缀: "${normalizedPrefix}"`);
      if (sendDebug) sendDebug(`是否包含集数: ${hasEpisode}`);

      if (hasEpisode) {
        // 从前缀中提取剧名部分（去掉集数部分）
        const match = normalizedPrefix.match(/^([^-–]+)[-–]+(?:第?[0-9]+集|EP[0-9]+|Season[0-9]+|[0-9]+)$/i);
        if (sendDebug) sendDebug(`匹配结果: ${JSON.stringify(match)}`);
        if (match && match[1]) {
          prefixToMatch = match[1].trim();
          if (sendDebug) sendDebug(`提取的剧名: "${prefixToMatch}"`);
        }
      }

      // 检查这一行是否包含剧名，并且后面跟着集数
      // 使用简单的前缀匹配 + 集数检测
      const lineStartsWithPrefix = normalizedLine.startsWith(prefixToMatch);
      const restOfLine = normalizedLine.slice(prefixToMatch.length).trim();
      
      // 检查剩余部分是否以集数标记开头
      const episodeInRest = /^[-–]+(?:第?[0-9]+集|EP[0-9]+|Season[0-9]+|[0-9]+)/i.test(restOfLine);
      
      isCustomBaomu = lineStartsWithPrefix && episodeInRest;
      
      // 调试日志
      if (sendDebug) {
        sendDebug(`检查行: "${trimmedLine}"`);
        sendDebug(`标准化后行: "${normalizedLine}"`);
        sendDebug(`前缀: "${prefixToMatch}"`);
        sendDebug(`是否以前缀开头: ${lineStartsWithPrefix}`);
        sendDebug(`剩余部分: "${restOfLine}"`);
        sendDebug(`剩余部分是否有集数: ${episodeInRest}`);
        sendDebug(`是否匹配（删除）: ${isCustomBaomu}`);
        sendDebug('---');
      }
    }

    return !isStandardBaomu && !isCustomBaomu;
  });
  return filteredLines.join('\n');
}

// 按标点符号拆分并删除标点
function splitByPunctuation(line: string): string[] {
  const result: string[] = [];
  let current = '';

  for (const char of line) {
    if (PUNCTUATION.includes(char)) {
      if (current.trim()) {
        result.push(current.trim());
      }
      current = '';
    } else {
      current += char;
    }
  }

  if (current.trim()) {
    result.push(current.trim());
  }

  return result;
}

// LLM 拆分后的优化：合并相邻短行，追求行数最少，每行尽可能接近 maxChars
function optimizeAfterSplit(lines: string[], maxChars: number): string[] {
  const result: string[] = [...lines];
  let merged = true;

  // 循环合并，直到无法再合并为止
  while (merged) {
    merged = false;

    for (let i = 0; i < result.length - 1; i++) {
      const charCount1 = countChineseChars(result[i]);
      const charCount2 = countChineseChars(result[i + 1]);
      const totalCharCount = charCount1 + charCount2;

      // 如果合并后仍然 ≤ maxChars，检查是否合并后更接近 maxChars
      if (totalCharCount <= maxChars) {
        // 计算合并前后接近 maxChars 的程度
        const beforeApproach1 = Math.abs(charCount1 - maxChars);
        const beforeApproach2 = Math.abs(charCount2 - maxChars);
        const afterApproach = Math.abs(totalCharCount - maxChars);

        // 如果合并后更接近 maxChars（或者合并前两行都很短），就合并
        if (afterApproach <= beforeApproach1 && afterApproach <= beforeApproach2) {
          result[i] = result[i] + result[i + 1];
          result.splice(i + 1, 1);
          merged = true;
          break; // 重新开始遍历
        }
      }
    }
  }

  return result;
}

// 使用 LLM 进行语义拆分（100%使用，不做降级）
async function splitWithLLM(line: string, maxChars: number, customHeaders?: Record<string, string>): Promise<string[]> {
  console.log('[LLM拆分] 开始LLM拆分，文本长度:', line.length);

  try {
    // 创建 LLM 客户端
    // 明确传递 API Key 和 Base URLs，确保使用 Coze API
    const config = new Config({
      apiKey: process.env.COZE_WORKLOAD_IDENTITY_API_KEY,
      baseUrl: process.env.COZE_INTEGRATION_BASE_URL || 'https://api.coze.com',
      modelBaseUrl: process.env.COZE_INTEGRATION_MODEL_BASE_URL || 'https://model.coze.com',
      timeout: 60000, // 60秒超时（Vercel付费版限制）
    });

    console.log('[LLM拆分] 创建LLM客户端，timeout: 60000ms');
    console.log('[LLM拆分] 环境变量 COZE_WORKLOAD_IDENTITY_API_KEY:', process.env.COZE_WORKLOAD_IDENTITY_API_KEY ? '已设置' : '未设置');
    console.log('[LLM拆分] 环境变量 COZE_INTEGRATION_BASE_URL:', process.env.COZE_INTEGRATION_BASE_URL || 'https://api.coze.com');
    console.log('[LLM拆分] 环境变量 COZE_INTEGRATION_MODEL_BASE_URL:', process.env.COZE_INTEGRATION_MODEL_BASE_URL || 'https://model.coze.com');
    console.log('[LLM拆分] Config中API Key:', !!config.apiKey);
    console.log('[LLM拆分] Config中baseUrl:', config.baseUrl);
    console.log('[LLM拆分] Config中modelBaseUrl:', config.modelBaseUrl);
    console.log('[LLM拆分] 自定义Headers:', JSON.stringify(customHeaders));

    const llmClient = new LLMClient(config, customHeaders);

    // 构建提示词
    const prompt = `你是一个专业的文本拆分助手。请将以下文本拆分成多行，要求：
1. 每行纯汉字数严格≤${maxChars}字
2. 按语义边界拆分（如主谓宾结构、短语边界），保持短语完整性
3. 保护成语、固定短语不被拆分
4. 追求行数最少化，每行尽可能接近${maxChars}字
5. 100%保留输入文本的所有文字、语序、内容，一字不增、一字不减、一字不改

原文：${line}

请按以下格式返回（纯JSON，不要包含其他文字）：
${JSON.stringify({
  lines: [
    "第一行",
    "第二行"
  ]
})}`;

    console.log('[LLM拆分] 开始调用LLM...');
    const response = await llmClient.invoke(
      [
        {
          role: 'system' as const,
          content: '你是一个专业的文本拆分助手，只返回JSON格式，不包含其他文字。'
        },
        {
          role: 'user' as const,
          content: prompt
        }
      ],
      {
        model: 'doubao-seed-2-0-lite-260215',
        temperature: 0.3, // 降低随机性
      }
    );

    console.log('[LLM拆分] LLM调用成功');
    console.log('[LLM拆分] 响应类型:', typeof response);
    console.log('[LLM拆分] 响应内容长度:', response?.content?.length || 0);

    const resultText = response.content || '';
    console.log('[LLM拆分] LLM返回前200字符:', resultText.substring(0, 200));

    // 解析 JSON
    const jsonMatch = resultText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[LLM拆分] 无法在响应中找到JSON格式');
      console.error('[LLM拆分] 完整响应:', resultText);
      throw new Error('LLM返回的不是JSON格式');
    }

    const jsonText = jsonMatch[0];
    const result = JSON.parse(jsonText);

    if (!result.lines || !Array.isArray(result.lines)) {
      console.error('[LLM拆分] JSON解析结果:', JSON.stringify(result));
      throw new Error('LLM返回格式错误：缺少lines字段');
    }

    console.log('[LLM拆分] 拆分成功，共', result.lines.length, '行');
    return result.lines;
  } catch (error) {
    console.error('[LLM拆分] LLM调用失败:', error);
    if (error instanceof Error) {
      console.error('[LLM拆分] 错误名称:', error.name);
      console.error('[LLM拆分] 错误消息:', error.message);
      console.error('[LLM拆分] 错误堆栈:', error.stack);
    }
    throw error; // 重新抛出错误，让外层处理
  }
}

// 简单拆分（备用方案）
function simpleSplit(line: string, maxChars: number): string[] {
  const result: string[] = [];
  let current = '';

  for (const char of line) {
    current += char;

    const charCount = countChineseChars(current);

    if (charCount >= maxChars) {
      result.push(current);
      current = '';
    }
  }

  if (current) {
    result.push(current);
  }

  // 【优化】合并相邻的短行，追求行数最少
  const optimizedLines = optimizeAfterSplit(result, maxChars);

  return optimizedLines;
}


// POST 接口 - 流式响应
export async function POST(request: NextRequest) {
  const encoder = new TextEncoder();
  
  // 提取转发头（必需）
  const customHeaders = HeaderUtils.extractForwardHeaders(request.headers);
  
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const { text, maxChars, baomuPrefix } = await request.json();

        // 获取中断信号
        const signal = request.signal;

        // 调试信息发送函数
        const sendDebug = (message: string) => {
          console.log('[DEBUG]', message);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'debug', message })}\n\n`));
        };

        // 记录开始时间
        const startTime = Date.now();

        // 检查是否被中断
        const checkAborted = () => {
          if (signal.aborted) {
            throw new Error('处理被用户取消');
          }
        };

        sendDebug(`接收到的参数: {textLength: ${text?.length}, maxChars: ${maxChars}, baomuPrefix: "${baomuPrefix}"}`);

        if (!text || typeof text !== 'string') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: '请提供有效的文本内容' })}\n\n`));
          controller.close();
          return;
        }

        const maxCharsValue = maxChars ? Number(maxChars) : 12;

        if (maxCharsValue < 1 || maxCharsValue > 20) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: '每行字数必须在 1-20 之间' })}\n\n`));
          controller.close();
          return;
        }

        // ==================== 步骤1: 删除报幕信息 ====================
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤1/5', current: 0, total: 0, message: '正在删除报幕信息...' })}\n\n`));
        checkAborted();

        sendDebug(`开始删除报幕信息，前缀: ${baomuPrefix}`);
        const textAfterBaomu = removeBaomuInfo(text, baomuPrefix, sendDebug);
        sendDebug(`删除报幕后文本长度: ${textAfterBaomu.length}`);
        checkAborted();

        // ==================== 步骤2: 按标点符号拆分 ====================
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤2/5', current: 0, total: 0, message: '正在按标点符号拆分...' })}\n\n`));
        checkAborted();

        const punctuationSplitLines = splitByPunctuation(textAfterBaomu);
        sendDebug(`按标点拆分后共 ${punctuationSplitLines.length} 行`);
        checkAborted();

        // ==================== 步骤3: 删除所有标点符号 ====================
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤3/5', current: 0, total: 0, message: '正在删除标点符号...' })}\n\n`));
        checkAborted();

        const linesWithoutPunctuation = punctuationSplitLines.map(line => {
          // 删除所有标点符号
          let cleaned = line;
          PUNCTUATION.forEach(p => {
            cleaned = cleaned.replace(new RegExp(`\\${p}`, 'g'), '');
          });
          return cleaned.trim();
        }).filter(l => l.length > 0);
        
        sendDebug(`删除标点后共 ${linesWithoutPunctuation.length} 行`);
        checkAborted();

        // ==================== 步骤4: 首轮检测并拆分超长行 ====================
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤4/5', current: 0, total: linesWithoutPunctuation.length, message: `正在进行首轮检测和拆分...` })}\n\n`));
        checkAborted();

        // 复制所有行到finalLines
        const finalLines: string[] = [...linesWithoutPunctuation];
        const longLines: Array<{ index: number, line: string }> = [];
        let firstRoundCount = 0;

        // 找出所有超长行
        for (let i = 0; i < finalLines.length; i++) {
          checkAborted();
          const charCount = countChineseChars(finalLines[i]);

          if (charCount > maxCharsValue) {
            longLines.push({ index: i, line: finalLines[i] });
          }

          // 发送进度
          if (i % 5 === 0 || i === finalLines.length - 1) {
            const message = `正在检测行长度... (${i + 1}/${finalLines.length})，发现 ${longLines.length} 行超长`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤4/5', current: i + 1, total: finalLines.length, message })}\n\n`));
          }
        }

        sendDebug(`首轮检测完成：发现 ${longLines.length} 行超长，准备 LLM 拆分`);
        checkAborted();

        // 批量处理超长行
        if (longLines.length > 0) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤4/5', current: 0, total: longLines.length, message: `正在使用 LLM 进行语义拆分 (${longLines.length} 行)...` })}\n\n`));

          // 从后往前处理，避免索引变化
          for (let i = longLines.length - 1; i >= 0; i--) {
            checkAborted();
            const { index, line } = longLines[i];

            // 100% 使用 LLM，不做降级处理
            const splitLines = await splitWithLLM(line, maxCharsValue, customHeaders);

            // 使用splice插入到正确位置，保持顺序
            finalLines.splice(index, 1, ...splitLines);
            firstRoundCount++;
            sendDebug(`LLM 拆分行 ${longLines.length - i}/${longLines.length}: ${line.substring(0, 20)}... -> ${splitLines.length} 行`);

            // 发送进度
            checkAborted();
            const message = `正在 LLM 语义拆分... (${longLines.length - i}/${longLines.length})`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤4/5', current: longLines.length - i, total: longLines.length, message })}\n\n`));
          }
        }

        sendDebug(`首轮拆分完成：处理了 ${firstRoundCount} 行超长行`);
        checkAborted();

        // ==================== 步骤5: 通篇检查，确保没有超长行 ====================
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤5/5', current: 0, total: finalLines.length, message: `正在通篇检查字数...` })}\n\n`));
        checkAborted();

        const secondRoundLongLines: Array<{ index: number, line: string }> = [];
        
        for (let i = 0; i < finalLines.length; i++) {
          checkAborted();
          const charCount = countChineseChars(finalLines[i]);
          
          if (charCount > maxCharsValue) {
            secondRoundLongLines.push({ index: i, line: finalLines[i] });
          }

          // 发送进度
          if (i % 10 === 0 || i === finalLines.length - 1) {
            const message = `正在检查行长度... (${i + 1}/${finalLines.length})`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤5/5', current: i + 1, total: finalLines.length, message })}\n\n`));
          }
        }

        sendDebug(`通篇检查完成：发现 ${secondRoundLongLines.length} 行仍然超长`);
        checkAborted();

        // 如果仍有超长行，再次拆分
        if (secondRoundLongLines.length > 0) {
          sendDebug(`开始第二轮拆分：${secondRoundLongLines.length} 行仍然超长`);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤5/5', current: 0, total: secondRoundLongLines.length, message: `正在第二轮拆分 (${secondRoundLongLines.length} 行)...` })}\n\n`));

          // 从后往前处理，避免索引问题
          for (let i = secondRoundLongLines.length - 1; i >= 0; i--) {
            checkAborted();
            const { index, line } = secondRoundLongLines[i];

            // 100% 使用 LLM，不做降级处理
            const splitLines = await splitWithLLM(line, maxCharsValue, customHeaders);

            // 替换原行
            finalLines.splice(index, 1, ...splitLines);
            sendDebug(`第二轮拆分行 ${i + 1}/${secondRoundLongLines.length}: ${line.substring(0, 20)}... -> ${splitLines.length} 行`);

            // 发送进度
            checkAborted();
            const message = `正在第二轮拆分... (${secondRoundLongLines.length - i}/${secondRoundLongLines.length})`;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '步骤5/5', current: secondRoundLongLines.length - i, total: secondRoundLongLines.length, message })}\n\n`));
          }
        }

        sendDebug(`所有拆分完成！最终共 ${finalLines.length} 行`);
        
        // 验证所有行都不超过字数
        let allValid = true;
        for (let i = 0; i < finalLines.length; i++) {
          if (countChineseChars(finalLines[i]) > maxCharsValue) {
            sendDebug(`警告：第 ${i + 1} 行仍超长 (${countChineseChars(finalLines[i])} 字): ${finalLines[i].substring(0, 20)}...`);
            allValid = false;
          }
        }
        if (allValid) {
          sendDebug(`验证通过：所有行均≤${maxCharsValue}字`);
        }

        checkAborted();

        const result = finalLines.join('\n');

        // 发送完成进度
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'progress', step: '完成', current: finalLines.length, total: finalLines.length, message: '处理完成！' })}\n\n`));

        // 计算处理时长
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        // 格式化为 XX分钟XX秒 或 XX秒
        let durationText = '';
        if (duration < 1000) {
          durationText = `${duration}毫秒`;
        } else if (duration < 60000) {
          const seconds = Math.floor(duration / 1000);
          durationText = `${seconds}秒`;
        } else {
          const minutes = Math.floor(duration / 60000);
          const seconds = Math.floor((duration % 60000) / 1000);
          durationText = `${minutes}分钟${seconds}秒`;
        }
        
        sendDebug(`处理完成！耗时：${durationText}`);

        // 发送结果（包含时长信息）
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'result', content: result, duration: durationText })}\n\n`));

        controller.close();
      } catch (error) {
        console.error('处理文本时出错:', error);

        // 打印详细错误信息
        if (error instanceof Error) {
          console.error('错误名称:', error.name);
          console.error('错误消息:', error.message);
          console.error('错误堆栈:', error.stack);
        } else {
          console.error('错误详情:', JSON.stringify(error));
        }

        // 检查是否是中断错误
        if (error instanceof Error && error.message === '处理被用户取消') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: '处理已取消' })}\n\n`));
        } else {
          // 尝试提取更有用的错误信息
          let errorMessage = '处理失败，请稍后重试';
          if (error instanceof Error) {
            errorMessage = error.message || errorMessage;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: errorMessage })}\n\n`));
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
