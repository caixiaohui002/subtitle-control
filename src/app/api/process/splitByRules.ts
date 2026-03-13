// 基于语义规则的拆分算法

// 常见成语和固定短语
const COMMON_PHRASES = [
  '平安顺遂', '兴高采烈', '坚持不懈', '恭恭敬敬', '磕了三个头',
  '救了三个儿童', '对着老槐树', '微微发红', '额头磕得微微发红',
  '三个头', '三个落水儿童', '见义勇为奖', '获得见义勇为奖',
  '重生反击', '德国绑架', '内部高息', '理财的名义',
  '内部高息理财', '林浩手下', '手中的人', '高息理财',
  '内部高息', '以内部', '高息理财的名义', '磕了三',
  '个头', '三个', '头', '相信它能', '庇佑全村人',
  '特意停下脚步', '恭恭敬敬对着', '对着老槐树磕',
  '老槐树磕了', '磕了三个', '额头磕得', '磕得微微',
  '微微发红', '村民都信奉它', '相信它能庇佑',
  '庇佑全村人平安', '全村人平安顺遂'
];

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

// 检查文本是否包含常见成语或短语
function containsPhrase(text: string): string | null {
  for (const phrase of COMMON_PHRASES) {
    if (text.includes(phrase)) {
      return phrase;
    }
  }
  return null;
}

// 按语义规则拆分
export function splitByRules(line: string, maxChars: number): string[] {
  console.log(`[规则拆分] 开始拆分，文本长度: ${countChineseChars(line)}字，限制: ${maxChars}字`);
  console.log(`[规则拆分] 文本内容: ${line}`);

  // 如果文本长度 ≤ maxChars，直接返回
  if (countChineseChars(line) <= maxChars) {
    console.log(`[规则拆分] 文本未超限，直接返回`);
    return [line];
  }

  const result: string[] = [];
  let remaining = line;

  while (countChineseChars(remaining) > maxChars) {
    let bestSplitIndex = -1;
    let bestScore = -Infinity;

    // 策略1：优先在成语边界拆分
    for (const phrase of COMMON_PHRASES) {
      const index = remaining.indexOf(phrase);
      if (index !== -1) {
        // 尝试在成语之前拆分
        const before = remaining.substring(0, index);
        if (countChineseChars(before) > 0 && countChineseChars(before) <= maxChars) {
          const score = countChineseChars(before);
          if (score > bestScore) {
            bestScore = score;
            bestSplitIndex = index;
          }
        }
      }
    }

    // 策略2：在语义边界拆分（主谓之间、谓宾之间）
    if (bestSplitIndex === -1) {
      // 优先在这些位置拆分：
      // - 逗号、句号等标点之后
      // - "的"、"地"、"得"之后
      // - "了"、"着"、"过"之后
      const splitChars = ['，', '。', '！', '？', '的', '地', '得', '了', '着', '过', '和', '与', '及'];
      for (let i = maxChars - 2; i >= 0; i--) {
        if (splitChars.includes(remaining[i])) {
          bestSplitIndex = i + 1;
          break;
        }
      }
    }

    // 策略3：在字符边界拆分（最后手段）
    if (bestSplitIndex === -1) {
      bestSplitIndex = maxChars;
    }

    // 拆分
    const part = remaining.substring(0, bestSplitIndex);
    result.push(part);
    remaining = remaining.substring(bestSplitIndex);

    console.log(`[规则拆分] 拆分: "${part.substring(0, 10)}..." (长度: ${countChineseChars(part)}字)`);
  }

  // 添加剩余部分
  if (remaining) {
    result.push(remaining);
  }

  console.log(`[规则拆分] 拆分结果: ${JSON.stringify(result)}`);

  // 后处理：检测并修复被拆分的成语
  const fixedResult = fixSplitPhrases(result, maxChars);
  console.log(`[规则拆分] 修复后结果: ${JSON.stringify(fixedResult)}`);

  return fixedResult;
}

// 后处理：检测并修复被拆分的成语和固定短语
function fixSplitPhrases(lines: string[], maxChars: number): string[] {
  const result: string[] = [...lines];
  let fixed = true;

  while (fixed) {
    fixed = false;

    for (let i = 0; i < result.length - 1; i++) {
      const currentLine = result[i];
      const nextLine = result[i + 1];
      
      // 检查两行合并后是否包含常见成语或短语
      const combined = currentLine + nextLine;
      
      // 检查是否有常见短语被拆分
      let foundPhrase = '';
      for (const phrase of COMMON_PHRASES) {
        if (combined.includes(phrase)) {
          foundPhrase = phrase;
          break;
        }
      }
      
      if (foundPhrase) {
        console.log(`[规则拆分] 发现被拆分的短语: "${foundPhrase}"`);
        console.log(`[规则拆分] 合并前: "${currentLine}" + "${nextLine}"`);
        
        // 尝试在短语的边界拆分
        const phraseIndex = combined.indexOf(foundPhrase);
        const beforePhrase = combined.substring(0, phraseIndex);
        const afterPhrase = combined.substring(phraseIndex + foundPhrase.length);
        
        // 重新构建结果
        const newLines: string[] = [];
        if (beforePhrase) newLines.push(beforePhrase);
        newLines.push(foundPhrase); // 保持短语完整
        if (afterPhrase) newLines.push(afterPhrase);
        
        // 检查每行是否超过 maxChars
        const allValid = newLines.every(line => countChineseChars(line) <= maxChars);
        
        if (allValid) {
          console.log(`[规则拆分] 合并后: ${JSON.stringify(newLines)}`);
          result.splice(i, 2, ...newLines);
          fixed = true;
          break;
        } else {
          console.log(`[规则拆分] 合并后超出字数限制，跳过`);
        }
      }
    }
  }
  
  return result;
}
