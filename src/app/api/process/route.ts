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

// 使用 LLM 进行语义拆分
async function splitWithLLM(line: string, maxChars: number, customHeaders?: Record<string, string>): Promise<string[]> {
  // 【KY005 修复】检查字数是否超过限制，未超过则直接返回
  const charCount = countChineseChars(line);
  if (charCount <= maxChars) {
    console.log(`[LLM拆分] 字数未超限 (${charCount} ≤ ${maxChars})，不拆分: ${line.substring(0, 20)}...`);
    return [line];
  }

  console.log(`[LLM拆分] 开始拆分，文本长度: ${charCount}字，限制: ${maxChars}字`);
  console.log(`[LLM拆分] 文本内容: ${line}`);

  try {
    const config = new Config();
    const client = new LLMClient(config, customHeaders);

    const systemPrompt = `【任务】将文本按照语义边界拆分成多行，每行不超过${maxChars}字。

【核心要求】
1. 每行严格≤${maxChars}个汉字
2. 100%保留所有字符，不能遗漏、增加或改变
3. 必须保持成语完整（如：平安顺遂、兴高采烈、坚持不懈、恭恭敬敬）
4. 必须保持固定短语完整（如：三个头、对着老槐树、微微发红）
5. 必须保持动宾结构完整（如：磕了三个头、救了三个儿童）
6. 按语义边界拆分（主谓之间、谓宾之间、并列短语、修饰关系）

【禁止拆分的结构】
- ❌ 四字成语：不能拆分成两行
- ❌ 动宾短语：如"磕了三个头"不能拆成"磕了三个"+"头"
- ❌ 介宾短语：如"对着老槐树"不能拆成"对着老"+"槐树"
- ❌ 固定搭配：如"微微发红"不能拆成"微微"+"发红"

【拆分策略】
1. 优先在句子的停顿处拆分（主谓之间、谓宾之间）
2. 其次在短语的边界拆分（并列短语、修饰关系）
3. 如果必须拆分长句，尽量保持词语完整

【正确示例】

示例1：
输入：相信它能庇佑全村人平安顺遂董永特意停下脚步恭恭敬敬对着老槐树磕了三个头
输出（每行≤12字）：
相信它能庇佑全村人
平安顺遂
董永特意停下脚步
恭恭敬敬对着老槐树
磕了三个头

示例2：
输入：重生反击德国绑架我救了三个落水儿童获得了见义勇为奖
输出（每行≤12字）：
重生反击德国绑架
我救了三个落水儿童
获得了见义勇为奖

示例3：
输入：恭恭敬敬对着老槐树磕了三个头额头磕得微微发红
输出（每行≤12字）：
恭恭敬敬对着老槐树
磕了三个头
额头磕得微微发红

【错误示例（绝对禁止）】

错误1：
输入：相信它能庇佑全村人平安顺遂
错误输出：
相信它能庇佑全村人
平安顺
遂
正确输出：
相信它能庇佑全村人
平安顺遂

错误2：
输入：恭恭敬敬对着老槐树磕了三个头
错误输出：
恭恭敬敬对着老槐树磕了三
个头
正确输出：
恭恭敬敬对着老槐树
磕了三个头

【输出格式要求】
- 只返回拆分后的行，每行一个
- 用换行符（\\n）分隔
- 不要有任何解释、编号或其他文字
- 确保每行≤${maxChars}字
- 确保成语、短语不被拆分`;

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `请将以下文本拆分成多行，每行≤${maxChars}字：\n\n${line}` }
    ];

    console.log(`[LLM拆分] 调用 LLM...`);
    const response = await client.invoke(messages, {
      model: 'doubao-seed-2-0-pro-260215', // 使用更强的模型
      temperature: 0, // 温度设为0，提高确定性
    });

    console.log(`[LLM拆分] LLM 响应:`, response.content);

    const result = response.content.trim();
    const lines = result.split('\n').map(l => l.trim()).filter(l => l.length > 0);

    console.log(`[LLM拆分] 拆分结果: ${JSON.stringify(lines)}`);

    // 验证字符数是否一致
    const originalCharCount = countChineseChars(line);
    const resultCharCount = lines.reduce((sum, l) => sum + countChineseChars(l), 0);

    console.log(`[LLM拆分] 字符数验证: 原始${originalCharCount}字，结果${resultCharCount}字`);

    if (originalCharCount !== resultCharCount) {
      console.warn(`[LLM拆分] 字符数不一致，使用简单拆分`);
      return simpleSplit(line, maxChars);
    }

    // 【禁用】合并相邻的短行，避免破坏语义拆分结果
    // const optimizedLines = optimizeAfterSplit(lines, maxChars);
    // console.log(`[LLM拆分] 优化后结果: ${JSON.stringify(optimizedLines)}`);
    // return optimizedLines;

    // 直接返回 LLM 的拆分结果，不做任何优化
    console.log(`[LLM拆分] 直接返回 LLM 拆分结果（不做优化）`);
    return lines;
  } catch (error) {
    console.error('[LLM拆分] 拆分失败，使用简单拆分，错误:', error);
    return simpleSplit(line, maxChars);
  }
}

// 简单拆分（备用方案）
function simpleSplit(line: string, maxChars: number): string[] {
  console.warn(`[简单拆分] 使用简单拆分（非语义），文本: ${line.substring(0, 30)}...，限制: ${maxChars}字`);

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

  console.warn(`[简单拆分] 简单拆分结果: ${JSON.stringify(result)}`);

  // 【禁用】合并相邻的短行，避免破坏语义
  // const optimizedLines = optimizeAfterSplit(result, maxChars);
  // console.warn(`[简单拆分] 优化后结果: ${JSON.stringify(optimizedLines)}`);
  // return optimizedLines;

  // 直接返回简单拆分结果
  return result;
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
            
            try {
              const splitLines = await splitWithLLM(line, maxCharsValue, customHeaders);
              // 使用splice插入到正确位置，保持顺序
              finalLines.splice(index, 1, ...splitLines);
              firstRoundCount++;
              sendDebug(`LLM 拆分行 ${longLines.length - i}/${longLines.length}: ${line.substring(0, 20)}... -> ${splitLines.length} 行`);
            } catch (error) {
              console.error(`LLM 拆分失败，使用简单拆分:`, error);
              const splitLines = simpleSplit(line, maxCharsValue);
              finalLines.splice(index, 1, ...splitLines);
            }

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
            
            try {
              // 第二轮使用更严格的拆分
              const splitLines = await splitWithLLM(line, maxCharsValue, customHeaders);
              // 替换原行
              finalLines.splice(index, 1, ...splitLines);
              sendDebug(`第二轮拆分行 ${i + 1}/${secondRoundLongLines.length}: ${line.substring(0, 20)}... -> ${splitLines.length} 行`);
            } catch (error) {
              console.error(`第二轮 LLM 拆分失败，使用简单拆分:`, error);
              const splitLines = simpleSplit(line, maxCharsValue);
              finalLines.splice(index, 1, ...splitLines);
            }

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
        // 检查是否是中断错误
        if (error instanceof Error && error.message === '处理被用户取消') {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: '处理已取消' })}\n\n`));
        } else {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: '处理失败，请稍后重试' })}\n\n`));
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
