#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import re
import sys
from typing import List

# LLM SDK 导入
from coze_coding_dev_sdk import LLMClient
from langchain_core.messages import SystemMessage, HumanMessage


class TextProcessor:
    """文本处理器 - 删除报幕信息、标点断行、语义拆分"""

    def __init__(self):
        # 初始化 LLM 客户端
        self.llm_client = LLMClient()

        # 定义标点符号
        self.punctuation = '，。！？、；：""''（）【】《》<>,.!?;:"\'()[]{}'

        # 定义报幕信息正则模式
        self.baomu_patterns = [
            r'.*第[一二三四五六七八九十百千万\d]+集.*',  # XXXXX 第一集、第二集
            r'.*第[一二三四五六七八九十百千万\d]+[期章篇].*',  # 第一期、第一篇等（不包含"回"，因为"回应"是普通词汇）
            r'.*第[一二三四五六七八九十百千万\d]+回$',  # 第一回（必须在行尾）
            r'.*EP\d+.*',  # EP1, EP2等
            r'.*Episode\s*\d+.*',  # Episode 1, Episode 2等
            r'.*第\d+讲.*',  # 第1讲等
            r'.*第\d+部分.*',  # 第1部分等
            r'.*第\d+段.*',  # 第1段等
        ]

    def remove_baomu_info(self, text: str) -> str:
        """删除报幕信息"""
        lines = text.split('\n')
        filtered_lines = []

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # 检查是否匹配报幕信息
            is_baomu = False
            for pattern in self.baomu_patterns:
                if re.match(pattern, line, re.IGNORECASE):
                    is_baomu = True
                    break

            if not is_baomu:
                filtered_lines.append(line)

        return '\n'.join(filtered_lines)

    def count_chinese_chars(self, text: str) -> int:
        """统计纯汉字数量（仅计汉字，不计空格、标点等）"""
        return len(re.findall(r'[\u4e00-\u9fff]', text))

    def split_long_line_with_llm(self, line: str) -> List[str]:
        """使用 LLM 智能拆分超长行（>12字）"""
        char_count = self.count_chinese_chars(line)

        if char_count <= 12:
            return [line]

        # 构造 LLM 提示
        system_prompt = """你是一个专业的文本语义拆分专家。你的任务是将长句按照语义拆分成多个短句。

核心规则（非常重要）：
1. 拆分后每一行纯汉字数严格≤12个，无任何例外
2. 禁止拆分人名（如七仙女、董永）、地名（如天庭、董家村）、固定专有名词（如瑶池水镜）、四字成语
3. 每一行必须是独立完整的最小语义单元，无半词半义、破碎内容
4. 拆分优先级：主谓拆分 → 动作+内容拆分 → 修饰语+核心语义拆分 → 承接关系拆分
5. 【最重要】100%保留输入文本的所有文字、语序、内容，一字不增、一字不减、一字不改
6. 输出格式要求：连续分行排列，仅输出拆分后的文本行，禁止输出其他无关内容、说明、解释

示例：
输入：董永整个人的腰杆一下子挺得笔直的脸上洋溢着难以掩饰的得意神情说话声音也大了许多
输出：
董永整个人的腰杆
一下子挺得笔直
脸上洋溢着难以
掩饰的得意神情
说话声音也大了许多

现在请拆分以下文本（确保输出包含输入的所有文字，不要遗漏任何内容）："""

        max_retries = 3
        for attempt in range(max_retries):
            try:
                # 调用 LLM
                messages = [
                    SystemMessage(content=system_prompt),
                    HumanMessage(content=line)
                ]

                response = self.llm_client.invoke(
                    messages=messages,
                    model="doubao-seed-2-0-lite-260215",
                    temperature=0.2  # 降低温度，提高确定性
                )

                # 安全获取响应内容
                if isinstance(response.content, str):
                    content = response.content.strip()
                elif isinstance(response.content, list):
                    if response.content and isinstance(response.content[0], str):
                        content = " ".join(response.content).strip()
                    else:
                        content = ""
                        for item in response.content:
                            if isinstance(item, dict) and item.get("type") == "text":
                                content += item.get("text", "")
                        content = content.strip()
                else:
                    content = str(response.content).strip()

                # 分割成行并过滤空行
                split_lines = [l.strip() for l in content.split('\n') if l.strip()]

                # 验证拆分结果 - 检查内容完整性
                original_char_count = self.count_chinese_chars(line)
                split_char_count = self.count_chinese_chars(''.join(split_lines))

                # 如果拆分结果的汉字数与原始不一致，可能是 LLM 丢失了内容
                if split_char_count != original_char_count:
                    print(f"    警告: LLM 返回的内容字数不一致（原始{original_char_count}字，返回{split_char_count}字），尝试重新拆分... (尝试 {attempt + 1}/{max_retries})")
                    if attempt < max_retries - 1:
                        continue  # 重试
                    else:
                        # 最后一次重试失败，使用简单拆分
                        print(f"    LLM 重试失败，使用简单拆分")
                        return self._simple_split(line)

                # 验证每行字数
                valid_lines = []
                for split_line in split_lines:
                    # 统计汉字数
                    split_char_count = self.count_chinese_chars(split_line)

                    # 如果超过12字，递归继续拆分
                    if split_char_count > 12:
                        sub_lines = self.split_long_line_with_llm(split_line)
                        valid_lines.extend(sub_lines)
                    else:
                        valid_lines.append(split_line)

                return valid_lines

            except Exception as e:
                print(f"    LLM 拆分失败: {e} (尝试 {attempt + 1}/{max_retries})", file=sys.stderr)
                if attempt < max_retries - 1:
                    continue  # 重试

        # 所有重试都失败，使用简单拆分
        print(f"    LLM 拆分失败，使用简单拆分作为兜底")
        return self._simple_split(line)

    def _simple_split(self, line: str) -> List[str]:
        """简单的字符截断拆分（兜底方案）"""
        result = []
        current = ""

        for char in line:
            current += char
            if self.count_chinese_chars(current) >= 12:
                result.append(current)
                current = ""

        if current:
            result.append(current)

        return result

    def process_file(self, input_file: str, output_file: str) -> bool:
        """处理文件主流程"""
        try:
            # 1. 读取原始文件
            print(f"正在读取文件: {input_file}")
            with open(input_file, 'r', encoding='utf-8') as f:
                original_text = f.read()

            # 2. 删除报幕信息
            print("正在删除报幕信息...")
            text_after_baomu = self.remove_baomu_info(original_text)

            # 3. 按行分割（保持原有行结构）
            print("正在按行处理...")
            lines = text_after_baomu.split('\n')
            # 去除空行
            lines = [line.strip() for line in lines if line.strip()]

            print(f"初始处理完成，共 {len(lines)} 行")

            # 4. 拆分超长行（>12字）
            print("正在拆分超长行...")
            final_lines = []

            for i, line in enumerate(lines):
                char_count = self.count_chinese_chars(line)

                if char_count > 12:
                    print(f"  拆分第 {i+1}/{len(lines)} 行（{char_count}字）: {line[:30]}...")
                    split_lines = self.split_long_line_with_llm(line)
                    final_lines.extend(split_lines)
                else:
                    final_lines.append(line)

            # 5. 保存结果
            print(f"正在保存结果到: {output_file}")
            with open(output_file, 'w', encoding='utf-8') as f:
                f.write('\n'.join(final_lines))

            # 6. 验证
            print("\n验证结果：")
            print(f"  总行数: {len(final_lines)}")

            # 统计超标行
            over_limit = 0
            for line in final_lines:
                if self.count_chinese_chars(line) > 12:
                    over_limit += 1
                    print(f"  警告: 以下行超过12字: {line}")

            if over_limit > 0:
                print(f"  ⚠️  发现 {over_limit} 行超过12字")
            else:
                print(f"  ✅ 所有行均≤12字")

            # 验证内容完整性
            original_clean = re.sub(r'[\s\n]', '', original_text)
            final_clean = re.sub(r'[\s\n]', '', '\n'.join(final_lines))

            if original_clean == final_clean:
                print(f"  ✅ 内容完全一致，无文字丢失")
            else:
                diff = abs(len(original_clean) - len(final_clean))
                print(f"  ⚠️  内容不一致！差异: {diff} 字符")

            print(f"\n处理完成！结果已保存到: {output_file}")
            return True

        except FileNotFoundError as e:
            print(f"错误：文件未找到 - {e}", file=sys.stderr)
            return False
        except Exception as e:
            print(f"错误：处理失败 - {e}", file=sys.stderr)
            import traceback
            traceback.print_exc()
            return False


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("使用方法: python3 process_text_advanced_v3.py <输入文件> [输出文件]")
        print("示例: python3 process_text_advanced_v3.py /tmp/original.txt /tmp/output.txt")
        sys.exit(1)

    input_file = sys.argv[1]
    output_file = sys.argv[2] if len(sys.argv) > 2 else '/tmp/processed_advanced_v3.txt'

    # 创建处理器并执行
    processor = TextProcessor()
    success = processor.process_file(input_file, output_file)

    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
